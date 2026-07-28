import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchAllStocks } from "../../lib/stocksData.js";
import { sendWhatsAppMessage, getDashboardUrl } from "../../lib/notifications.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const quotes = await fetchAllStocks("1d");

    let messageBody = `🔔 *Stock Tracker Manual Test Alert* 🔔\n`;
    messageBody += `Time: ${new Date().toLocaleString()}\n\n`;

    quotes.forEach(q => {
      const isPos = q.change >= 0;
      const arrow = isPos ? "🔺" : "🔻";
      const sign = isPos ? "+" : "";
      messageBody += `*${q.symbol}*: $${q.price.toFixed(2)} (${arrow} ${sign}${q.changePercent.toFixed(2)}%)\n`;
    });

    messageBody += `\n🔗 Live Dashboard:\n${getDashboardUrl()}`;

    const result = await sendWhatsAppMessage(messageBody);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
