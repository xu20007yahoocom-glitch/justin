import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  enforceRateLimit,
  sendSecurityError,
  validateRequestMethod,
} from "../../lib/telegramApiSecurity.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateRequestMethod(req, res, "GET")) return res;
  if (!enforceRateLimit(req, res, "/api/telegram/logs")) return res;

  return sendSecurityError(
    res,
    503,
    "AUTHENTICATION_UNAVAILABLE",
    "安全登入與使用者資料隔離尚未完成，Telegram 通知記錄暫時無法使用。",
  );
}
