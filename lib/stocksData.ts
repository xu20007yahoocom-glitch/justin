/**
 * Shared stock-data fetching logic used by all Vercel serverless functions
 * under /api. Kept separate from server.ts (used by the Cloud Run / AI Studio
 * build) so both entry points can eventually share the same source of truth.
 */
import { StockQuote, HistoricalDataPoint } from "../src/types";

export const STOCKS_METADATA: Record<string, { companyName: string; fallbackPrice: number }> = {
  UGI: { companyName: "UGI Corporation", fallbackPrice: 24.50 },
  LNG: { companyName: "Cheniere Energy, Inc.", fallbackPrice: 178.20 },
  DXCM: { companyName: "Dexcom, Inc.", fallbackPrice: 88.40 },
  PTEN: { companyName: "Patterson-UTI Energy, Inc.", fallbackPrice: 10.25 }
};

export const STOCK_SYMBOLS = Object.keys(STOCKS_METADATA);

// Simple helper to generate fallback historical data if Yahoo Finance fails
function generateFallbackHistory(symbol: string, range: string): HistoricalDataPoint[] {
  const basePrice = STOCKS_METADATA[symbol]?.fallbackPrice || 100;
  const history: HistoricalDataPoint[] = [];
  const now = new Date();

  let points = 30;
  let intervalDays = 1;
  let isIntraday = false;

  if (range === "1d") {
    points = 24;
    isIntraday = true;
  } else if (range === "5d") {
    points = 20;
    intervalDays = 0.25;
  } else if (range === "1mo" || range === "30d" || range === "1m") {
    points = 30;
    intervalDays = 1;
  } else if (range === "6mo" || range === "6m") {
    points = 26;
    intervalDays = 7;
  } else if (range === "1y") {
    points = 52;
    intervalDays = 7;
  }

  let currentPrice = basePrice * (0.9 + Math.random() * 0.2);
  for (let i = points; i >= 0; i--) {
    const d = new Date(now.getTime() - i * intervalDays * 24 * 60 * 60 * 1000);
    let dateStr = "";
    if (isIntraday) {
      const hours = d.getHours().toString().padStart(2, "0");
      const minutes = d.getMinutes().toString().padStart(2, "0");
      dateStr = `${hours}:${minutes}`;
    } else {
      const month = (d.getMonth() + 1).toString().padStart(2, "0");
      const day = d.getDate().toString().padStart(2, "0");
      dateStr = `${month}/${day}`;
    }

    const changePercent = (Math.random() - 0.49) * 0.03;
    currentPrice = currentPrice * (1 + changePercent);
    history.push({
      date: dateStr,
      price: parseFloat(currentPrice.toFixed(2))
    });
  }

  return history;
}

// Fetch a single stock's full quote (price + history) from Yahoo Finance,
// falling back to deterministic-ish simulated data if the request fails.
export async function fetchStockFromYahoo(symbol: string, range: string = "1mo"): Promise<StockQuote> {
  let yahooRange = "1mo";
  let yahooInterval = "1d";

  if (range === "1d") {
    yahooRange = "1d";
    yahooInterval = "5m";
  } else if (range === "5d") {
    yahooRange = "5d";
    yahooInterval = "15m";
  } else if (range === "1m" || range === "1mo") {
    yahooRange = "1mo";
    yahooInterval = "1d";
  } else if (range === "6m" || range === "6mo") {
    yahooRange = "6mo";
    yahooInterval = "1d";
  } else if (range === "1y") {
    yahooRange = "1y";
    yahooInterval = "1d";
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${yahooRange}&interval=${yahooInterval}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} from Yahoo Finance`);
    }

    const data: any = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      throw new Error(`No chart result found for ${symbol}`);
    }

    const meta = result.meta;
    const timestamps: number[] = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const closePrices: (number | null)[] = quotes.close || [];
    const openPrices: (number | null)[] = quotes.open || [];
    const highPrices: (number | null)[] = quotes.high || [];
    const lowPrices: (number | null)[] = quotes.low || [];
    const volumes: (number | null)[] = quotes.volume || [];

    const price = meta.regularMarketPrice || closePrices[closePrices.length - 1] || STOCKS_METADATA[symbol].fallbackPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose || price;
    const change = price - prevClose;
    const changePercent = (change / prevClose) * 100;

    const history: HistoricalDataPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const p = closePrices[i];
      if (p === null || p === undefined) continue;

      const dateObj = new Date(timestamps[i] * 1000);
      let dateStr = "";
      if (range === "1d") {
        const hours = dateObj.getHours().toString().padStart(2, "0");
        const minutes = dateObj.getMinutes().toString().padStart(2, "0");
        dateStr = `${hours}:${minutes}`;
      } else {
        const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
        const day = dateObj.getDate().toString().padStart(2, "0");
        dateStr = `${month}/${day}`;
      }

      history.push({
        date: dateStr,
        price: parseFloat(p.toFixed(2))
      });
    }

    const highValues = highPrices.filter((x): x is number => x !== null);
    const lowValues = lowPrices.filter((x): x is number => x !== null);

    return {
      symbol,
      companyName: STOCKS_METADATA[symbol]?.companyName || symbol,
      price: parseFloat(price.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      open: parseFloat((meta.regularMarketOpen || openPrices[0] || price).toFixed(2)),
      high: parseFloat((meta.regularMarketDayHigh || (highValues.length ? Math.max(...highValues) : price)).toFixed(2)),
      low: parseFloat((meta.regularMarketDayLow || (lowValues.length ? Math.min(...lowValues) : price)).toFixed(2)),
      previousClose: parseFloat(prevClose.toFixed(2)),
      volume: meta.regularMarketVolume || volumes[volumes.length - 1] || 0,
      lastUpdated: new Date().toLocaleTimeString(),
      history
    };
  } catch (error) {
    console.error(`Error fetching ${symbol} from Yahoo:`, error);
    const fallbackHistory = generateFallbackHistory(symbol, range);
    const lastPrice = fallbackHistory[fallbackHistory.length - 1].price;
    const firstPrice = fallbackHistory[0].price;
    const change = lastPrice - firstPrice;
    const changePercent = (change / firstPrice) * 100;

    return {
      symbol,
      companyName: STOCKS_METADATA[symbol]?.companyName || symbol,
      price: lastPrice,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      open: fallbackHistory[0].price,
      high: parseFloat((lastPrice * 1.05).toFixed(2)),
      low: parseFloat((lastPrice * 0.95).toFixed(2)),
      previousClose: firstPrice,
      volume: Math.floor(Math.random() * 5000000) + 1000000,
      lastUpdated: `${new Date().toLocaleTimeString()} (Simulated)`,
      history: fallbackHistory
    };
  }
}

export async function fetchAllStocks(range: string): Promise<StockQuote[]> {
  return Promise.all(STOCK_SYMBOLS.map(symbol => fetchStockFromYahoo(symbol, range)));
}
