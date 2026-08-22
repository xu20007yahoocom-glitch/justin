import { isFinnhubSupportedMarket } from "./finnhub.js";

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const REQUEST_TIMEOUT_MS = 6_000;
const INCOME_STATEMENT_TTL_MS = 6 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 15 * 60 * 1_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1_000;

type CacheEntry<T> = {
  value: T | null;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string | null;
};

export interface FmpResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
}

/** FMP income statement values use the issuer-reported financial-statement currency. */
export interface FmpIncomeStatement {
  symbol?: string;
  date?: string;
  calendarYear?: string;
  period?: string;
  acceptedDate?: string;
  filingDate?: string;
  revenue?: number | string;
  netIncome?: number | string;
  [key: string]: unknown;
}

export interface FmpIncomeStatementSnapshot {
  symbol: string;
  revenue: number | null;
  netIncome: number | null;
  period: string | null;
  periodEnd: string | null;
  acceptedDate: string | null;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<FmpResult<unknown> | null>>();

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getCache<T>(key: string): { fresh: FmpResult<T> | null; stale: FmpResult<T> | null } {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.value === null || !entry.fetchedAt) return { fresh: null, stale: null };
  const now = Date.now();
  const result: FmpResult<T> = {
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
  const ttlMs = status === 429 ? 60 * 60 * 1_000 : FAILURE_TTL_MS;
  cacheValue(key, null, ttlMs, null);
}

function fmpSymbol(symbol: string): string | null {
  if (!isFinnhubSupportedMarket(symbol)) return null;
  const normalized = symbol.trim().toUpperCase().replace(/\.US$/i, "");
  return normalized || null;
}

function buildUrl(path: string, params: Record<string, string>): URL | null {
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) return null;
  const url = new URL(`${FMP_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);
  return url;
}

async function requestJson<T>(path: string, params: Record<string, string>): Promise<{ body: T; fetchedAt: string }> {
  const url = buildUrl(path, params);
  const safeEndpoint = `${FMP_BASE_URL}${path}?${new URLSearchParams(params).toString()}&apikey=<redacted>`;
  if (!url) {
    console.warn("FMP endpoint response", {
      endpoint: safeEndpoint,
      httpStatus: null,
      ok: false,
      reason: "FMP_API_KEY_MISSING"
    });
    throw new Error("FMP_API_KEY_MISSING");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const bodyText = await response.text();
    if (!response.ok) {
      console.warn("FMP endpoint response", {
        endpoint: safeEndpoint,
        httpStatus: response.status,
        ok: false,
        responsePreview: bodyText.slice(0, 600)
      });
      const error = new Error(`FMP HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    let body: T;
    try {
      body = JSON.parse(bodyText) as T;
    } catch {
      const error = new Error("FMP_INVALID_JSON") as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return { body, fetchedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
  }
}

async function getEndpoint<T>(
  cacheKey: string,
  path: string,
  params: Record<string, string>,
  ttlMs: number
): Promise<FmpResult<T> | null> {
  const { fresh, stale } = getCache<T>(cacheKey);
  if (fresh) return fresh;
  const running = inFlight.get(cacheKey) as Promise<FmpResult<T> | null> | undefined;
  if (running) return running;

  const operation = (async (): Promise<FmpResult<T> | null> => {
    try {
      const { body, fetchedAt } = await requestJson<T>(path, params);
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

  inFlight.set(cacheKey, operation as Promise<FmpResult<unknown> | null>);
  return operation;
}

/**
 * Returns the latest FMP annual income statement only for the supported US ticker route.
 * All key, quota, transport and payload failures resolve to null or a valid stale cache result.
 */
export async function getFmpIncomeStatement(symbolInput: string): Promise<FmpResult<FmpIncomeStatementSnapshot> | null> {
  const symbol = fmpSymbol(symbolInput);
  if (!symbol) return null;
  const key = `fmp:income-statement:${symbol}:annual`;
  const result = await getEndpoint<FmpIncomeStatement[]>(
    key,
    "/income-statement",
    { symbol, limit: "1", period: "annual" },
    INCOME_STATEMENT_TTL_MS
  );
  const record = Array.isArray(result?.data) ? result.data[0] : null;
  if (!result || !record || typeof record !== "object") {
    console.info("FMP income statement mapping", {
      symbol,
      available: false,
      hasRevenue: false,
      hasNetIncome: false,
      period: null
    });
    return null;
  }

  const snapshot: FmpIncomeStatementSnapshot = {
    symbol,
    revenue: finiteNumber(record.revenue),
    netIncome: finiteNumber(record.netIncome),
    period: typeof record.period === "string" ? record.period : null,
    periodEnd: typeof record.date === "string" ? record.date : null,
    acceptedDate: typeof record.acceptedDate === "string"
      ? record.acceptedDate
      : typeof record.filingDate === "string" ? record.filingDate : null
  };
  console.info("FMP income statement mapping", {
    symbol,
    available: snapshot.revenue !== null || snapshot.netIncome !== null,
    hasRevenue: snapshot.revenue !== null,
    hasNetIncome: snapshot.netIncome !== null,
    period: snapshot.period,
    periodEnd: snapshot.periodEnd,
    isStale: result.isStale
  });
  return { data: snapshot, fetchedAt: result.fetchedAt, isStale: result.isStale };
}
