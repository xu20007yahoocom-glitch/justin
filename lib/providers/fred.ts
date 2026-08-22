const FRED_BASE_URL = "https://api.stlouisfed.org/fred";
const REQUEST_TIMEOUT_MS = 8_000;
const FRED_TTL_MS = 4 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 15 * 60 * 1_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1_000;

interface FredObservationRow {
  date?: unknown;
  value?: unknown;
}

interface FredObservationsResponse {
  observations?: unknown;
}

interface CacheEntry<T> {
  value: T | null;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string | null;
}

export interface FredResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
}

export interface FredLatestObservation {
  seriesId: string;
  observationDate: string;
  value: string;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<FredResult<unknown> | null>>();

function text(value: unknown, limit = 200): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
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

function getCache<T>(key: string): { fresh: FredResult<T> | null; stale: FredResult<T> | null } {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.value === null || !entry.fetchedAt) return { fresh: null, stale: null };
  const now = Date.now();
  const result: FredResult<T> = {
    data: entry.value,
    fetchedAt: entry.fetchedAt,
    isStale: now > entry.expiresAt
  };
  if (now <= entry.expiresAt) return { fresh: result, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: result };
  cache.delete(key);
  return { fresh: null, stale: null };
}

function buildUrl(seriesId: string): URL | null {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) return null;
  const url = new URL(`${FRED_BASE_URL}/series/observations`);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "1");
  url.searchParams.set("api_key", apiKey);
  return url;
}

async function requestLatest(seriesId: string): Promise<FredLatestObservation | null> {
  const url = buildUrl(seriesId);
  const safeEndpoint = `${FRED_BASE_URL}/series/observations?series_id=${encodeURIComponent(seriesId)}&file_type=json&sort_order=desc&limit=1&api_key=<redacted>`;
  if (!url) {
    console.warn("FRED observation request skipped", { seriesId, endpoint: safeEndpoint, reason: "FRED_API_KEY_MISSING" });
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      console.warn("FRED observation response", { seriesId, endpoint: safeEndpoint, httpStatus: response.status, responsePreview: raw.slice(0, 500) });
      return null;
    }

    let body: FredObservationsResponse;
    try {
      body = JSON.parse(raw) as FredObservationsResponse;
    } catch {
      console.warn("FRED observation invalid JSON", { seriesId, endpoint: safeEndpoint, httpStatus: response.status });
      return null;
    }

    const rows = Array.isArray(body.observations) ? body.observations : [];
    const latest = rows[0] as FredObservationRow | undefined;
    const observationDate = text(latest?.date, 32);
    const value = text(latest?.value, 128);
    if (!observationDate || !value || value === ".") {
      console.info("FRED observation unavailable", { seriesId, endpoint: safeEndpoint, observationDate, hasValue: Boolean(value && value !== ".") });
      return null;
    }
    return { seriesId, observationDate, value };
  } catch (error) {
    console.warn("FRED observation request failed", {
      seriesId,
      endpoint: safeEndpoint,
      reason: error instanceof Error ? error.message : String(error)
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads the most recent observation only. Values remain strings to avoid hidden
 * rounding or scale changes; UI code must display the source unit separately.
 */
export async function getFredLatestObservation(seriesIdInput: string): Promise<FredResult<FredLatestObservation> | null> {
  const seriesId = seriesIdInput.trim().toUpperCase();
  if (!seriesId || !/^[A-Z0-9_\-]+$/.test(seriesId)) return null;
  const key = `fred:latest:${seriesId}`;
  const { fresh, stale } = getCache<FredLatestObservation>(key);
  if (fresh) return fresh;

  const running = inFlight.get(key) as Promise<FredResult<FredLatestObservation> | null> | undefined;
  if (running) return running;

  const operation = (async (): Promise<FredResult<FredLatestObservation> | null> => {
    try {
      const data = await requestLatest(seriesId);
      if (!data) {
        cacheValue(key, null, FAILURE_TTL_MS, null);
        return stale;
      }
      const fetchedAt = new Date().toISOString();
      cacheValue(key, data, FRED_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: false };
    } catch (error) {
      console.warn("FRED latest observation fallback", { seriesId, reason: error instanceof Error ? error.message : String(error) });
      cacheValue(key, null, FAILURE_TTL_MS, null);
      return stale;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, operation as Promise<FredResult<unknown> | null>);
  return operation;
}
