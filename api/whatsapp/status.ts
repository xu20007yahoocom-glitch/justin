import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSettings, getLogs, FIFTEEN_MINUTES_MS } from "../../lib/notifications";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const settings = getSettings();
  const logs = getLogs();
  return res.status(200).json({
    logs,
    config: {
      mode: settings.mode,
      telegramBotToken: settings.telegramBotToken ? "******" : "",
      telegramChatId: settings.telegramChatId || "",
      intervalMs: FIFTEEN_MINUTES_MS
    }
  });
}
