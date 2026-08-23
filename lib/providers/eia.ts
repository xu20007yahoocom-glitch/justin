const EIA_BASE_URL = "https://api.eia.gov/v2";
const REQUEST_TIMEOUT_MS = 8_000;
const EIA_TTL_MS = 4 * 60 * 60 * 1_000;
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
  response?: { frequency?: unknown; data?: unknown; facets?: unknown };
}

interface EiaFacetRow {
  id?: unknown;
  name?: unknown;
  description?: unknown;
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

export interface EiaFacet {
  id: string;
  name: string | null;
  description: string | null;
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

interface EiaEnergyDefinition {
  id: EiaEnergyMetric["id"];
  label: string;
  activityTerms: string[];
  productTerms: string[];
}

export interface EiaCountryDefinition {
  country: string;
  countryRegionId: string;
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

/** Product and activity terms, not EIA IDs. IDs are selected only from current API metadata. */
const ENERGY_DEFINITIONS: readonly EiaEnergyDefinition[] = [
  { id: "oilConsumption", label: "石油消费", activityTerms: ["consumption"], productTerms: ["petroleum", "liquids"] },
  { id: "oilProduction", label: "石油产量", activityTerms: ["production"], productTerms: ["petroleum", "liquids"] },
  { id: "naturalGasConsumption", label: "天然气消费", activityTerms: ["consumption"], productTerms: ["natural gas"] },
  { id: "naturalGasProduction", label: "天然气产量", activityTerms: ["production"], productTerms: ["natural gas"] },
  { id: "electricityConsumption", label: "电力消费", activityTerms: ["consumption"], productTerms: ["electricity"] }
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

function hasApiKey(): boolean {
  return Boolean(process.env.EIA_API_KEY?.trim());
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
    api_key: "<redacted>", frequency: "annual", "data[0]": "value",
    "facets[activityId][]": query.activityId, "facets[productId][]": query.productId,
    "facets[countryRegionId][]": query.countryRegionId, "sort[0][column]": "period",
    "sort[0][direction]": "desc", length: "1"
  });
  if (query.unit) params.set("facets[unit][]", query.unit);
  return `${EIA_BASE_URL}/international/data/?${params.toString()}`;
}

function metadataUrl(facet: "activityId" | "productId"): URL | null {
  const apiKey = process.env.EIA_API_KEY?.trim();
  if (!apiKey) return null;
  const url = new URL(`${EIA_BASE_URL}/international/facet/${facet}/`);
  url.searchParams.set("api_key", apiKey);
  return url;
}

function safeMetadataEndpoint(facet: "activityId" | "productId"): string {
  return `${EIA_BASE_URL}/international/facet/${facet}/?api_key=<redacted>`;
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
      period, frequency: text(body.response?.frequency, 64), activityId: text(row?.activityId, 64) ?? query.activityId,
      activityName: text(row?.activityName, 160), productId: text(row?.productId, 64) ?? query.productId,
      productName: text(row?.productName, 160), countryRegionId: text(row?.countryRegionId, 64) ?? query.countryRegionId,
      countryRegionName: text(row?.countryRegionName, 160), unit: text(row?.unit, 64), unitName: text(row?.unitName, 160), value
    };
  } catch (error) {
    console.warn("EIA International request failed", { endpoint, reason: error instanceof Error ? error.message : String(error) });
    return null;
  } finally { clearTimeout(timeout); }
}

async function requestFacet(facet: "activityId" | "productId"): Promise<EiaFacet[] | null> {
  const url = metadataUrl(facet);
  const endpoint = safeMetadataEndpoint(facet);
  if (!url) {
    console.warn("EIA International metadata skipped", { endpoint, reason: "EIA_API_KEY_MISSING" });
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) {
      console.warn("EIA International metadata response", { endpoint, httpStatus: response.status, responsePreview: raw.slice(0, 500) });
      return null;
    }
    let body: EiaInternationalResponse;
    try { body = JSON.parse(raw) as EiaInternationalResponse; } catch {
      console.warn("EIA International metadata invalid JSON", { endpoint, httpStatus: response.status });
      return null;
    }
    const rows = Array.isArray(body.response?.facets) ? body.response.facets : [];
    const values = rows.flatMap((row) => {
      const typed = row as EiaFacetRow;
      const id = text(typed.id, 64);
      if (!id || !/^[A-Za-z0-9_\-]+$/.test(id)) return [];
      return [{ id, name: text(typed.name, 180), description: text(typed.description, 240) }];
    });
    return values.length > 0 ? values : null;
  } catch (error) {
    console.warn("EIA International metadata request failed", { endpoint, reason: error instanceof Error ? error.message : String(error) });
    return null;
  } finally { clearTimeout(timeout); }
}

/** Retrieves one latest annual row. All values remain exact EIA strings. */
export async function getEiaInternationalLatest(queryInput: EiaInternationalQuery): Promise<EiaResult<EiaInternationalObservation> | null> {
  const query: EiaInternationalQuery = {
    activityId: safeFacet(queryInput.activityId) ?? "", productId: safeFacet(queryInput.productId) ?? "",
    countryRegionId: safeFacet(queryInput.countryRegionId) ?? "", unit: queryInput.unit ? safeFacet(queryInput.unit) ?? undefined : undefined
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
      if (!data) { cacheValue(key, null, FAILURE_TTL_MS, null); return stale; }
      const fetchedAt = new Date().toISOString();
      cacheValue(key, data, EIA_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: false };
    } catch (error) {
      console.warn("EIA International fallback", { endpoint: safeEndpoint(query), reason: error instanceof Error ? error.message : String(error) });
      cacheValue(key, null, FAILURE_TTL_MS, null);
      return stale;
    } finally { inFlight.delete(key); }
  })();
  inFlight.set(key, operation as Promise<EiaResult<unknown> | null>);
  return operation;
}

async function getEiaFacet(facet: "activityId" | "productId"): Promise<EiaResult<EiaFacet[]> | null> {
  if (!hasApiKey()) return null;
  const key = `eia:intl:facet:${facet}`;
  const { fresh, stale } = getCache<EiaFacet[]>(key);
  if (fresh) return fresh;
  const running = inFlight.get(key) as Promise<EiaResult<EiaFacet[]> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<EiaResult<EiaFacet[]> | null> => {
    try {
      const data = await requestFacet(facet);
      if (!data) { cacheValue(key, null, FAILURE_TTL_MS, null); return stale; }
      const fetchedAt = new Date().toISOString();
      cacheValue(key, data, EIA_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: false };
    } catch (error) {
      console.warn("EIA International metadata fallback", { facet, reason: error instanceof Error ? error.message : String(error) });
      cacheValue(key, null, FAILURE_TTL_MS, null);
      return stale;
    } finally { inFlight.delete(key); }
  })();
  inFlight.set(key, operation as Promise<EiaResult<unknown> | null>);
  return operation;
}

function facetScore(facet: EiaFacet, terms: string[]): number {
  const content = `${facet.name ?? ""} ${facet.description ?? ""}`.toLowerCase();
  return terms.filter((term) => content.includes(term.toLowerCase())).length;
}

function chooseFacet(facets: EiaFacet[], terms: string[]): EiaFacet | null {
  const ranked = facets.map((facet) => ({ facet, score: facetScore(facet, terms) }))
    .filter((entry) => entry.score === terms.length)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.facet ?? null;
}

async function discoverEnergyMetric(country: EiaCountryDefinition, definition: EiaEnergyDefinition): Promise<EiaResult<EiaEnergyMetric> | null> {
  if (!hasApiKey()) return null;
  const key = `eia:intl:dynamic:${country.countryRegionId}:${definition.id}`;
  const { fresh, stale } = getCache<EiaEnergyMetric>(key);
  if (fresh) return fresh;
  const running = inFlight.get(key) as Promise<EiaResult<EiaEnergyMetric> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<EiaResult<EiaEnergyMetric> | null> => {
    try {
      const [activityFacets, productFacets] = await Promise.all([getEiaFacet("activityId"), getEiaFacet("productId")]);
      if (!activityFacets || !productFacets) { cacheValue(key, null, FAILURE_TTL_MS, null); return stale; }
      const activity = chooseFacet(activityFacets.data, definition.activityTerms);
      const product = chooseFacet(productFacets.data, definition.productTerms);
      if (!activity || !product) {
        console.info("EIA International dynamic metric unavailable", { country: country.country, metric: definition.id, activityFound: Boolean(activity), productFound: Boolean(product) });
        cacheValue(key, null, FAILURE_TTL_MS, null);
        return stale;
      }
      const result = await getEiaInternationalLatest({ activityId: activity.id, productId: product.id, countryRegionId: country.countryRegionId });
      if (!result) { cacheValue(key, null, FAILURE_TTL_MS, null); return stale; }
      const data: EiaEnergyMetric = {
        id: definition.id, label: definition.label, activityId: activity.id, activityName: activity.name,
        productId: product.id, productName: product.name, observation: result.data
      };
      cacheValue(key, data, EIA_TTL_MS, result.fetchedAt);
      return { data, fetchedAt: result.fetchedAt, isStale: Boolean(result.isStale || activityFacets.isStale || productFacets.isStale) };
    } catch (error) {
      console.warn("EIA International dynamic metric fallback", { country: country.country, metric: definition.id, reason: error instanceof Error ? error.message : String(error) });
      cacheValue(key, null, FAILURE_TTL_MS, null);
      return stale;
    } finally { inFlight.delete(key); }
  })();
  inFlight.set(key, operation as Promise<EiaResult<unknown> | null>);
  return operation;
}

/**
 * Dynamically discovers EIA International facet IDs and verifies every country /
 * metric through the data route. Missing facets, no rows or API failures produce
 * omitted metrics, not estimated values.
 */
export async function getEiaCountryEnergy(country: EiaCountryDefinition): Promise<EiaResult<EiaCountryEnergy> | null> {
  if (!hasApiKey()) return null;
  const key = `eia:intl:country-energy:${country.countryRegionId}`;
  const { fresh, stale } = getCache<EiaCountryEnergy>(key);
  if (fresh) return fresh;
  const running = inFlight.get(key) as Promise<EiaResult<EiaCountryEnergy> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<EiaResult<EiaCountryEnergy> | null> => {
    try {
      const results = await Promise.all(ENERGY_DEFINITIONS.map((definition) => discoverEnergyMetric(country, definition)));
      const metrics = results.flatMap((result) => result ? [result.data] : []);
      if (metrics.length === 0) { cacheValue(key, null, FAILURE_TTL_MS, null); return stale; }
      const fetchedAt = results.map((result) => result?.fetchedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? new Date().toISOString();
      const data: EiaCountryEnergy = { country: country.country, countryRegionId: country.countryRegionId, metrics };
      cacheValue(key, data, EIA_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: results.some((result) => result?.isStale) };
    } catch (error) {
      console.warn("EIA International country energy fallback", { country: country.country, reason: error instanceof Error ? error.message : String(error) });
      cacheValue(key, null, FAILURE_TTL_MS, null);
      return stale;
    } finally { inFlight.delete(key); }
  })();
  inFlight.set(key, operation as Promise<EiaResult<unknown> | null>);
  return operation;
}
