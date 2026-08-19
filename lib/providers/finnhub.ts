import type { MarketScope } from "../../src/types.js";

const BASE_URL = "https://finnhub.io/api/v1";
const REQUEST_TIMEOUT_MS = 6_000;
const PROFILE_TTL_MS = 60 * 60 * 1_000;
const METRIC_TTL_MS = 60 * 60 * 1_000;
const FINANCIALS_TTL_MS = 6 * 60 * 60 * 1_000;
const REVENUE_BREAKDOWN_TTL_MS = 6 * 60 * 60 * 1_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1_000;

type CacheEntry<T> = {
  value: T | null;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string | null;
};

export interface FinnhubResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
}

export interface FinnhubProfile2 {
  country?: string;
  currency?: string;
  exchange?: string;
  finnhubIndustry?: string;
  ipo?: string;
  logo?: string;
  marketCapitalization?: number;
  name?: string;
  phone?: string;
  shareOutstanding?: number;
  ticker?: string;
  weburl?: string;
}

export interface FinnhubMetricResponse {
  metric?: Record<string, unknown>;
  metricType?: string;
  series?: Record<string, unknown>;
  symbol?: string;
}

export interface FinnhubReportedFiling {
  accessNumber?: string;
  acceptedDate?: string;
  cik?: string;
  endDate?: string;
  filedDate?: string;
  form?: string;
  quarter?: number;
  report?: {
    bs?: Record<string, unknown>;
    cf?: Record<string, unknown>;
    ic?: Record<string, unknown>;
  };
  startDate?: string;
  symbol?: string;
  year?: number;
}

export interface FinnhubFinancialsReportedResponse {
  cik?: string;
  data?: FinnhubReportedFiling[];
  symbol?: string;
}

export interface FinnhubRevenueBreakdownItem {
  label?: string;
  member?: string;
  percentage?: number;
  unit?: string;
  value?: number;
}

export interface FinnhubRevenueBreakdownAxis {
  axis?: string;
  data?: FinnhubRevenueBreakdownItem[];
  label?: string;
}

export interface FinnhubRevenueBreakdownPeriod {
  accessNumber?: string;
  breakdown?: {
    concept?: string;
    endDate?: string;
    revenueBreakdown?: FinnhubRevenueBreakdownAxis[];
    startDate?: string;
    unit?: string;
    value?: number;
  };
}

export interface FinnhubRevenueBreakdownResponse {
  cik?: string;
  data?: FinnhubRevenueBreakdownPeriod[];
  symbol?: string;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<FinnhubResult<unknown> | null>>();

function getMarketScope(symbol: string): MarketScope {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.endsWith(".HK")) return "HK";
  if (normalized.endsWith(".SH") || normalized.endsWith(".SZ")) return "CN";
  if (!normalized || normalized.includes(".")) return "OTHER";
  return "US";
}

/** 僅允許任務明確規定的無後綴或 .US 美股輸入進入 Finnhub Free 基本面路徑。 */
export function isFinnhubSupportedMarket(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return !normalized.includes(".") || normalized.endsWith(".US");
}

/**
 * 不可對 .HK/.SH/.SZ 使用本函式作為 API 路由。它只在市場已被判定為 US 時移除 .US。
 */
export function normalizeFinnhubSymbol(symbol: string): string | null {
  if (!isFinnhubSupportedMarket(symbol)) return null;
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return null;
  return normalized.replace(/\.US$/i, "");
}

export function detectMarketScope(symbol: string): MarketScope {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.endsWith(".US") || !normalized.includes(".")) return "US";
  return getMarketScope(normalized);
}

function getEntry<T>(key: string): { fresh: FinnhubResult<T> | null; stale: FinnhubResult<T> | null } {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.value === null || !entry.fetchedAt) return { fresh: null, stale: null };

  const now = Date.now();
  const result: FinnhubResult<T> = {
    data: entry.value,
    fetchedAt: entry.fetchedAt,
    isStale: now > entry.expiresAt
  };

  if (now <= entry.expiresAt) return { fresh: result, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: result };

  cache.delete(key);
  return { fresh: null, stale: null };
}

function cacheValue<T>(key: string, value: T | null, ttlMs: number, fetchedAt: string | null): void {
  const now = Date.now();
  cache.set(key, {
    value,
    expiresAt: now + ttlMs,
    staleUntil: now + ttlMs + STALE_TTL_MS,
    fetchedAt
  });
}

function cacheFailure(key: string, status: number | null): void {
  // 403 likely represents entitlement; 429 must wait at least a short time. All other failures
  // are also throttled briefly, avoiding a request storm while retaining a null-safe fallback.
  const ttlMs = status === 403 ? 15 * 60 * 1_000 : status === 429 ? 60 * 1_000 : 30 * 1_000;
  cacheValue(key, null, ttlMs, null);
}

async function requestJson<T>(path: string): Promise<{ body: T; fetchedAt: string }> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("FINNHUB_API_KEY_MISSING");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Finnhub-Token": apiKey
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error(`Finnhub HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    return { body: (await response.json()) as T, fetchedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
  }
}

async function getEndpoint<T>(
  cacheKey: string,
  path: string,
  ttlMs: number
): Promise<FinnhubResult<T> | null> {
  const { fresh, stale } = getEntry<T>(cacheKey);
  if (fresh) return fresh;

  const running = inFlight.get(cacheKey) as Promise<FinnhubResult<T> | null> | undefined;
  if (running) return running;

  const operation = (async (): Promise<FinnhubResult<T> | null> => {
    try {
      const { body, fetchedAt } = await requestJson<T>(path);
      cacheValue(cacheKey, body, ttlMs, fetchedAt);
      return { data: body, fetchedAt, isStale: false };
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error
        ? Number((error as { status?: unknown }).status)
        : null;
      cacheFailure(cacheKey, Number.isFinite(status) ? status : null);
      return stale;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, operation as Promise<FinnhubResult<unknown> | null>);
  return operation;
}

/** Company Profile 2: company name, industry, market cap, exchange, IPO date and logo. */
export async function getFinnhubProfile2(symbolInput: string): Promise<FinnhubResult<FinnhubProfile2> | null> {
  const symbol = normalizeFinnhubSymbol(symbolInput);
  if (!symbol) return null;
  try {
    return await getEndpoint<FinnhubProfile2>(
      `finnhub:profile2:${symbol}`,
      `/stock/profile2?symbol=${encodeURIComponent(symbol)}`,
      PROFILE_TTL_MS
    );
  } catch {
    return null;
  }
}

/** Basic Financials: direct response is retained as a map because Finnhub metric keys may vary by issuer. */
export async function getFinnhubMetric(symbolInput: string): Promise<FinnhubResult<FinnhubMetricResponse> | null> {
  const symbol = normalizeFinnhubSymbol(symbolInput);
  if (!symbol) return null;
  try {
    return await getEndpoint<FinnhubMetricResponse>(
      `finnhub:metric:${symbol}`,
      `/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`,
      METRIC_TTL_MS
    );
  } catch {
    return null;
  }
}

/** Financials As Reported: US filings used for the latest reported revenue and net income only when present. */
export async function getFinnhubFinancialsReported(
  symbolInput: string,
  frequency: "annual" | "quarterly" = "annual"
): Promise<FinnhubResult<FinnhubFinancialsReportedResponse> | null> {
  const symbol = normalizeFinnhubSymbol(symbolInput);
  if (!symbol) return null;
  try {
    return await getEndpoint<FinnhubFinancialsReportedResponse>(
      `finnhub:financials-reported:${symbol}:${frequency}`,
      `/stock/financials-reported?symbol=${encodeURIComponent(symbol)}&freq=${frequency}`,
      FINANCIALS_TTL_MS
    );
  } catch {
    return null;
  }
}

/**
 * Revenue Breakdown: entitlement and issuer disclosure vary. A null result is expected and never an error path.
 */
export async function getFinnhubRevenueBreakdown(
  symbolInput: string
): Promise<FinnhubResult<FinnhubRevenueBreakdownResponse> | null> {
  const symbol = normalizeFinnhubSymbol(symbolInput);
  if (!symbol) return null;
  try {
    return await getEndpoint<FinnhubRevenueBreakdownResponse>(
      `finnhub:revenue-breakdown:${symbol}`,
      `/stock/revenue-breakdown?symbol=${encodeURIComponent(symbol)}`,
      REVENUE_BREAKDOWN_TTL_MS
    );
  } catch {
    return null;
  }
}
