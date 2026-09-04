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

function miningRss() {
  return `<?xml version="1.0"?><rss><channel><item><title>Lithium market update</title><link>https://example.test/lithium</link><pubDate>Thu, 04 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
}

async function call(req) {
  const res = responseRecorder();
  await handler(req, res);
  return res.snapshot();
}

function abortError() {
  const error = new Error("controlled abort");
  error.name = "AbortError";
  return error;
}

function logsFor(diagnostics, requestId) {
  return diagnostics
    .filter(([tag, payload]) => tag === "GDELT_DIAGNOSTIC" && payload.requestId === requestId)
    .map(([, payload]) => payload);
}

async function replacementScenario() {
  delete process.env.FRED_API_KEY;
  delete process.env.EIA_API_KEY;
  const originalInfo = console.info;
  const diagnostics = [];
  let mode = "background";
  let initialGdeltFetches = 0;
  let manualGdeltFetches = 0;
  console.info = (...args) => diagnostics.push(args);
  global.fetch = (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "www.mining.com") return Promise.resolve(new Response(miningRss(), { status: 200, headers: { "content-type": "application/rss+xml" } }));
    assert.equal(url.hostname, "api.gdeltproject.org");
    if (mode === "background") {
      initialGdeltFetches += 1;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    }
    manualGdeltFetches += 1;
    const query = url.searchParams.get("query");
    return Promise.resolve(new Response(JSON.stringify({ articles: [{ title: `${query} fresh article`, url: `https://example.test/${query}`, seendate: "20260904T010203Z" }] }), { status: 200, headers: { "content-type": "application/json" } }));
  };

  try {
    const normal = await call({ method: "GET", headers: { "x-macro-request-id": "normal-background-001" }, query: {} });
    assert.equal(normal.statusCode, 200, "normal page request must stay graceful while background GDELT is pending");
    await new Promise((resolve) => setTimeout(resolve, 3_150));
    mode = "manual";
    const manual = await call({ method: "GET", headers: { "x-macro-request-id": "manual-replace-001" }, query: { refresh: "1" } });
    assert.equal(manual.statusCode, 200);
    assert.equal(manualGdeltFetches, 2, "manual refresh must replace old entries and issue one new request per category");
    const events = logsFor(diagnostics, "manual-replace-001");
    const replaced = events.filter((entry) => entry.event === "manual_refresh_category_replaced_in_flight");
    const finished = events.filter((entry) => entry.event === "manual_refresh_category_finished");
    assert.deepEqual(replaced.map((entry) => entry.category).sort(), ["economic", "geopolitical"]);
    assert.ok(replaced.every((entry) => entry.inFlightAgeMs >= 3_000 && entry.remainingMs < 9_000));
    assert.deepEqual(finished.map((entry) => entry.category).sort(), ["economic", "geopolitical"]);
    assert.ok(finished.every((entry) => entry.finalOutcome === "refresh_succeeded" && entry.httpStatus === 200 && entry.cacheWriteSucceeded === true && entry.providerStartedAt && entry.providerEndedAt));
    console.info = originalInfo;
    console.log(JSON.stringify({ passed: true, scenario: "replacement", initialGdeltFetches, manualGdeltFetches, replacedCategories: replaced.map((entry) => entry.category).sort(), finalOutcomes: finished.map((entry) => entry.finalOutcome) }, null, 2));
  } finally {
    console.info = originalInfo;
  }
}

async function networkScenario() {
  delete process.env.FRED_API_KEY;
  delete process.env.EIA_API_KEY;
  const originalInfo = console.info;
  const diagnostics = [];
  let gdeltFetches = 0;
  console.info = (...args) => diagnostics.push(args);
  global.fetch = (input) => {
    const url = new URL(String(input));
    if (url.hostname === "www.mining.com") return Promise.resolve(new Response(miningRss(), { status: 200, headers: { "content-type": "application/rss+xml" } }));
    assert.equal(url.hostname, "api.gdeltproject.org");
    gdeltFetches += 1;
    const cause = new Error("connect timed out to api.gdeltproject.org");
    cause.code = "UND_ERR_CONNECT_TIMEOUT";
    cause.family = 4;
    const error = new TypeError("fetch failed");
    error.cause = cause;
    return Promise.reject(error);
  };

  try {
    const response = await call({ method: "GET", headers: { "x-macro-request-id": "manual-network-001" }, query: { refresh: "1" } });
    assert.equal(response.statusCode, 200);
    assert.equal(gdeltFetches, 2, "each category must issue its own network request");
    const events = logsFor(diagnostics, "manual-network-001");
    const failed = events.filter((entry) => entry.event === "provider_request_failed");
    const finished = events.filter((entry) => entry.event === "manual_refresh_category_finished");
    assert.deepEqual(failed.map((entry) => entry.category).sort(), ["economic", "geopolitical"]);
    assert.ok(failed.every((entry) => entry.errorName === "TypeError" && entry.causeCode === "UND_ERR_CONNECT_TIMEOUT" && entry.networkPhase === "connect" && entry.addressFamily === 4 && entry.httpStatus === null));
    assert.ok(finished.every((entry) => entry.finalOutcome === "refresh_network_error" && entry.lastFailureStatus === "network_error" && entry.cooldownReason === "network_error" && entry.finalOutcome !== "refresh_rate_limited"));
    console.info = originalInfo;
    console.log(JSON.stringify({ passed: true, scenario: "network", gdeltFetches, errorCodes: failed.map((entry) => entry.causeCode), phases: failed.map((entry) => entry.networkPhase) }, null, 2));
  } finally {
    console.info = originalInfo;
  }
}

async function timeoutScenario() {
  delete process.env.FRED_API_KEY;
  delete process.env.EIA_API_KEY;
  const originalInfo = console.info;
  const diagnostics = [];
  let gdeltFetches = 0;
  let aborts = 0;
  console.info = (...args) => diagnostics.push(args);
  global.fetch = (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "www.mining.com") return Promise.resolve(new Response(miningRss(), { status: 200, headers: { "content-type": "application/rss+xml" } }));
    assert.equal(url.hostname, "api.gdeltproject.org");
    gdeltFetches += 1;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => { aborts += 1; reject(abortError()); }, { once: true });
    });
  };

  try {
    const startedAt = Date.now();
    const response = await call({ method: "GET", headers: { "x-macro-request-id": "manual-timeout-002" }, query: { refresh: "1" } });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(response.statusCode, 200);
    assert.equal(gdeltFetches, 2, "each manual category must make one fresh request");
    assert.equal(aborts, 2, "each hung provider fetch must be truly aborted at the provider deadline");
    assert.ok(elapsedMs >= 5_500 && elapsedMs < 8_500, `manual response should complete after the six-second provider aborts, got ${elapsedMs}ms`);
    const events = logsFor(diagnostics, "manual-timeout-002");
    const finished = events.filter((entry) => entry.event === "manual_refresh_category_finished");
    assert.deepEqual(finished.map((entry) => entry.category).sort(), ["economic", "geopolitical"]);
    assert.ok(finished.every((entry) => entry.finalOutcome === "refresh_cooldown" && entry.cooldownReason === "timeout" && entry.lastFailureStatus === "timeout" && entry.httpStatus === null && entry.cacheWriteSucceeded === false && entry.providerStartedAt && entry.providerEndedAt && entry.elapsedMs >= 5_500));
    assert.ok(finished.every((entry) => entry.finalOutcome !== "refresh_rate_limited"));
    console.info = originalInfo;
    console.log(JSON.stringify({ passed: true, scenario: "timeout", gdeltFetches, aborts, elapsedMs, finalOutcomes: finished.map((entry) => entry.finalOutcome), cooldownReasons: finished.map((entry) => entry.cooldownReason) }, null, 2));
  } finally {
    console.info = originalInfo;
  }
}

const scenario = process.argv[2];
if (scenario === "replacement") replacementScenario().catch((error) => { console.error(error); process.exitCode = 1; });
else if (scenario === "network") networkScenario().catch((error) => { console.error(error); process.exitCode = 1; });
else if (scenario === "timeout") timeoutScenario().catch((error) => { console.error(error); process.exitCode = 1; });
else { console.error("scenario must be replacement, network, or timeout"); process.exitCode = 1; }
