import type { VercelRequest, VercelResponse } from '@vercel/node';

// 复制 server.ts 中的 STOCKS_METADATA 与 fetchStockFromYahoo 函数逻辑
const STOCKS_METADATA: Record<string, { companyName: string; fallbackPrice: number }> = {
  UGI: { companyName: "UGI Corporation", fallbackPrice: 24.50 },
  LNG: { companyName: "Cheniere Energy, Inc.", fallbackPrice: 178.20 },
  DXCM: { companyName: "Dexcom, Inc.", fallbackPrice: 88.40 },
  PTEN: { companyName: "Patterson-UTI Energy, Inc.", fallbackPrice: 10.25 }
};

async function fetchStockFromYahoo(symbol: string, range: string = "1mo") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    if (!response.ok) throw new Error("Yahoo error");
    const data: any = await response.json();
    const result = data?.chart?.result?.[0];
    const price = result.meta.regularMarketPrice || STOCKS_METADATA[symbol].fallbackPrice;
    return { symbol, companyName: STOCKS_METADATA[symbol].companyName, price };
  } catch (err) {
    return { symbol, companyName: STOCKS_METADATA[symbol].companyName, price: STOCKS_METADATA[symbol].fallbackPrice };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const range = (req.query.range as string) || "1m";
  try {
    const promises = Object.keys(STOCKS_METADATA).map(symbol => fetchStockFromYahoo(symbol, range));
    const results = await Promise.all(promises);
    return res.status(200).json(results);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
