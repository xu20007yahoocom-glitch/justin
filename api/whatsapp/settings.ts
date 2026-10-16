import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendDeprecatedTelegramResponse } from "../../lib/telegramApiSecurity.js";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  return sendDeprecatedTelegramResponse(res, "/api/telegram/settings");
}
