const EIA_BASE_URL = "https://api.eia.gov/v2";
const REQUEST_TIMEOUT_MS = 8_000;
const EIA_TTL_MS = 6 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 15 * 60 * 1_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1_000;

interface EiaInternationalRow {
  period?: unknown;
  productId?: unknown;
  productName?: unknown;
  activityId?: unknown;
  activityName?: unknown;
  countryRegionId?: unknown;
  countryRegionName?: unknown;
  unit?: unknown;
  unitName?: unknown;
  value?: unknown;
}

interface EiaInternationalResponse {
  response?: {
    frequency?: unknown;
    data?: unknown;
  };
}

interface CacheEntry<T> {
  value: T | null;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string | null;
}

export interface EiaResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
}

export interface EiaInternationalQuery {
  activityId: string;
  productId: string;
  countryRegionId: string;
  unit?: string;
}

export interface EiaInternationalObservation {
  period: string;
  frequency: string | null;
  activityId: string;
  activityName: string | null;
  productId: string;
  productName: string | null;
  countryRegionId: string;
  countryRegionName: string | null;
  unit: string | null;
  unitName: string | null;
  value: string;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<EiaResult<unknown> | null>>();

function text(value: unknown, limit = 240): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

function safeFacet(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z0-9_\-]+$/.test(trimmed) ? trimmed : null;
}

function cacheValue<T>(key: string, value: T | null, ttlMs: number, fetchedAt: string | null): void {
  const now = Date.now();
  cache.set(key, { value, expiresAt: now + ttlMs, staleUntil: now + ttlMs + STALE_TTL_MS, fetchedAt });
}

function getCache<T>(key: string): { fresh: EiaResult<T> | null; stale: EiaResult<T> | null } {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.value === null || !entry.fetchedAt) return { fresh: null, stale: null };
  const now = Date.now();
  const result: EiaResult<T> = { data: entry.value, fetchedAt: entry.fetchedAt, isStale: now > entry.expiresAt };
  if (now <= entry.expiresAt) return { fresh: result, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: result };
  cache.delete(key);
  return { fresh: null, stale: null };
}

function buildUrl(query: EiaInternationalQuery): URL | null {
  const apiKey = process.env.EIA_API_KEY?.trim();
  if (!apiKey) return null;
  const url = new URL(`${EIA_BASE_URL}/international/data/`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("frequency", "annual");
  url.searchParams.set("data[0]", "value");
  url.searchParams.set("facets[activityId][]", query.activityId);
  url.searchParams.set("facets[productId][]", query.productId);
  url.searchParams.set("facets[countryRegionId][]", query.countryRegionId);
  if (query.unit) url.searchParams.set("facets[unit][]", query.unit);
  url.searchParams.set("sort[0][column]", "period");
  url.searchParams.set("sort[0][direction]", "desc");
  url.searchParams.set("length", "1");
  return url;
}

function safeEndpoint(query: EiaInternationalQuery): string {
  const params = new URLSearchParams({
    api_key: "<redacted>",
    frequency: "annual",
    "data[0]": "value",
    "facets[activityId][]": query.activityId,
    "facets[productId][]": query.productId,
    "facets[countryRegionId][]": query.countryRegionId,
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    length: "1"
  });
  if (query.unit) params.set("facets[unit][]", query.unit);
  return `${EIA_BASE_URL}/international/data/?${params.toString()}`;
}

async function requestLatest(query: EiaInternationalQuery): Promise<EiaInternationalObservation | null> {
  const url = buildUrl(query);
  const endpoint = safeEndpoint(query);
  if (!url) {
    console.warn("EIA International request skipped", { endpoint, reason: "EIA_API_KEY_MISSING" });
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
      console.warn("EIA International response", { endpoint, httpStatus: response.status, responsePreview: raw.slice(0, 500) });
      return null;
    }

    let body: EiaInternationalResponse;
    try {
      body = JSON.parse(raw) as EiaInternationalResponse;
    } catch {
      console.warn("EIA International invalid JSON", { endpoint, httpStatus: response.status });
      return null;
    }

    const rows = Array.isArray(body.response?.data) ? body.response.data : [];
    const row = rows[0] as EiaInternationalRow | undefined;
    const period = text(row?.period, 32);
    const value = text(row?.value, 128);
    if (!period || !value) {
      console.info("EIA International observation unavailable", { endpoint, hasPeriod: Boolean(period), hasValue: Boolean(value) });
      return null;
    }

    return {
      period,
      frequency: text(body.response?.frequency, 64),
      activityId: text(row?.activityId, 64) ?? query.activityId,
      activityName: text(row?.activityName, 160),
      productId: text(row?.productId, 64) ?? query.productId,
      productName: text(row?.productName, 160),
      countryRegionId: text(row?.countryRegionId, 64) ?? query.countryRegionId,
      countryRegionName: text(row?.countryRegionName, 160),
      unit: text(row?.unit, 64),
      unitName: text(row?.unitName, 160),
      value
    };
  } catch (error) {
    console.warn("EIA International request failed", { endpoint, reason: error instanceof Error ? error.message : String(error) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Retrieves one latest annual row from EIA API v2 International. Values are
 * deliberately preserved as returned strings so no precision is fabricated.
 */
export async function getEiaInternationalLatest(queryInput: EiaInternationalQuery): Promise<EiaResult<EiaInternationalObservation> | null> {
  const query: EiaInternationalQuery = {
    activityId: safeFacet(queryInput.activityId) ?? "",
    productId: safeFacet(queryInput.productId) ?? "",
    countryRegionId: safeFacet(queryInput.countryRegionId) ?? "",
    unit: queryInput.unit ? safeFacet(queryInput.unit) ?? undefined : undefined
  };
  if (!query.activityId || !query.productId || !query.countryRegionId) return null;

  const key = `eia:intl:${query.activityId}:${query.productId}:${query.countryRegionId}:${query.unit ?? "any"}`;
  const { fresh, stale } = getCache<EiaInternationalObservation>(key);
  if (fresh) return fresh;
  const running = inFlight.get(key) as Promise<EiaResult<EiaInternationalObservation> | null> | undefined;
  if (running) return running;

  const operation = (async (): Promise<EiaResult<EiaInternationalObservation> | null> => {
    try {
      const data = await requestLatest(query);
      if (!data) {
        cacheValue(key, null, FAILURE_TTL_MS, null);
        return stale;
      }
      const fetchedAt = new Date().toISOString();
      cacheValue(key, data, EIA_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: false };
    } catch (error) {
      console.warn("EIA International fallback", { endpoint: safeEndpoint(query), reason: error instanceof Error ? error.message : String(error) });
      cacheValue(key, null, FAILURE_TTL_MS, null);
      return stale;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, operation as Promise<EiaResult<unknown> | null>);
  return operation;
}
