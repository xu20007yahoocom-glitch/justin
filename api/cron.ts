import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchAllStocks } from "../lib/stocksData";
import { sendWhatsAppMessage } from "../lib/notifications";

/**
 * Scheduled stock scrape + Telegram broadcast, triggered by Vercel Cron
 * (see vercel.json). NOTE: Vercel Hobby plan cron jobs can only run once
 * per day (not every 15 minutes) — see vercel.json comment for details.
 * Upgrade to Vercel Pro to run this on a tighter schedule (e.g. every 15
 * minutes) if real-time alerts are required.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Protect against unauthenticated public triggering when CRON_SECRET is set.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers?.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  console.log("Vercel Cron triggered: scraping stocks and broadcasting via Telegram...");

  try {
    const quotes = await fetchAllStocks("1d");

    let messageBody = `📈 *Stock Tracker Scheduled Alert* 📈\n`;
    messageBody += `Time: ${new Date().toLocaleString()}\n\n`;

    quotes.forEach(q => {
      const isPos = q.change >= 0;
      const arrow = isPos ? "🔺" : "🔻";
      const sign = isPos ? "+" : "";
      messageBody += `*${q.symbol}*: $${q.price.toFixed(2)} (${arrow} ${sign}${q.changePercent.toFixed(2)}%)\n`;
      messageBody += `Range: $${q.low.toFixed(1)} - $${q.high.toFixed(1)}\n\n`;
    });

    messageBody += `🔗 Live Dashboard:\n${process.env.APP_URL || ""}`;

    const result = await sendWhatsAppMessage(messageBody);
    return res.status(200).json({ success: true, timestamp: new Date().toISOString(), notification: result });
  } catch (error: any) {
    console.error("Scheduled scrape failed:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
