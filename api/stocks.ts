import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchAllStocks } from "../lib/stocksData.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const range = (req.query?.range as string) || "1m";
  try {
    const results = await fetchAllStocks(range);
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json(results);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to fetch stock data" });
  }
}
