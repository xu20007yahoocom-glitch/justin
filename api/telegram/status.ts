import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  enforceRateLimit,
  sendSecurityError,
  validateRequestMethod,
} from "../../lib/telegramApiSecurity.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateRequestMethod(req, res, "GET")) return res;
  if (!enforceRateLimit(req, res, "/api/telegram/status")) return res;

  return sendSecurityError(
    res,
    503,
    "AUTHENTICATION_UNAVAILABLE",
    "安全登入系統尚未完成，Telegram 通知功能暫時停用。",
  );
}
