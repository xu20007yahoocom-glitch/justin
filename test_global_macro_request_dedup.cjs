const assert = require("node:assert/strict");
const { loadSharedGlobalMacro } = require("./.tmp-global-macro-request.cjs");

async function main() {
  const calls = [];
  global.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response(JSON.stringify({ available: true, generatedAt: "2026-09-04T00:00:00.000Z" }), {
      status: 200,
      headers: { "content-type": "application/json", "x-macro-refresh-status": "updated" }
    });
  };

  const [first, second, third] = await Promise.all([
    loadSharedGlobalMacro(),
    loadSharedGlobalMacro(),
    loadSharedGlobalMacro()
  ]);
  assert.equal(calls.length, 1, "concurrent normal page loads must share one HTTP request");
  assert.equal(calls[0].url, "/api/global/macro");
  assert.equal(first.data, second.data, "all normal callers must share the same response object");
  assert.equal(second.data, third.data);
  assert.ok(calls[0].init.headers["X-Macro-Request-Id"]);

  const [manualFirst, manualSecond] = await Promise.all([
    loadSharedGlobalMacro(true),
    loadSharedGlobalMacro(true)
  ]);
  assert.equal(calls.length, 2, "concurrent manual clicks must share one additional HTTP request");
  assert.match(calls[1].url, /^\/api\/global\/macro\?refresh=1&t=\d+$/);
  assert.equal(calls[1].init.cache, "no-store");
  assert.equal(calls[1].init.headers["Cache-Control"], "no-cache");
  assert.ok(calls[1].init.headers["X-Macro-Request-Id"]);
  assert.equal(manualFirst.data, manualSecond.data, "all manual callers must share the same response object");

  const cached = await loadSharedGlobalMacro();
  assert.equal(calls.length, 2, "a later normal read in the same page lifetime must reuse the latest response");
  assert.equal(cached.data, manualFirst.data);
  console.log(JSON.stringify({ passed: true, normalRequestCount: 1, manualRequestCount: 1, totalHttpRequests: calls.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
