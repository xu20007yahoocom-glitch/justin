import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSettings, saveSettings, WhatsAppSettings } from "../../lib/notifications";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body: any = req.body;
    if (typeof body === "string") body = JSON.parse(body);

    const { mode, telegramBotToken, telegramChatId } = body || {};
    const current = getSettings();

    let finalTgToken = telegramBotToken;
    if (telegramBotToken === "******") {
      finalTgToken = current.telegramBotToken;
    }

    const updated: WhatsAppSettings = {
      mode: mode || current.mode,
      telegramBotToken: finalTgToken !== undefined ? finalTgToken : current.telegramBotToken,
      telegramChatId: telegramChatId !== undefined ? telegramChatId : current.telegramChatId
    };

    saveSettings(updated);
    return res.status(200).json({
      success: true,
      settings: {
        ...updated,
        telegramBotToken: updated.telegramBotToken ? "******" : ""
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
