const assert = require("node:assert/strict");

const handler = require("./.tmp-macro-handler.cjs").default;

function responseRecorder() {
  const headers = new Map();
  let statusCode = 0;
  let payload = null;
  return {
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    snapshot() { return { headers, statusCode, payload }; }
  };
}

function rss() {
  return `<?xml version="1.0"?><rss><channel><item><title>Lithium market update</title><link>https://example.test/lithium</link><pubDate>Thu, 04 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
}

async function main() {
  delete process.env.FRED_API_KEY;
  delete process.env.EIA_API_KEY;
  const originalInfo = console.info;
  const diagnostics = [];
  const gdeltFetches = [];
  console.info = (...args) => diagnostics.push(args);
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "www.mining.com") return new Response(rss(), { status: 200, headers: { "content-type": "application/rss+xml" } });
    assert.equal(url.hostname, "api.gdeltproject.org", "only the expected GDELT endpoint may be requested");
    gdeltFetches.push({ url, init });
    const query = url.searchParams.get("query");
    await new Promise((resolve) => setTimeout(resolve, 700));
    return new Response(JSON.stringify({ articles: [{ title: `${query} verified article`, url: `https://example.test/${query}`, seendate: "20260904T010203Z" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const elapsedStartedAt = Date.now();
    const res = responseRecorder();
    await handler({ method: "GET", headers: { "x-macro-request-id": "manual-parallel-001" }, query: { refresh: "1" } }, res);
    const elapsedMs = Date.now() - elapsedStartedAt;
    const response = res.snapshot();
    assert.equal(response.statusCode, 200, "manual refresh must remain HTTP 200");
    assert.equal(response.headers.get("cache-control"), "private, no-store", "manual response must not be cached");
    assert.ok(elapsedMs < 1_200, `two 700ms GDELT requests must remain parallel, actual ${elapsedMs}ms`);
    assert.equal(gdeltFetches.length, 2, "manual refresh must issue exactly two GDELT JSON requests");
    assert.deepEqual(gdeltFetches.map(({ url }) => url.searchParams.get("query")).sort(), ["economy", "geopolitics"]);
    for (const { url, init } of gdeltFetches) {
      assert.equal(url.searchParams.get("mode"), "artlist");
      assert.equal(url.searchParams.get("format"), "json");
      assert.equal(url.searchParams.get("maxrecords"), "5");
      assert.equal(url.searchParams.get("timespan"), "1week");
      assert.equal(url.searchParams.get("sort"), "datedesc");
      assert.equal(init.cache, "no-store", "GDELT fetch must bypass cache");
      assert.ok(init.signal, "GDELT fetch must carry an AbortSignal");
    }
    const eventPayloads = diagnostics.filter(([tag]) => tag === "GDELT_DIAGNOSTIC").map(([, payload]) => payload);
    const started = eventPayloads.filter((entry) => entry.event === "provider_request_started");
    const received = eventPayloads.filter((entry) => entry.event === "provider_response_received");
    const finished = eventPayloads.filter((entry) => entry.event === "manual_refresh_category_finished");
    assert.deepEqual(started.map((entry) => entry.category).sort(), ["economic", "geopolitical"]);
    assert.deepEqual(received.map((entry) => entry.category).sort(), ["economic", "geopolitical"]);
    assert.deepEqual(finished.map((entry) => entry.category).sort(), ["economic", "geopolitical"]);
    assert.ok(finished.every((entry) => entry.finalOutcome === "refresh_succeeded"));
    assert.ok(finished.every((entry) => entry.requestId === "manual-parallel-001" && entry.refreshId && entry.invocationStartedAt && entry.providerStartedAt && entry.providerEndedAt));
    assert.ok(finished.every((entry) => entry.httpStatus === 200 && entry.rawArticleCount === 1 && entry.filteredArticleCount === 1 && entry.cacheWriteSucceeded === true));
    assert.ok(!gdeltFetches.some(({ url }) => url.searchParams.get("format") === "rss"), "valid JSON must not trigger RSS fallback");
    assert.ok(response.payload.geopoliticalNews.items.some((item) => item.available), "manual result must include completed GDELT articles");

    console.info = originalInfo;
    console.log(JSON.stringify({ passed: true, gdeltRequestCount: gdeltFetches.length, elapsedMs, categories: finished.map((entry) => entry.category).sort(), finalOutcomes: finished.map((entry) => entry.finalOutcome) }, null, 2));
  } finally {
    console.info = originalInfo;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
