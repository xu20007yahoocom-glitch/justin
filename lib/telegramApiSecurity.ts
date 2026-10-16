import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_REQUEST_BYTES = 8 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_RATE_LIMIT_ENTRIES = 5_000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function setNoStoreHeaders(res: VercelResponse): void {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export function sendSecurityError(
  res: VercelResponse,
  status: number,
  code: string,
  message: string,
) {
  setNoStoreHeaders(res);
  return res.status(status).json({ error: { code, message } });
}

export function validateRequestMethod(
  req: VercelRequest,
  res: VercelResponse,
  method: string,
): boolean {
  setNoStoreHeaders(res);
  if (req.method === method) return true;

  res.setHeader("Allow", method);
  sendSecurityError(res, 405, "METHOD_NOT_ALLOWED", "不支援此請求方式。");
  return false;
}

export function validateRequestSize(req: VercelRequest, res: VercelResponse): boolean {
  const contentLength = req.headers["content-length"];
  const declaredLength = Array.isArray(contentLength) ? contentLength[0] : contentLength;
  let tooLarge = declaredLength !== undefined
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_REQUEST_BYTES);

  if (!tooLarge && Buffer.byteLength(req.url || "", "utf8") > MAX_REQUEST_BYTES) {
    tooLarge = true;
  }

  if (!tooLarge && req.body !== undefined && req.body !== null) {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(
        typeof req.body === "string" ? req.body : JSON.stringify(req.body),
      );
      tooLarge = body.byteLength > MAX_REQUEST_BYTES;
    } catch {
      tooLarge = true;
    }
  }

  if (tooLarge) {
    sendSecurityError(res, 413, "REQUEST_TOO_LARGE", "請求內容過大。");
    return false;
  }
  return true;
}

// Instance-local temporary protection only; this is not a production per-user or distributed rate limit.
export function enforceRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  route: string,
): boolean {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = typeof forwardedFor === "string"
    ? forwardedFor.split(",").at(-1)?.trim()
    : undefined;
  const key = `${(ip || req.socket.remoteAddress || "unknown").slice(0, 64)}:${route}`;
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);

  if (bucket && bucket.resetAt <= now) {
    rateLimitBuckets.delete(key);
    bucket = undefined;
  }

  if (!bucket) {
    for (const [bucketKey, value] of rateLimitBuckets) {
      if (value.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
    if (rateLimitBuckets.size >= MAX_RATE_LIMIT_ENTRIES) {
      sendSecurityError(res, 503, "RATE_LIMIT_CAPACITY", "目前無法處理請求，請稍後再試。");
      return false;
    }
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;

  if (bucket.count <= RATE_LIMIT_MAX_REQUESTS) return true;
  res.setHeader("Retry-After", "60");
  sendSecurityError(res, 429, "RATE_LIMITED", "請求過於頻繁，請稍後再試。");
  return false;
}

export function sendDeprecatedTelegramResponse(res: VercelResponse, replacementPath?: string) {
  setNoStoreHeaders(res);
  const migrationHint = replacementPath ? `請改用 ${replacementPath}；` : "";
  return res.status(410).json({
    error: {
      code: "DEPRECATED",
      message: `${migrationHint}此功能仍受安全限制，安全登入系統完成前暫停使用。`,
    },
  });
}
