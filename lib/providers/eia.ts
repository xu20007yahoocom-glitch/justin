const EIA_BASE_URL = "https://api.eia.gov/v2";
const REQUEST_TIMEOUT_MS = 8_000;
const EIA_TTL_MS = 4 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 15 * 60 * 1_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1_000;

type EiaFrequency = "annual" | "monthly";

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
  response?: { frequency?: unknown; data?: unknown };
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

/** Cache-only control: does not alter fixed facets, country IDs, values or units. */
export interface EiaRefreshOptions {
  forceRefresh?: boolean;
}

export interface EiaInternationalQuery {
  activityId: string;
  productId: string;
  countryRegionId: string;
  unit?: string;
  frequency?: EiaFrequency;
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

export interface EiaEnergyMetric {
  id: "oilConsumption" | "oilProduction" | "naturalGasConsumption" | "naturalGasProduction" | "electricityConsumption";
  label: string;
  activityId: string;
  activityName: string | null;
  productId: string;
  productName: string | null;
  observation: EiaInternationalObservation;
}

export interface EiaCountryEnergy {
  country: string;
  countryRegionId: string;
  metrics: EiaEnergyMetric[];
}

export interface EiaCountryDefinition {
  country: string;
  countryRegionId: string;
}

interface FixedEiaEnergyDefinition {
  id: EiaEnergyMetric["id"];
  label: string;
  activityId: string;
  productId: string;
  frequency: EiaFrequency;
  officialSeriesName: string;
}

export const EIA_MAJOR_ENERGY_COUNTRIES: readonly EiaCountryDefinition[] = [
  { country: "美国", countryRegionId: "USA" },
  { country: "中国", countryRegionId: "CHN" },
  { country: "俄罗斯", countryRegionId: "RUS" },
  { country: "印度", countryRegionId: "IND" },
  { country: "日本", countryRegionId: "JPN" },
  { country: "德国", countryRegionId: "DEU" },
  { country: "沙特", countryRegionId: "SAU" },
  { country: "韩国", countryRegionId: "KOR" },
  { country: "加拿大", countryRegionId: "CAN" },
  { country: "巴西", countryRegionId: "BRA" },
  { country: "伊朗", countryRegionId: "IRN" },
  { country: "法国", countryRegionId: "FRA" }
];

/**
 * Verified against EIA's official INTL bulk data (2026-08-19 release):
 * - 5-2: Petroleum and other liquids consumption (annual)
 * - 53-1: Petroleum and other liquids production (monthly)
 * - 26-2: Dry natural gas consumption (annual)
 * - 26-1: Dry natural gas production (annual)
 * - 2-2: Electricity net consumption (annual)
 *
 * The API encodes series as INTL.<productId>-<activityId>-<country>-<unit>.<frequency>.
 * A country is only rendered when the v2 International route returns an actual observation.
 */
const FIXED_ENERGY_DEFINITIONS: readonly FixedEiaEnergyDefinition[] = [
  { id: "oilConsumption", label: "石油消费", activityId: "2", productId: "5", frequency: "annual", officialSeriesName: "Petroleum and other liquids consumption" },
  { id: "oilProduction", label: "石油产量", activityId: "1", productId: "53", frequency: "monthly", officialSeriesName: "Petroleum and other liquids production" },
  { id: "naturalGasConsumption", label: "天然气消费", activityId: "2", productId: "26", frequency: "annual", officialSeriesName: "Dry natural gas consumption" },
  { id: "naturalGasProduction", label: "天然气产量", activityId: "1", productId: "26", frequency: "annual", officialSeriesName: "Dry natural gas production" },
  { id: "electricityConsumption", label: "电力消费", activityId: "2", productId: "2", frequency: "annual", officialSeriesName: "Electricity net consumption" }
];

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
  url.searchParams.set("frequency", query.frequency ?? "annual");
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
    api_key: "<redacted>", frequency: query.frequency ?? "annual", "data[0]": "value",
    "facets[activityId][]": query.activityId, "facets[productId][]": query.productId,
    "facets[countryRegionId][]": query.countryRegionId, "sort[0][column]": "period",
    "sort[0][direction]": "desc", length: "1"
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
    const response = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) {
      console.warn("EIA International response", { endpoint, httpStatus: response.status, responsePreview: raw.slice(0, 500) });
      return null;
    }
    let body: EiaInternationalResponse;
    try { body = JSON.parse(raw) as EiaInternationalResponse; } catch {
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

/** Retrieves one latest observation while preserving the source's original unit and time period. */
export async function getEiaInternationalLatest(queryInput: EiaInternationalQuery, options: EiaRefreshOptions = {}): Promise<EiaResult<EiaInternationalObservation> | null> {
  const frequency = queryInput.frequency === "monthly" ? "monthly" : "annual";
  const query: EiaInternationalQuery = {
    activityId: safeFacet(queryInput.activityId) ?? "",
    productId: safeFacet(queryInput.productId) ?? "",
    countryRegionId: safeFacet(queryInput.countryRegionId) ?? "",
    unit: queryInput.unit ? safeFacet(queryInput.unit) ?? undefined : undefined,
    frequency
  };
  if (!query.activityId || !query.productId || !query.countryRegionId) return null;
  const key = `eia:intl:${query.frequency}:${query.activityId}:${query.productId}:${query.countryRegionId}:${query.unit ?? "any"}`;
  const { fresh, stale } = getCache<EiaInternationalObservation>(key);
  if (fresh && !options.forceRefresh) return fresh;
  const fallback = stale ?? (fresh && options.forceRefresh ? { ...fresh, isStale: true } : null);
  const running = inFlight.get(key) as Promise<EiaResult<EiaInternationalObservation> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<EiaResult<EiaInternationalObservation> | null> => {
    try {
      const data = await requestLatest(query);
      if (!data) {
        if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
        return fallback;
      }
      const fetchedAt = new Date().toISOString();
      cacheValue(key, data, EIA_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: false };
    } catch (error) {
      console.warn("EIA International fallback", { endpoint: safeEndpoint(query), reason: error instanceof Error ? error.message : String(error) });
      if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
      return fallback;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, operation as Promise<EiaResult<unknown> | null>);
  return operation;
}

async function fixedEnergyMetric(country: EiaCountryDefinition, definition: FixedEiaEnergyDefinition, options: EiaRefreshOptions = {}): Promise<EiaResult<EiaEnergyMetric> | null> {
  const key = `eia:intl:fixed:${country.countryRegionId}:${definition.id}`;
  const { fresh, stale } = getCache<EiaEnergyMetric>(key);
  if (fresh && !options.forceRefresh) return fresh;
  const fallback = stale ?? (fresh && options.forceRefresh ? { ...fresh, isStale: true } : null);
  const running = inFlight.get(key) as Promise<EiaResult<EiaEnergyMetric> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<EiaResult<EiaEnergyMetric> | null> => {
    try {
      const observation = await getEiaInternationalLatest({
        activityId: definition.activityId,
        productId: definition.productId,
        countryRegionId: country.countryRegionId,
        frequency: definition.frequency
      }, options);
      if (!observation) {
        console.info("EIA International fixed metric unavailable", {
          country: country.country,
          metric: definition.id,
          activityId: definition.activityId,
          productId: definition.productId,
          frequency: definition.frequency
        });
        if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
        return fallback;
      }
      const data: EiaEnergyMetric = {
        id: definition.id,
        label: definition.label,
        activityId: definition.activityId,
        activityName: observation.data.activityName,
        productId: definition.productId,
        productName: observation.data.productName,
        observation: observation.data
      };
      cacheValue(key, data, EIA_TTL_MS, observation.fetchedAt);
      return { data, fetchedAt: observation.fetchedAt, isStale: observation.isStale };
    } catch (error) {
      console.warn("EIA International fixed metric fallback", {
        country: country.country,
        metric: definition.id,
        activityId: definition.activityId,
        productId: definition.productId,
        reason: error instanceof Error ? error.message : String(error)
      });
      if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
      return fallback;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, operation as Promise<EiaResult<unknown> | null>);
  return operation;
}

/**
 * Queries five official fixed International facet combinations for one country.
 * A missing country/metric is omitted and the API consumer renders it as “暂无可靠资料”.
 */
export async function getEiaCountryEnergy(country: EiaCountryDefinition, options: EiaRefreshOptions = {}): Promise<EiaResult<EiaCountryEnergy> | null> {
  if (!process.env.EIA_API_KEY?.trim()) return null;
  const key = `eia:intl:country-energy-fixed:${country.countryRegionId}`;
  const { fresh, stale } = getCache<EiaCountryEnergy>(key);
  if (fresh && !options.forceRefresh) return fresh;
  const fallback = stale ?? (fresh && options.forceRefresh ? { ...fresh, isStale: true } : null);
  const running = inFlight.get(key) as Promise<EiaResult<EiaCountryEnergy> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<EiaResult<EiaCountryEnergy> | null> => {
    try {
      const results = await Promise.all(FIXED_ENERGY_DEFINITIONS.map((definition) => fixedEnergyMetric(country, definition, options)));
      const metrics = results.flatMap((result) => result ? [result.data] : []);
      if (metrics.length === 0) {
        if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
        return fallback;
      }
      const fetchedAt = results.map((result) => result?.fetchedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? new Date().toISOString();
      const data: EiaCountryEnergy = { country: country.country, countryRegionId: country.countryRegionId, metrics };
      cacheValue(key, data, EIA_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: results.some((result) => result?.isStale) };
    } catch (error) {
      console.warn("EIA International country fixed fallback", { country: country.country, reason: error instanceof Error ? error.message : String(error) });
      if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
      return fallback;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, operation as Promise<EiaResult<unknown> | null>);
  return operation;
}
