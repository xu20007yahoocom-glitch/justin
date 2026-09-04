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
  return `<?xml version="1.0"?><rss><channel><item><title>Lithium market update</title><link>https://example.test/lithium</link></item></channel></rss>`;
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
    assert.equal(url.hostname, "api.gdeltproject.org");
    gdeltFetches.push({ url, init });
    return new Response("rate limited", { status: 429, headers: { "content-type": "text/plain", "retry-after": "60" } });
  };

  try {
    const res = responseRecorder();
    await handler({ method: "GET", query: { refresh: "1" } }, res);
    const response = res.snapshot();
    assert.equal(response.statusCode, 200, "429 must remain a graceful HTTP 200 macro response");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(gdeltFetches.length, 1, "429 must not trigger a JSON retry or RSS fallback");
    assert.equal(gdeltFetches[0].url.searchParams.get("query"), "geopolitics");
    assert.equal(gdeltFetches[0].url.searchParams.get("format"), "json");
    assert.equal(gdeltFetches[0].init.cache, "no-store");
    const events = diagnostics.filter(([tag]) => tag === "GDELT_DIAGNOSTIC").map(([, payload]) => payload);
    const started = events.filter((entry) => entry.event === "provider_request_started");
    const received = events.filter((entry) => entry.event === "provider_response_received");
    const finished = events.filter((entry) => entry.event === "manual_refresh_category_finished");
    assert.deepEqual(started.map((entry) => entry.category), ["geopolitical"]);
    assert.deepEqual(received.map((entry) => entry.category), ["geopolitical"]);
    assert.deepEqual(finished.map((entry) => entry.category).sort(), ["economic", "geopolitical"]);
    assert.ok(finished.every((entry) => entry.finalOutcome === "refresh_rate_limited"));
    assert.ok(events.every((entry) => entry.outcome !== "refresh_started"));
    console.info = originalInfo;
    console.log(JSON.stringify({ passed: true, gdeltRequestCount: gdeltFetches.length, startedCategories: started.map((entry) => entry.category), receivedCategories: received.map((entry) => entry.category), finalCategories: finished.map((entry) => entry.category).sort(), finalOutcomes: finished.map((entry) => entry.finalOutcome) }, null, 2));
  } finally {
    console.info = originalInfo;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
