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

interface FredSeriesRow {
  id?: unknown;
  title?: unknown;
  frequency?: unknown;
  units?: unknown;
  observation_end?: unknown;
}

interface FredSeriesSearchResponse {
  seriess?: unknown;
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

/** Cache-only control: does not alter FRED series discovery, IDs, values or units. */
export interface FredRefreshOptions {
  forceRefresh?: boolean;
}

export interface FredLatestObservation {
  seriesId: string;
  observationDate: string;
  value: string;
}

export interface FredSeriesCandidate {
  seriesId: string;
  title: string;
  frequency: string | null;
  units: string | null;
  observationEnd: string | null;
}

export interface FredRateMetric {
  kind: "policyRate" | "tenYearYield";
  label: string;
  seriesId: string;
  seriesTitle: string;
  value: string;
  unit: string | null;
  observationDate: string;
  frequency: string | null;
}

export interface FredCountryRate {
  country: string;
  policyRate: FredRateMetric | null;
  tenYearYield: FredRateMetric | null;
}

interface FredRateDefinition {
  country: string;
  policySearch: string;
  yieldSearch: string;
  policyTerms: string[];
  yieldTerms: string[];
}

/**
 * Search terms only. Series IDs are intentionally not hard-coded: each production
 * instance uses FRED series/search and then verifies a returned candidate through
 * series/observations before any value can be displayed.
 */
export const FRED_MAJOR_RATE_DEFINITIONS: readonly FredRateDefinition[] = [
  { country: "美国", policySearch: "Federal Funds Rate United States", yieldSearch: "10-Year Government Bond Yield United States", policyTerms: ["federal", "fund", "rate"], yieldTerms: ["10-year", "government", "bond"] },
  { country: "欧元区", policySearch: "ECB Deposit Facility Rate Euro Area", yieldSearch: "10-Year Government Bond Yield Euro Area", policyTerms: ["ecb", "deposit", "rate"], yieldTerms: ["10-year", "government", "bond"] },
  { country: "英国", policySearch: "Bank Rate United Kingdom", yieldSearch: "10-Year Government Bond Yield United Kingdom", policyTerms: ["bank", "rate", "united kingdom"], yieldTerms: ["10-year", "government", "bond", "united kingdom"] },
  { country: "日本", policySearch: "Policy Rate Japan", yieldSearch: "10-Year Government Bond Yield Japan", policyTerms: ["rate", "japan"], yieldTerms: ["10-year", "government", "bond", "japan"] },
  { country: "中国", policySearch: "Policy Rate China", yieldSearch: "10-Year Government Bond Yield China", policyTerms: ["rate", "china"], yieldTerms: ["10-year", "government", "bond", "china"] },
  { country: "加拿大", policySearch: "Policy Rate Canada", yieldSearch: "10-Year Government Bond Yield Canada", policyTerms: ["rate", "canada"], yieldTerms: ["10-year", "government", "bond", "canada"] },
  { country: "澳洲", policySearch: "Cash Rate Australia", yieldSearch: "10-Year Government Bond Yield Australia", policyTerms: ["rate", "australia"], yieldTerms: ["10-year", "government", "bond", "australia"] },
  { country: "瑞士", policySearch: "Policy Rate Switzerland", yieldSearch: "10-Year Government Bond Yield Switzerland", policyTerms: ["rate", "switzerland"], yieldTerms: ["10-year", "government", "bond", "switzerland"] },
  { country: "印度", policySearch: "Policy Rate India", yieldSearch: "10-Year Government Bond Yield India", policyTerms: ["rate", "india"], yieldTerms: ["10-year", "government", "bond", "india"] },
  { country: "韩国", policySearch: "Policy Rate Korea", yieldSearch: "10-Year Government Bond Yield Korea", policyTerms: ["rate", "korea"], yieldTerms: ["10-year", "government", "bond", "korea"] },
  { country: "巴西", policySearch: "Policy Rate Brazil", yieldSearch: "10-Year Government Bond Yield Brazil", policyTerms: ["rate", "brazil"], yieldTerms: ["10-year", "government", "bond", "brazil"] },
  { country: "墨西哥", policySearch: "Policy Rate Mexico", yieldSearch: "10-Year Government Bond Yield Mexico", policyTerms: ["rate", "mexico"], yieldTerms: ["10-year", "government", "bond", "mexico"] }
];

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<FredResult<unknown> | null>>();

function text(value: unknown, limit = 240): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

function hasApiKey(): boolean {
  return Boolean(process.env.FRED_API_KEY?.trim());
}

function cacheValue<T>(key: string, value: T | null, ttlMs: number, fetchedAt: string | null): void {
  const now = Date.now();
  cache.set(key, { value, expiresAt: now + ttlMs, staleUntil: now + ttlMs + STALE_TTL_MS, fetchedAt });
}

function getCache<T>(key: string): { fresh: FredResult<T> | null; stale: FredResult<T> | null } {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.value === null || !entry.fetchedAt) return { fresh: null, stale: null };
  const now = Date.now();
  const result: FredResult<T> = { data: entry.value, fetchedAt: entry.fetchedAt, isStale: now > entry.expiresAt };
  if (now <= entry.expiresAt) return { fresh: result, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: result };
  cache.delete(key);
  return { fresh: null, stale: null };
}

function observationsUrl(seriesId: string): URL | null {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) return null;
  const url = new URL(`${FRED_BASE_URL}/series/observations`);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "8");
  url.searchParams.set("api_key", apiKey);
  return url;
}

function searchUrl(searchText: string): URL | null {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) return null;
  const url = new URL(`${FRED_BASE_URL}/series/search`);
  url.searchParams.set("search_text", searchText.slice(0, 180));
  url.searchParams.set("file_type", "json");
  url.searchParams.set("order_by", "search_rank");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "24");
  url.searchParams.set("api_key", apiKey);
  return url;
}

function safeObservationEndpoint(seriesId: string): string {
  return `${FRED_BASE_URL}/series/observations?series_id=${encodeURIComponent(seriesId)}&file_type=json&sort_order=desc&limit=8&api_key=<redacted>`;
}

function safeSearchEndpoint(searchText: string): string {
  return `${FRED_BASE_URL}/series/search?search_text=${encodeURIComponent(searchText)}&file_type=json&order_by=search_rank&sort_order=desc&limit=24&api_key=<redacted>`;
}

async function requestLatest(seriesId: string): Promise<FredLatestObservation | null> {
  const url = observationsUrl(seriesId);
  const endpoint = safeObservationEndpoint(seriesId);
  if (!url) {
    console.warn("FRED observation request skipped", { seriesId, endpoint, reason: "FRED_API_KEY_MISSING" });
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) {
      console.warn("FRED observation response", { seriesId, endpoint, httpStatus: response.status, responsePreview: raw.slice(0, 500) });
      return null;
    }
    let body: FredObservationsResponse;
    try { body = JSON.parse(raw) as FredObservationsResponse; } catch {
      console.warn("FRED observation invalid JSON", { seriesId, endpoint, httpStatus: response.status });
      return null;
    }
    const rows = Array.isArray(body.observations) ? body.observations : [];
    const latest = rows.find((row) => {
      const typed = row as FredObservationRow;
      return Boolean(text(typed?.date, 32) && text(typed?.value, 128) !== ".");
    }) as FredObservationRow | undefined;
    const observationDate = text(latest?.date, 32);
    const value = text(latest?.value, 128);
    if (!observationDate || !value || value === ".") {
      console.info("FRED observation unavailable", { seriesId, endpoint });
      return null;
    }
    return { seriesId, observationDate, value };
  } catch (error) {
    console.warn("FRED observation request failed", { seriesId, endpoint, reason: error instanceof Error ? error.message : String(error) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestSearch(searchText: string): Promise<FredSeriesCandidate[] | null> {
  const url = searchUrl(searchText);
  const endpoint = safeSearchEndpoint(searchText);
  if (!url) {
    console.warn("FRED series discovery skipped", { endpoint, reason: "FRED_API_KEY_MISSING" });
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) {
      console.warn("FRED series discovery response", { endpoint, httpStatus: response.status, responsePreview: raw.slice(0, 500) });
      return null;
    }
    let body: FredSeriesSearchResponse;
    try { body = JSON.parse(raw) as FredSeriesSearchResponse; } catch {
      console.warn("FRED series discovery invalid JSON", { endpoint, httpStatus: response.status });
      return null;
    }
    const rows = Array.isArray(body.seriess) ? body.seriess : [];
    const candidates = rows.flatMap((row) => {
      const typed = row as FredSeriesRow;
      const seriesId = text(typed?.id, 96);
      const title = text(typed?.title, 320);
      if (!seriesId || !title || !/^[A-Za-z0-9_\-]+$/.test(seriesId)) return [];
      return [{ seriesId, title, frequency: text(typed.frequency, 96), units: text(typed.units, 160), observationEnd: text(typed.observation_end, 32) }];
    });
    return candidates.length > 0 ? candidates : null;
  } catch (error) {
    console.warn("FRED series discovery failed", { endpoint, reason: error instanceof Error ? error.message : String(error) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Values remain strings; callers must use units from FRED metadata rather than infer scale. */
export async function getFredLatestObservation(seriesIdInput: string, options: FredRefreshOptions = {}): Promise<FredResult<FredLatestObservation> | null> {
  const seriesId = seriesIdInput.trim().toUpperCase();
  if (!seriesId || !/^[A-Z0-9_\-]+$/.test(seriesId)) return null;
  const key = `fred:latest:${seriesId}`;
  const { fresh, stale } = getCache<FredLatestObservation>(key);
  if (fresh && !options.forceRefresh) return fresh;
  const fallback = stale ?? (fresh && options.forceRefresh ? { ...fresh, isStale: true } : null);
  const running = inFlight.get(key) as Promise<FredResult<FredLatestObservation> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<FredResult<FredLatestObservation> | null> => {
    try {
      const data = await requestLatest(seriesId);
      if (!data) { if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null); return fallback; }
      const fetchedAt = new Date().toISOString();
      cacheValue(key, data, FRED_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: false };
    } catch (error) {
      console.warn("FRED latest observation fallback", { seriesId, reason: error instanceof Error ? error.message : String(error) });
      if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
      return fallback;
    } finally { inFlight.delete(key); }
  })();
  inFlight.set(key, operation as Promise<FredResult<unknown> | null>);
  return operation;
}

async function getFredSearchResults(searchText: string, options: FredRefreshOptions = {}): Promise<FredResult<FredSeriesCandidate[]> | null> {
  const normalized = searchText.trim().replace(/\s+/g, " ").slice(0, 180);
  if (!normalized) return null;
  const key = `fred:search:${normalized.toLowerCase()}`;
  const { fresh, stale } = getCache<FredSeriesCandidate[]>(key);
  if (fresh && !options.forceRefresh) return fresh;
  const fallback = stale ?? (fresh && options.forceRefresh ? { ...fresh, isStale: true } : null);
  const running = inFlight.get(key) as Promise<FredResult<FredSeriesCandidate[]> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<FredResult<FredSeriesCandidate[]> | null> => {
    try {
      const data = await requestSearch(normalized);
      if (!data) { if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null); return fallback; }
      const fetchedAt = new Date().toISOString();
      cacheValue(key, data, FRED_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: false };
    } catch (error) {
      console.warn("FRED series discovery fallback", { endpoint: safeSearchEndpoint(normalized), reason: error instanceof Error ? error.message : String(error) });
      if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
      return fallback;
    } finally { inFlight.delete(key); }
  })();
  inFlight.set(key, operation as Promise<FredResult<unknown> | null>);
  return operation;
}

function scoreCandidate(candidate: FredSeriesCandidate, terms: string[]): number {
  const content = `${candidate.title} ${candidate.frequency ?? ""} ${candidate.units ?? ""}`.toLowerCase();
  if (content.includes("discontinued")) return -1000;
  const matched = terms.filter((term) => content.includes(term.toLowerCase())).length;
  const unitScore = candidate.units?.toLowerCase().includes("percent") ? 4 : 0;
  const currentScore = candidate.observationEnd && candidate.observationEnd >= "2020-01-01" ? 3 : 0;
  return matched * 10 + unitScore + currentScore;
}

async function discoverRateMetric(definition: FredRateDefinition, kind: FredRateMetric["kind"], options: FredRefreshOptions = {}): Promise<FredResult<FredRateMetric> | null> {
  if (!hasApiKey()) return null;
  const key = `fred:rate-metric:${definition.country}:${kind}`;
  const { fresh, stale } = getCache<FredRateMetric>(key);
  if (fresh && !options.forceRefresh) return fresh;
  const fallback = stale ?? (fresh && options.forceRefresh ? { ...fresh, isStale: true } : null);
  const running = inFlight.get(key) as Promise<FredResult<FredRateMetric> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<FredResult<FredRateMetric> | null> => {
    try {
      const searchText = kind === "policyRate" ? definition.policySearch : definition.yieldSearch;
      const terms = kind === "policyRate" ? definition.policyTerms : definition.yieldTerms;
      const search = await getFredSearchResults(searchText, options);
      if (!search) { if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null); return fallback; }
      const ranked = [...search.data].map((candidate) => ({ candidate, score: scoreCandidate(candidate, terms) }))
        .filter((entry) => entry.score >= Math.max(10, terms.length * 5))
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);
      for (const entry of ranked) {
        const latest = await getFredLatestObservation(entry.candidate.seriesId, options);
        if (!latest) continue;
        const data: FredRateMetric = {
          kind,
          label: kind === "policyRate" ? "政策基准利率" : "10 年期公债收益率",
          seriesId: entry.candidate.seriesId,
          seriesTitle: entry.candidate.title,
          value: latest.data.value,
          unit: entry.candidate.units,
          observationDate: latest.data.observationDate,
          frequency: entry.candidate.frequency
        };
        const fetchedAt = latest.fetchedAt;
        cacheValue(key, data, FRED_TTL_MS, fetchedAt);
        return { data, fetchedAt, isStale: latest.isStale || search.isStale };
      }
      if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
      return fallback;
    } catch (error) {
      console.warn("FRED dynamic rate discovery fallback", { country: definition.country, kind, reason: error instanceof Error ? error.message : String(error) });
      if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
      return fallback;
    } finally { inFlight.delete(key); }
  })();
  inFlight.set(key, operation as Promise<FredResult<unknown> | null>);
  return operation;
}

/**
 * Dynamically discovers, verifies and caches a country's FRED policy-rate and
 * 10-year yield. A missing key, unsuitable title, empty observation or any HTTP
 * failure returns null for that metric; no numeric fallback is produced.
 */
export async function getFredCountryRate(definition: FredRateDefinition, options: FredRefreshOptions = {}): Promise<FredResult<FredCountryRate> | null> {
  if (!hasApiKey()) return null;
  const key = `fred:country-rate:${definition.country}`;
  const { fresh, stale } = getCache<FredCountryRate>(key);
  if (fresh && !options.forceRefresh) return fresh;
  const fallback = stale ?? (fresh && options.forceRefresh ? { ...fresh, isStale: true } : null);
  const running = inFlight.get(key) as Promise<FredResult<FredCountryRate> | null> | undefined;
  if (running) return running;
  const operation = (async (): Promise<FredResult<FredCountryRate> | null> => {
    try {
      const [policyRate, tenYearYield] = await Promise.all([
        discoverRateMetric(definition, "policyRate", options),
        discoverRateMetric(definition, "tenYearYield", options)
      ]);
      if (!policyRate && !tenYearYield) { if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null); return fallback; }
      const fetchedAt = [policyRate?.fetchedAt, tenYearYield?.fetchedAt].filter((value): value is string => Boolean(value)).sort().at(-1) ?? new Date().toISOString();
      const data: FredCountryRate = { country: definition.country, policyRate: policyRate?.data ?? null, tenYearYield: tenYearYield?.data ?? null };
      cacheValue(key, data, FRED_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: Boolean(policyRate?.isStale || tenYearYield?.isStale) };
    } catch (error) {
      console.warn("FRED country rate fallback", { country: definition.country, reason: error instanceof Error ? error.message : String(error) });
      if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null);
      return fallback;
    } finally { inFlight.delete(key); }
  })();
  inFlight.set(key, operation as Promise<FredResult<unknown> | null>);
  return operation;
}
