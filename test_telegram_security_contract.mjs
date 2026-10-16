import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let assertionCount = 0;

function check(condition, message) {
  assertionCount += 1;
  assert.ok(condition, message);
}

function checkEqual(actual, expected, message) {
  check(Object.is(actual, expected), message);
}

function responseRecorder() {
  const headers = new Map();
  let statusCode = 0;
  let payload;
  return {
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    snapshot() { return { headers, statusCode, payload }; },
  };
}

function makeRequest(method, route, ip, body) {
  const headers = { "x-forwarded-for": ip };
  return {
    method,
    url: route,
    headers,
    body,
    socket: { remoteAddress: ip },
  };
}

async function invoke(handler, method, route, ip, body) {
  const response = responseRecorder();
  await handler(makeRequest(method, route, ip, body), response);
  return response.snapshot();
}

function assertNoStore(response, label) {
  check(
    /^private,\s*no-store(?:,|$)/i.test(response.headers.get("cache-control") || ""),
    `${label}: response must use private, no-store cache policy`,
  );
}

function assertErrorEnvelope(response, status, code, label) {
  checkEqual(response.statusCode, status, `${label}: unexpected HTTP status`);
  check(
    Object.keys(response.payload || {}).sort().join(",") === "error",
    `${label}: response must contain only the generic error envelope`,
  );
  const error = response.payload?.error;
  check(
    Boolean(error) && Object.keys(error).sort().join(",") === "code,message",
    `${label}: error envelope must use the shared code/message format`,
  );
  checkEqual(error?.code, code, `${label}: unexpected error code`);
  assertNoStore(response, label);
}

function assertSafeErrorText(response, label) {
  const text = JSON.stringify(response.payload);
  const valuePatterns = [
    /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/,
    /(?:^|[^\d])-?\d{7,}(?:$|[^\d])/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /(?:DATABASE_URL|AUTH_SECRET|SESSION_SECRET|ENCRYPTION_KEY)\s*[:=]\s*[^\s"']+/i,
  ];
  check(
    valuePatterns.every((pattern) => !pattern.test(text)),
    `${label}: response must not contain recognizable credential or secret values`,
  );
}

async function compileModule(build, tempDirectory, relativePath, name) {
  const outputPath = path.join(tempDirectory, `${name}.cjs`);
  await build({
    entryPoints: [path.join(root, relativePath)],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    outfile: outputPath,
    logLevel: "silent",
  });
  return require(outputPath).default;
}

async function compileHelper(build, tempDirectory) {
  const outputPath = path.join(tempDirectory, "telegram-security-helper.cjs");
  await build({
    entryPoints: [path.join(root, "lib/telegramApiSecurity.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    outfile: outputPath,
    logLevel: "silent",
  });
  return require(outputPath);
}

function readNumericConstant(source, name) {
  const match = source.match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*(\\d(?:_?\\d)*)\\s*;?`));
  check(Boolean(match), `security helper must define ${name}`);
  const value = Number(match[1].replace(/_/g, ""));
  check(Number.isSafeInteger(value), `${name} must be a safe integer`);
  check(value > 0, `${name} must be positive`);
  return value;
}

async function runContract() {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "telegram-security-contract-"));
  const originalFetch = globalThis.fetch;
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  let fetchCalls = 0;
  let handlerLogCalls = 0;
  let result;

  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("Network access is disabled in this contract test.");
  };
  for (const method of Object.keys(originalConsole)) {
    console[method] = () => { handlerLogCalls += 1; };
  }

  try {
    const handlers = {
      legacyStatus: await compileModule(build, tempDirectory, "api/whatsapp/status.ts", "legacy-status"),
      legacySettings: await compileModule(build, tempDirectory, "api/whatsapp/settings.ts", "legacy-settings"),
      legacyTest: await compileModule(build, tempDirectory, "api/whatsapp/test.ts", "legacy-test"),
      status: await compileModule(build, tempDirectory, "api/telegram/status.ts", "status"),
      settings: await compileModule(build, tempDirectory, "api/telegram/settings.ts", "settings"),
      test: await compileModule(build, tempDirectory, "api/telegram/test.ts", "test"),
      logs: await compileModule(build, tempDirectory, "api/telegram/logs.ts", "logs"),
    };
    const helper = await compileHelper(build, tempDirectory);

    const legacyRoutes = [
      [handlers.legacyStatus, "/api/telegram/status", "legacy status"],
      [handlers.legacySettings, "/api/telegram/settings", "legacy settings"],
      [handlers.legacyTest, "/api/telegram/test", "legacy test"],
    ];
    for (const [index, [handler, replacementPath, label]] of legacyRoutes.entries()) {
      const response = await invoke(handler, "GET", "/api/whatsapp/legacy", `198.51.100.${index + 1}`);
      assertErrorEnvelope(response, 410, "DEPRECATED", label);
      check(
        response.payload.error.message.includes(replacementPath),
        `${label}: response must name its replacement route`,
      );
      check(
        response.payload.error.message.includes("受安全限制"),
        `${label}: response must state that the feature remains security-restricted`,
      );
      check(
        !/已啟用|已可使用|正常使用/.test(response.payload.error.message),
        `${label}: response must not claim the replacement is available`,
      );
      assertSafeErrorText(response, label);
    }

    const protectedRoutes = [
      [handlers.status, "GET", "POST", "/api/telegram/status", "status", "安全登入系統尚未完成，Telegram 通知功能暫時停用。"],
      [handlers.settings, "POST", "GET", "/api/telegram/settings", "settings", "安全登入系統尚未完成，Telegram 通知功能暫時停用。"],
      [handlers.test, "POST", "GET", "/api/telegram/test", "test", "安全登入系統尚未完成，Telegram 測試發送功能暫時停用。"],
      [handlers.logs, "GET", "POST", "/api/telegram/logs", "logs", "安全登入與使用者資料隔離尚未完成，Telegram 通知記錄暫時無法使用。"],
    ];
    const genericErrorCodes = new Set();

    for (const [index, [handler, allowedMethod, wrongMethod, route, label, expectedMessage]] of protectedRoutes.entries()) {
      const response = await invoke(handler, allowedMethod, route, `203.0.113.${index + 1}`);
      assertErrorEnvelope(response, 503, "AUTHENTICATION_UNAVAILABLE", label);
      checkEqual(response.payload.error.message, expectedMessage, `${label}: response must be a generic unavailable message`);
      check(!Object.hasOwn(response.payload, "success"), `${label}: response must not suggest a successful operation`);
      assertSafeErrorText(response, label);
      genericErrorCodes.add(response.payload.error.code);

      const rejected = await invoke(handler, wrongMethod, route, `203.0.113.${index + 11}`);
      assertErrorEnvelope(rejected, 405, "METHOD_NOT_ALLOWED", `${label} wrong method`);
      checkEqual(rejected.headers.get("allow"), allowedMethod, `${label}: Allow header must name the permitted method`);
      checkEqual(rejected.payload.error.message, "不支援此請求方式。", `${label}: wrong method response must be generic`);
    }
    checkEqual(genericErrorCodes.size, 1, "all fail-closed endpoint errors must share one error code");

    for (const [index, [handler, route, label]] of [
      [handlers.settings, "/api/telegram/settings", "settings oversized body"],
      [handlers.test, "/api/telegram/test", "test oversized body"],
    ].entries()) {
      const oversized = await invoke(
        handler,
        "POST",
        route,
        `192.0.2.${index + 1}`,
        "x".repeat(8 * 1024 + 1),
      );
      assertErrorEnvelope(oversized, 413, "REQUEST_TOO_LARGE", label);
      checkEqual(oversized.payload.error.message, "請求內容過大。", `${label}: response must not echo request data`);
    }

    const statusRateLimitIp = "192.0.2.20";
    let statusRateLimitResponsesAreSafe = true;
    for (let index = 0; index < 30; index += 1) {
      const response = await invoke(handlers.status, "GET", "/api/telegram/status", statusRateLimitIp);
      statusRateLimitResponsesAreSafe &&= response.statusCode === 503;
    }
    check(statusRateLimitResponsesAreSafe, "status route must allow the configured per-key request limit");
    const statusRateLimited = await invoke(handlers.status, "GET", "/api/telegram/status", statusRateLimitIp);
    assertErrorEnvelope(statusRateLimited, 429, "RATE_LIMITED", "status rate limit");

    const helperSource = readFileSync(path.join(root, "lib/telegramApiSecurity.ts"), "utf8");
    check(/function validateRequestSize\(/.test(helperSource), "security helper must provide a request body size guard");
    check(/MAX_REQUEST_BYTES/.test(helperSource) && /Buffer\.byteLength/.test(helperSource), "body size guard must enforce a byte limit");
    check(/RATE_LIMIT_MAX_REQUESTS/.test(helperSource), "security helper must define a per-key request limit");
    check(/MAX_RATE_LIMIT_ENTRIES/.test(helperSource), "security helper must define a separate total map capacity");
    check(/rateLimitBuckets\.size\s*>=\s*MAX_RATE_LIMIT_ENTRIES/.test(helperSource), "new keys must be rejected when the map is full");
    check(/value\.resetAt\s*<=\s*now/.test(helperSource), "rate-limit logic must clean expired entries");

    const capacity = readNumericConstant(helperSource, "MAX_RATE_LIMIT_ENTRIES");
    const perKeyLimit = readNumericConstant(helperSource, "RATE_LIMIT_MAX_REQUESTS");
    let currentTime = Date.now();
    const realDateNow = Date.now;
    Date.now = () => currentTime;
    try {
      let admittedCount = 0;
      for (let index = 0; index < capacity; index += 1) {
        const ip = `198.51.${Math.floor(index / 256)}.${index % 256}`;
        const response = responseRecorder();
        const allowed = helper.enforceRateLimit(
          makeRequest("GET", "/api/telegram/status", ip),
          response,
          "/api/telegram/status",
        );
        if (allowed) admittedCount += 1;
      }
      checkEqual(admittedCount, capacity, "helper must admit new keys until the configured capacity is reached");

      const fullMapResponse = responseRecorder();
      const newKeyAllowed = helper.enforceRateLimit(
        makeRequest("GET", "/api/telegram/status", "203.0.113.250"),
        fullMapResponse,
        "/api/telegram/status",
      );
      check(!newKeyAllowed, "helper must fail closed for a new key when the map is full");
      assertErrorEnvelope(fullMapResponse.snapshot(), 503, "RATE_LIMIT_CAPACITY", "full rate-limit map");

      let existingKeyRequestsAllowed = true;
      const existingIp = "198.51.0.1";
      for (let index = 1; index < perKeyLimit; index += 1) {
        const response = responseRecorder();
        existingKeyRequestsAllowed &&= helper.enforceRateLimit(
          makeRequest("GET", "/api/telegram/status", existingIp),
          response,
          "/api/telegram/status",
        );
      }
      check(existingKeyRequestsAllowed, "existing active key must retain its original request count at capacity");
      const existingKeyLimitResponse = responseRecorder();
      const existingKeyAllowed = helper.enforceRateLimit(
        makeRequest("GET", "/api/telegram/status", existingIp),
        existingKeyLimitResponse,
        "/api/telegram/status",
      );
      check(!existingKeyAllowed, "existing active key must not be reset to bypass its request limit");
      assertErrorEnvelope(existingKeyLimitResponse.snapshot(), 429, "RATE_LIMITED", "existing key at capacity");

      currentTime += 60_001;
      const afterExpiryResponse = responseRecorder();
      const allowedAfterExpiry = helper.enforceRateLimit(
        makeRequest("GET", "/api/telegram/status", "203.0.113.251"),
        afterExpiryResponse,
        "/api/telegram/status",
      );
      check(allowedAfterExpiry, "expired entries must be cleared before admitting a new key");
    } finally {
      Date.now = realDateNow;
    }

    const frontend = readFileSync(path.join(root, "src/components/WhatsAppNotifications.tsx"), "utf8");
    check(!/<input\b/i.test(frontend), "frontend must not render credential input controls");
    check(!/telegramBotToken|telegramChatId/i.test(frontend), "frontend must not hold credential values in component state");
    check(!/localStorage|sessionStorage/.test(frontend), "frontend must not store credentials in browser storage");
    check(!/\bfetch\s*\(/.test(frontend), "frontend must not make notification network requests");
    check(
      !/\/api\/(?:whatsapp\/(?:status|settings|test)|telegram\/(?:settings|test|logs))/.test(frontend),
      "frontend must not call disabled Telegram or legacy notification endpoints",
    );
    check(frontend.includes("Telegram 通知設定暫時停用"), "frontend must show the required disabled-state message");
    check(!/測試成功|测试成功|發送成功|发送成功/.test(frontend), "frontend must not simulate a successful test send");

    checkEqual(fetchCalls, 0, "no handler may attempt a network request");
    checkEqual(handlerLogCalls, 0, "handlers must not log request contents or sensitive data");
    result = { assertionCount, summary: "legacy routes, fail-closed APIs, helper limits, and frontend contract passed" };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [method, original] of Object.entries(originalConsole)) console[method] = original;
    rmSync(tempDirectory, { recursive: true, force: true });
  }

  return result;
}

runContract()
  .then(({ assertionCount: count, summary }) => {
    console.log(JSON.stringify({ passed: true, assertionCount: count, summary }));
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown contract failure";
    console.error(`Telegram security contract failed: ${message}`);
    process.exitCode = 1;
  });
