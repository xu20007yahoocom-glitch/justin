import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fmpScreenerProvider } from "../../lib/providers/screener-fmp.js";

const DEFAULT_MIN_DOLLAR_VOLUME = 5_000_000;
const MAX_MIN_DOLLAR_VOLUME = 10_000_000_000_000;

function queryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function parseMinDollarVolume(value: string | null): number {
  if (!value) return DEFAULT_MIN_DOLLAR_VOLUME;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_MIN_DOLLAR_VOLUME) return DEFAULT_MIN_DOLLAR_VOLUME;
  return parsed;
}

function parseExchange(value: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,20}$/.test(normalized) ? normalized : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const minDollarVolume = parseMinDollarVolume(queryValue(req.query?.minDollarVolume));
  const exchange = parseExchange(queryValue(req.query?.exchange));
  const provider = (process.env.SCREENER_PROVIDER?.trim().toLowerCase() || "fmp") as "fmp" | "realtime";

  // A few-hour application cache exists in the provider. CDN cache is deliberately shorter so
  // invalidation still follows the serverless cache policy without multiplying FMP requests.
  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");

  if (provider === "realtime") {
    console.warn("Realtime screener provider is not implemented; returning an empty safe result");
    res.status(200).json({
      provider: "realtime",
      status: "TODO",
      minDollarVolume,
      exchange: exchange ?? null,
      asOf: new Date().toISOString(),
      isDelayed: true,
      items: []
    });
    return;
  }

  try {
    const items = await fmpScreenerProvider.scanByDollarVolume(minDollarVolume, { exchange });
    res.status(200).json({
      provider: "fmp",
      status: items.length > 0 ? "ok" : "unavailable_or_empty",
      minDollarVolume,
      exchange: exchange ?? null,
      asOf: items[0]?.asOf ?? new Date().toISOString(),
      isDelayed: true,
      items
    });
  } catch (error) {
    // The provider itself is defensive; this final guard guarantees the route never exposes a 500.
    console.error("Dollar-volume screener unexpected failure; returning safe empty result", error);
    res.status(200).json({
      provider: "fmp",
      status: "unavailable_or_empty",
      minDollarVolume,
      exchange: exchange ?? null,
      asOf: new Date().toISOString(),
      isDelayed: true,
      items: []
    });
  }
}
