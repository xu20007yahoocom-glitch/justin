const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const REQUEST_TIMEOUT_MS = 8_000;
const SCREENER_TTL_MS = 3 * 60 * 60 * 1_000;
const STALE_TTL_MS = 12 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_SCAN_LIMIT = 1_000;

export interface DollarVolumeScreenerItem {
  symbol: string;
  name: string | null;
  price: number;
  volume: number;
  dollarVolume: number;
  asOf: string;
  isDelayed: true;
}

export interface ScanByDollarVolumeOptions {
  exchange?: string;
  limit?: number;
}

export interface ScreenerProvider {
  scanByDollarVolume(minUsd: number, opts?: ScanByDollarVolumeOptions): Promise<DollarVolumeScreenerItem[]>;
}

interface FmpScreenerRecord {
  symbol?: unknown;
  companyName?: unknown;
  name?: unknown;
  price?: unknown;
  volume?: unknown;
  [key: string]: unknown;
}

type CacheEntry = {
  value: DollarVolumeScreenerItem[];
  expiresAt: number;
  staleUntil: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<DollarVolumeScreenerItem[]>>();

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normaliseExchange(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  const exchange = value.trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,20}$/.test(exchange) ? exchange : null;
}

function safeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_SCAN_LIMIT;
  return Math.max(1, Math.min(Math.floor(value as number), DEFAULT_SCAN_LIMIT));
}

function getCache(key: string): { fresh: DollarVolumeScreenerItem[] | null; stale: DollarVolumeScreenerItem[] | null } {
  const entry = cache.get(key);
  if (!entry) return { fresh: null, stale: null };
  const now = Date.now();
  if (now <= entry.expiresAt) return { fresh: entry.value, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: entry.value };
  cache.delete(key);
  return { fresh: null, stale: null };
}

function cacheValue(key: string, value: DollarVolumeScreenerItem[], ttlMs: number): void {
  const now = Date.now();
  cache.set(key, { value, expiresAt: now + ttlMs, staleUntil: now + ttlMs + STALE_TTL_MS });
}

async function fetchScreener(exchange: string | null, limit: number): Promise<FmpScreenerRecord[]> {
  const apiKey = process.env.FMP_API_KEY?.trim();
  const params = new URLSearchParams({ limit: String(limit) });
  if (exchange) params.set("exchange", exchange);
  const safeEndpoint = `${FMP_BASE_URL}/company-screener?${params.toString()}&apikey=<redacted>`;
  if (!apiKey) {
    console.warn("FMP company screener response", { endpoint: safeEndpoint, httpStatus: null, ok: false, reason: "FMP_API_KEY_MISSING" });
    throw new Error("FMP_API_KEY_MISSING");
  }

  params.set("apikey", apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${FMP_BASE_URL}/company-screener?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const bodyText = await response.text();
    if (!response.ok) {
      console.warn("FMP company screener response", {
        endpoint: safeEndpoint,
        httpStatus: response.status,
        ok: false,
        responsePreview: bodyText.slice(0, 600)
      });
      throw new Error(`FMP HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error("FMP_INVALID_JSON");
    }
    if (!Array.isArray(body)) {
      console.warn("FMP company screener response", { endpoint: safeEndpoint, httpStatus: response.status, ok: false, reason: "UNEXPECTED_RESPONSE_SHAPE" });
      return [];
    }
    const first = body[0] as FmpScreenerRecord | undefined;
    console.info("FMP company screener response", {
      endpoint: safeEndpoint,
      httpStatus: response.status,
      ok: true,
      recordCount: body.length,
      hasSymbol: Boolean(first && typeof first.symbol === "string"),
      hasPrice: finiteNumber(first?.price) !== null,
      hasVolume: finiteNumber(first?.volume) !== null,
      fields: first && typeof first === "object" ? Object.keys(first).slice(0, 30) : []
    });
    return body as FmpScreenerRecord[];
  } finally {
    clearTimeout(timeout);
  }
}

export class FmpScreenerProvider implements ScreenerProvider {
  async scanByDollarVolume(minUsd: number, opts: ScanByDollarVolumeOptions = {}): Promise<DollarVolumeScreenerItem[]> {
    const threshold = Number.isFinite(minUsd) && minUsd >= 0 ? minUsd : 5_000_000;
    const exchange = normaliseExchange(opts.exchange);
    const limit = safeLimit(opts.limit);
    const key = `fmp:screener:${exchange ?? "all"}:${limit}:${threshold}`;
    const { fresh, stale } = getCache(key);
    if (fresh) return fresh;

    const running = inFlight.get(key);
    if (running) return running;

    const operation = (async (): Promise<DollarVolumeScreenerItem[]> => {
      try {
        const records = await fetchScreener(exchange, limit);
        const asOf = new Date().toISOString();
        const mapped = records
          .map((record): DollarVolumeScreenerItem | null => {
            const symbol = typeof record.symbol === "string" ? record.symbol.trim().toUpperCase() : "";
            const price = finiteNumber(record.price);
            const volume = finiteNumber(record.volume);
            if (!symbol || price === null || volume === null || price < 0 || volume < 0) return null;
            const dollarVolume = price * volume;
            if (!Number.isFinite(dollarVolume) || dollarVolume < threshold) return null;
            return {
              symbol,
              name: typeof record.companyName === "string" ? record.companyName : typeof record.name === "string" ? record.name : null,
              price,
              volume,
              dollarVolume,
              asOf,
              isDelayed: true
            };
          })
          .filter((item): item is DollarVolumeScreenerItem => item !== null)
          .sort((left, right) => right.dollarVolume - left.dollarVolume);
        cacheValue(key, mapped, SCREENER_TTL_MS);
        console.info("FMP dollar-volume screener mapping", {
          exchange,
          threshold,
          results: mapped.length,
          isDelayed: true
        });
        return mapped;
      } catch (error) {
        console.warn("FMP dollar-volume screener unavailable; returning cached or empty list", {
          exchange,
          threshold,
          error: error instanceof Error ? error.message : String(error),
          staleResults: stale?.length ?? 0
        });
        // Preserve a usable stale result; only negative-cache a true cache miss.
        if (!stale) cacheValue(key, [], FAILURE_TTL_MS);
        return stale ?? [];
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, operation);
    return operation;
  }
}

export const fmpScreenerProvider = new FmpScreenerProvider();
