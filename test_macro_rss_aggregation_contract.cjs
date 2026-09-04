const assert = require("node:assert/strict");

const handler = require("./.tmp-macro-handler.cjs").default;

const RSS_ENDPOINTS = {
  "feeds.bbci.co.uk/news/world/rss.xml": "BBC News",
  "news.un.org/feed/subscribe/en/news/all/rss.xml": "UN News",
  "feeds.bbci.co.uk/news/business/rss.xml": "BBC News",
  "www.federalreserve.gov/feeds/press_all.xml": "Federal Reserve",
  "www.ecb.europa.eu/rss/press.html": "European Central Bank"
};

function recorder() {
  const headers = new Map();
  let statusCode = 0;
  let body = null;
  return {
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
    result() { return { headers, statusCode, body }; }
  };
}

async function invoke(query, requestId) {
  const res = recorder();
  await handler({ method: "GET", query, headers: { "x-macro-request-id": requestId } }, res);
  return res.result();
}

function xml(items) {
  return `<?xml version="1.0"?><rss><channel>${items.map((item) => `<item><title>${item.title}</title><link>${item.url}</link><pubDate>${item.date}</pubDate>${item.description ? `<description>${item.description}</description>` : ""}</item>`).join("")}</channel></rss>`;
}

function items(prefix, dates, shared = false) {
  return dates.map((date, index) => ({ title: `${prefix} headline ${index + 1}`, url: shared && index === 0 ? "https://example.test/shared" : `https://example.test/${prefix.toLowerCase().replace(/\s+/g, "-")}/${index + 1}`, date, description: index % 2 === 0 ? `${prefix} optional description` : "" }));
}

const feeds = {
  "feeds.bbci.co.uk/news/world/rss.xml": xml(items("BBC World", ["Thu, 04 Sep 2026 12:00:00 GMT", "Thu, 04 Sep 2026 09:00:00 GMT", "Wed, 03 Sep 2026 12:00:00 GMT"], true)),
  "news.un.org/feed/subscribe/en/news/all/rss.xml": xml(items("UN", ["Thu, 04 Sep 2026 11:00:00 GMT", "Thu, 04 Sep 2026 08:00:00 GMT", "Wed, 03 Sep 2026 08:00:00 GMT"], true)),
  "feeds.bbci.co.uk/news/business/rss.xml": xml(items("BBC Business", ["Thu, 04 Sep 2026 13:00:00 GMT", "Thu, 04 Sep 2026 10:00:00 GMT", "Wed, 03 Sep 2026 13:00:00 GMT"])),
  "www.federalreserve.gov/feeds/press_all.xml": xml(items("Fed", ["Thu, 04 Sep 2026 12:30:00 GMT", "Thu, 04 Sep 2026 09:30:00 GMT", "Wed, 03 Sep 2026 12:30:00 GMT"])),
  "www.ecb.europa.eu/rss/press.html": xml(items("ECB", ["Thu, 04 Sep 2026 12:15:00 GMT", "Thu, 04 Sep 2026 09:15:00 GMT", "Wed, 03 Sep 2026 12:15:00 GMT"]))
};

function miningFeed() {
  return xml([{ title: "Lithium market update", url: "https://example.test/mining/lithium", date: "Thu, 04 Sep 2026 11:30:00 GMT", description: "mining" }]);
}

async function main() {
  delete process.env.FRED_API_KEY;
  delete process.env.EIA_API_KEY;
  const originalFetch = global.fetch;
  const originalInfo = console.info;
  const logs = [];
  const requests = [];
  let failEcb = false;
  console.info = (...args) => logs.push(args);
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "www.mining.com") return new Response(miningFeed(), { status: 200, headers: { "content-type": "application/rss+xml" } });
    const key = `${url.hostname}${url.pathname}`;
    const provider = RSS_ENDPOINTS[key];
    assert.ok(provider, `unexpected endpoint: ${url}`);
    assert.equal(init.cache, "no-store", "all source requests must bypass HTTP cache");
    assert.ok(init.signal, "all source requests must carry AbortSignal");
    requests.push({ key, provider });
    if (failEcb && key === "www.ecb.europa.eu/rss/press.html") return new Response("temporarily unavailable", { status: 503, headers: { "content-type": "text/plain" } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    return new Response(feeds[key], { status: 200, headers: { "content-type": "application/rss+xml" } });
  };

  try {
    const startedAt = Date.now();
    const first = await invoke({ refresh: "1" }, "rss-success-001");
    const elapsedMs = Date.now() - startedAt;
    assert.equal(first.statusCode, 200);
    assert.equal(requests.length, 5, "one manual refresh must request each configured RSS endpoint exactly once");
    assert.ok(elapsedMs < 1_000, `five source fetches must run in parallel, got ${elapsedMs}ms`);
    const news = first.body.geopoliticalNews.items;
    const geopolitical = news.filter((item) => item.note.includes("类别：地缘政治新闻"));
    const economic = news.filter((item) => item.note.includes("类别：经济相关新闻"));
    assert.equal(geopolitical.length, 5, "geopolitical aggregate must be URL-deduped and limited to five");
    assert.equal(economic.length, 5, "economic aggregate must be limited to five");
    assert.ok(geopolitical.every((item) => ["BBC News", "UN News"].includes(item.source.provider) && item.source.url.startsWith("https://example.test/")));
    assert.ok(economic.every((item) => ["BBC News", "Federal Reserve", "European Central Bank"].includes(item.source.provider) && item.source.url.startsWith("https://example.test/")));
    assert.ok([...geopolitical, ...economic].every((item) => item.dataTime && item.label && item.cacheUpdatedAt && item.available));
    assert.ok(!JSON.stringify(first.body.geopoliticalNews).includes("GDELT DOC 2.0"), "production macro response must not label RSS articles as GDELT");
    const firstRequestIds = logs.filter(([tag, entry]) => tag === "MACRO_RSS_DIAGNOSTIC" && entry.requestId === "rss-success-001" && entry.event === "provider_response_received");
    assert.equal(firstRequestIds.length, 5, "each RSS endpoint must emit a response diagnostic");
    assert.ok(firstRequestIds.every(([, entry]) => entry.httpStatus === 200 && entry.rawCount > 0 && entry.parsedCount > 0 && entry.filteredCount > 0 && entry.elapsedMs >= 0), JSON.stringify(firstRequestIds.map(([, entry]) => ({ provider: entry.provider, httpStatus: entry.httpStatus, rawCount: entry.rawCount, parsedCount: entry.parsedCount, filteredCount: entry.filteredCount, elapsedMs: entry.elapsedMs, errorCategory: entry.errorCategory }))));

    failEcb = true;
    requests.length = 0;
    const partial = await invoke({ refresh: "1" }, "rss-partial-002");
    assert.equal(partial.statusCode, 200);
    assert.equal(requests.length, 5, "force refresh still attempts each independent source once");
    const partialEconomic = partial.body.geopoliticalNews.items.filter((item) => item.note.includes("类别：经济相关新闻"));
    assert.equal(partialEconomic.length, 5, "a failed ECB source must not empty the economic category");
    assert.ok(partialEconomic.some((item) => item.note.includes("部分来源更新失败（1）")), "successful items must expose the partial-source condition");
    assert.equal(partial.headers.get("x-macro-refresh-status"), "partial");
    const partialLogs = logs.filter(([tag, entry]) => tag === "MACRO_RSS_DIAGNOSTIC" && entry.requestId === "rss-partial-002" && entry.provider === "European Central Bank");
    assert.ok(partialLogs.some(([, entry]) => entry.httpStatus === 503 && entry.errorCategory === "http_5xx"));
    console.info = originalInfo;
    console.log(JSON.stringify({ passed: true, manualFetchesPerRound: 5, geopoliticalDisplayCount: geopolitical.length, economicDisplayCount: economic.length, firstElapsedMs: elapsedMs, sources: [...new Set([...geopolitical, ...economic].map((item) => item.source.provider))].sort(), partialStatus: partial.headers.get("x-macro-refresh-status") }, null, 2));
  } finally {
    global.fetch = originalFetch;
    console.info = originalInfo;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
