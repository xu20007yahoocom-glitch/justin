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
    snapshot() { return { statusCode, payload, headers }; }
  };
}

function successfulRss() {
  return `<?xml version="1.0"?><rss><channel><item><title>Lithium market update</title><link>https://example.test/lithium</link><pubDate>Thu, 04 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
}

async function call(req) {
  const res = responseRecorder();
  await handler(req, res);
  return res.snapshot();
}

async function main() {
  delete process.env.FRED_API_KEY;
  delete process.env.EIA_API_KEY;
  let miningCalls = 0;
  let macroRssCalls = 0;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes("mining.com/feed/")) {
      miningCalls += 1;
      if (miningCalls === 1) return new Response(successfulRss(), { status: 200, headers: { "content-type": "application/rss+xml" } });
      // Leave the second refresh pending: handler timeout must return the saved macro cache.
      return new Promise(() => {});
    }
    // Each of the five category-native RSS sources returns a controlled failure; none can block the API.
    macroRssCalls += 1;
    return new Response("unavailable", { status: 503, headers: { "content-type": "text/plain" } });
  };

  const req = { method: "GET", headers: { "x-macro-request-id": "manual-timeout-001" }, query: { refresh: "1" } };
  const primed = await call(req);
  assert.equal(primed.statusCode, 200, "initial manual refresh must stay HTTP 200");
  assert.equal(miningCalls, 1, "initial refresh must call the RSS provider once");
  assert.ok(primed.payload.criticalMinerals.news.some((item) => item.available), "controlled successful RSS must populate last-known-good cache");

  const startedAt = Date.now();
  const [first, second] = await Promise.all([call(req), call(req)]);
  const elapsedMs = Date.now() - startedAt;
  for (const result of [first, second]) {
    assert.equal(result.statusCode, 200, "timeout fallback must remain HTTP 200");
    assert.equal(result.headers.get("cache-control"), "private, no-store", "manual refresh responses cannot be cached");
    assert.ok(["partial", "updated", "gdelt_cooldown", "unavailable"].includes(result.headers.get("x-macro-refresh-status")), "manual refresh status must be explicit");
    assert.equal(result.payload.generatedAt, primed.payload.generatedAt, "timeout fallback must preserve the previous macro payload timestamp");
    assert.ok(result.payload.criticalMinerals.news.some((item) => item.available), "timeout fallback must retain previous successful news");
  }
  assert.equal(miningCalls, 2, "two concurrent requests must share one second-round macro refresh");
  assert.equal(macroRssCalls, 10, "two manual rounds must request each of the five independent RSS endpoints once");
  assert.ok(elapsedMs >= 7_500 && elapsedMs < 10_000, `manual wait should be about eight seconds, got ${elapsedMs}ms`);
  console.log(JSON.stringify({ passed: true, miningCalls, macroRssCalls, elapsedMs, statuses: [first.headers.get("x-macro-refresh-status"), second.headers.get("x-macro-refresh-status")] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
