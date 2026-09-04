const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const REQUEST_TIMEOUT_MS = 12_000;
const MIN_REQUEST_INTERVAL_MS = 5_200;
const SUCCESS_TTL_MS = 30 * 60 * 1_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1_000;
const EMPTY_OR_FAILURE_TTL_MS = 60_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_ARTICLES = 5;

export type GdeltNewsCategory = "geopolitical" | "economic";
export type GdeltSourceFormat = "json" | "rss";
export type GdeltCacheStatus = "fresh" | "stale_refreshing" | "stale_cooldown" | "unavailable_refreshing" | "unavailable_cooldown";

const CATEGORY_QUERY: Readonly<Record<GdeltNewsCategory, string>> = {
  geopolitical: "geopolitics",
  economic: "economy"
};

interface GdeltArticleRow {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  domain?: unknown;
  language?: unknown;
  sourcecountry?: unknown;
}

interface GdeltResponse {
  articles?: unknown;
  [key: string]: unknown;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string;
  sourceFormat: GdeltSourceFormat;
}

interface FailureCacheEntry {
  until: number;
  outcome: GdeltOutcome;
}

export type GdeltOutcome =
  | "success"
  | "rss_fallback_success"
  | "timeout"
  | "network_error"
  | "http_429"
  | "http_403"
  | "http_5xx"
  | "http_error"
  | "rate_limited_content"
  | "http_200_non_json"
  | "articles_empty"
  | "articles_filtered_empty"
  | "failure_short_cache"
  | "refresh_started";

export interface GdeltResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
  sourceFormat: GdeltSourceFormat;
  cacheStatus: GdeltCacheStatus;
  /** Null for a verified fresh article payload; otherwise a safe, non-body diagnostic category. */
  errorCategory: GdeltOutcome | null;
}

/** Cache-only control: force refresh never clears last-known-good articles or bypasses cooldown. */
export interface GdeltRefreshOptions {
  forceRefresh?: boolean;
}

export interface GdeltArticle {
  title: string;
  url: string;
  seenAt: string | null;
  domain: string | null;
  language: string | null;
  sourceCountry: string | null;
}

interface RequestResult {
  articles: GdeltArticle[] | null;
  retryOnTimeout: boolean;
  allowRssFallback: boolean;
  sourceFormat: GdeltSourceFormat;
  outcome: GdeltOutcome;
  cooldownMs: number | null;
}

const cache = new Map<string, CacheEntry<GdeltArticle[]>>();
const failureCache = new Map<string, FailureCacheEntry>();
const inFlight = new Map<string, Promise<void>>();
let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;
let providerCooldownUntil = 0;

function text(value: unknown, limit = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

function validUrl(value: unknown): string | null {
  const raw = text(value, 2_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  const value = match ? decodeXml(match[1]) : "";
  return value || null;
}

function diagnostic(payload: Record<string, unknown>): void {
  // Deliberately excludes response bodies, article descriptions, credentials and user data.
  console.info("GDELT_DIAGNOSTIC", payload);
}

function mapArticle(row: GdeltArticleRow): GdeltArticle | null {
  const url = validUrl(row.url);
  const title = text(row.title, 400);
  // Only title and a valid original HTTP(S) URL are mandatory.
  if (!url || !title) return null;
  return {
    title,
    url,
    seenAt: text(row.seendate, 64),
    domain: text(row.domain, 160),
    language: text(row.language, 64),
    sourceCountry: text(row.sourcecountry, 96)
  };
}

function buildUrl(category: GdeltNewsCategory, sourceFormat: GdeltSourceFormat): URL {
  const params = new URLSearchParams({
    query: CATEGORY_QUERY[category],
    mode: "artlist",
    format: sourceFormat,
    maxrecords: String(MAX_ARTICLES),
    timespan: "1week",
    sort: "datedesc"
  });
  return new URL(`${GDELT_DOC_URL}?${params.toString()}`);
}

function outcomeForHttpStatus(status: number): GdeltOutcome {
  if (status === 429) return "http_429";
  if (status === 403) return "http_403";
  if (status >= 500) return "http_5xx";
  return "http_error";
}

function parseRetryAfter(value: string | null): number {
  if (!value) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(DEFAULT_RETRY_AFTER_MS, Math.round(seconds * 1_000));
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(DEFAULT_RETRY_AFTER_MS, dateMs - Date.now());
  return DEFAULT_RETRY_AFTER_MS;
}

function errorCategory(error: unknown): "timeout" | "network_error" {
  return error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
}

function looksLikeGdeltRateLimit(raw: string): boolean {
  return /please limit requests to one every\s+\d+\s+seconds|high-traffic users should switch/i.test(raw);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes DOC API starts in the current serverless instance. CDN SWR prevents most cross-instance refreshes. */
async function reserveRequestSlot(): Promise<number> {
  let release!: () => void;
  const previous = requestQueue;
  requestQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs > 0) await delay(waitMs);
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
    return waitMs;
  } finally {
    release();
  }
}

function cachedResult(entry: CacheEntry<GdeltArticle[]>, cacheStatus: GdeltCacheStatus, errorCategory: GdeltOutcome | null): GdeltResult<GdeltArticle[]> {
  return { data: entry.value, fetchedAt: entry.fetchedAt, sourceFormat: entry.sourceFormat, isStale: cacheStatus !== "fresh", cacheStatus, errorCategory };
}

function readCache(key: string): { fresh: GdeltResult<GdeltArticle[]> | null; stale: CacheEntry<GdeltArticle[]> | null } {
  const entry = cache.get(key);
  if (!entry) return { fresh: null, stale: null };
  const now = Date.now();
  if (now <= entry.expiresAt) return { fresh: cachedResult(entry, "fresh", null), stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: entry };
  cache.delete(key);
  return { fresh: null, stale: null };
}

function cacheSuccess(key: string, data: GdeltArticle[], sourceFormat: GdeltSourceFormat): void {
  const fetchedAt = new Date().toISOString();
  const now = Date.now();
  cache.set(key, { value: data, fetchedAt, sourceFormat, expiresAt: now + SUCCESS_TTL_MS, staleUntil: now + STALE_TTL_MS });
  failureCache.delete(key);
}

function unavailableResult(sourceFormat: GdeltSourceFormat, cacheStatus: GdeltCacheStatus, errorCategory: GdeltOutcome): GdeltResult<GdeltArticle[]> {
  return { data: [], fetchedAt: new Date().toISOString(), isStale: false, sourceFormat, cacheStatus, errorCategory };
}

function parseRssArticles(xml: string): { rawCount: number; articles: GdeltArticle[] } {
  const blocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const articles = blocks.map((block) => mapArticle({
    title: xmlText(block, "title"),
    url: xmlText(block, "link"),
    seendate: xmlText(block, "pubDate")
  })).filter((article): article is GdeltArticle => article !== null).slice(0, MAX_ARTICLES);
  return { rawCount: blocks.length, articles };
}

async function requestAttempt(category: GdeltNewsCategory, sourceFormat: GdeltSourceFormat, attempt: number): Promise<RequestResult> {
  const url = buildUrl(category, sourceFormat);
  const rateLimitWaitMs = await reserveRequestSlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const base = { category, query: CATEGORY_QUERY[category], sourceFormat, requestUrl: url.toString(), attempt, timeoutMs: REQUEST_TIMEOUT_MS, rateLimitWaitMs };

  // Another queued category may have received Retry-After while this request waited.
  // Do not send a new JSON or RSS request until that provider-level cooldown expires.
  if (Date.now() < providerCooldownUntil) {
    clearTimeout(timeout);
    diagnostic({ ...base, outcome: "rate_limited_content", httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, cooldownUntil: providerCooldownUntil, errorCategory: "rate_limited_content" });
    return { articles: null, retryOnTimeout: false, allowRssFallback: false, sourceFormat, outcome: "rate_limited_content", cooldownMs: providerCooldownUntil - Date.now() };
  }

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: sourceFormat === "json" ? "application/json" : "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": "justin-stock-analysis-news/1.0"
      },
      signal: controller.signal
    });
    const raw = await response.text();
    const contentType = response.headers.get("content-type") ?? null;

    if (!response.ok) {
      const outcome = outcomeForHttpStatus(response.status);
      const cooldownMs = outcome === "http_429" ? parseRetryAfter(response.headers.get("retry-after")) : null;
      if (cooldownMs !== null) providerCooldownUntil = Math.max(providerCooldownUntil, Date.now() + cooldownMs);
      diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, retryAfterMs: cooldownMs, errorCategory: outcome });
      // 429 is a hard cooldown: never immediately retry JSON or fall through to RSS.
      return { articles: null, retryOnTimeout: false, allowRssFallback: sourceFormat === "json" && outcome !== "http_429", sourceFormat, outcome, cooldownMs };
    }

    if (looksLikeGdeltRateLimit(raw)) {
      const outcome: GdeltOutcome = "rate_limited_content";
      providerCooldownUntil = Math.max(providerCooldownUntil, Date.now() + DEFAULT_RETRY_AFTER_MS);
      diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, retryAfterMs: DEFAULT_RETRY_AFTER_MS, errorCategory: outcome });
      return { articles: null, retryOnTimeout: false, allowRssFallback: false, sourceFormat, outcome, cooldownMs: DEFAULT_RETRY_AFTER_MS };
    }

    if (sourceFormat === "rss") {
      const parsed = parseRssArticles(raw);
      const outcome: GdeltOutcome = parsed.rawCount === 0 ? "articles_empty" : parsed.articles.length === 0 ? "articles_filtered_empty" : "rss_fallback_success";
      diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: parsed.rawCount, filteredArticleCount: parsed.articles.length, errorCategory: outcome === "rss_fallback_success" ? null : outcome });
      return { articles: parsed.articles.length ? parsed.articles : null, retryOnTimeout: false, allowRssFallback: false, sourceFormat, outcome, cooldownMs: null };
    }

    let body: GdeltResponse;
    try {
      body = JSON.parse(raw) as GdeltResponse;
    } catch {
      const outcome: GdeltOutcome = "http_200_non_json";
      diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: outcome });
      return { articles: null, retryOnTimeout: false, allowRssFallback: true, sourceFormat, outcome, cooldownMs: null };
    }

    const topLevelFields = Object.keys(body).slice(0, 30);
    const articlesIsArray = Array.isArray(body.articles);
    const rows = articlesIsArray ? body.articles as GdeltArticleRow[] : [];
    const articles = rows.map(mapArticle).filter((article): article is GdeltArticle => article !== null).slice(0, MAX_ARTICLES);
    const outcome: GdeltOutcome = rows.length === 0 ? "articles_empty" : articles.length === 0 ? "articles_filtered_empty" : "success";
    diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields, articlesIsArray, rawArticleCount: rows.length, filteredArticleCount: articles.length, errorCategory: outcome === "success" ? null : outcome });
    return { articles: articles.length ? articles : null, retryOnTimeout: false, allowRssFallback: outcome !== "success", sourceFormat, outcome, cooldownMs: null };
  } catch (error) {
    const outcome = errorCategory(error);
    diagnostic({ ...base, outcome, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: outcome });
    return { articles: null, retryOnTimeout: outcome === "timeout" && sourceFormat === "json", allowRssFallback: sourceFormat === "json", sourceFormat, outcome, cooldownMs: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestArticles(category: GdeltNewsCategory): Promise<RequestResult> {
  let json = await requestAttempt(category, "json", 1);
  if (!json.articles && json.retryOnTimeout) json = await requestAttempt(category, "json", 2);
  // Invalid/empty JSON may use same-endpoint RSS fallback. 429 and public rate-limit notices never do.
  return json.articles || !json.allowRssFallback ? json : requestAttempt(category, "rss", 1);
}

function startRefresh(key: string, category: GdeltNewsCategory): void {
  if (inFlight.has(key) || Date.now() < providerCooldownUntil) return;
  const operation = (async (): Promise<void> => {
    try {
      const result = await requestArticles(category);
      if (result.articles) {
        cacheSuccess(key, result.articles, result.sourceFormat);
        diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: result.sourceFormat, requestUrl: buildUrl(category, result.sourceFormat).toString(), attempt: 0, outcome: result.outcome, cache: "refresh_success", timeoutMs: REQUEST_TIMEOUT_MS, errorCategory: null });
        return;
      }
      const cooldownUntil = result.cooldownMs ? Date.now() + result.cooldownMs : Date.now() + EMPTY_OR_FAILURE_TTL_MS;
      failureCache.set(key, { until: Math.max(cooldownUntil, providerCooldownUntil), outcome: result.outcome });
      diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: result.sourceFormat, requestUrl: buildUrl(category, result.sourceFormat).toString(), attempt: 0, outcome: result.outcome, cache: "refresh_failed_kept_last_known_good", timeoutMs: REQUEST_TIMEOUT_MS, cooldownUntil: Math.max(cooldownUntil, providerCooldownUntil), errorCategory: result.outcome });
    } catch (error) {
      const outcome: GdeltOutcome = "network_error";
      failureCache.set(key, { until: Date.now() + EMPTY_OR_FAILURE_TTL_MS, outcome });
      diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: "json", requestUrl: buildUrl(category, "json").toString(), attempt: 0, outcome, cache: "refresh_exception_kept_last_known_good", timeoutMs: REQUEST_TIMEOUT_MS, errorCategory: error instanceof Error ? error.name : outcome });
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, operation);
  // This is intentionally detached: a page receives cached data immediately.
  void operation;
}

/**
 * Returns fresh or last-known-good article metadata immediately.  A stale cache triggers a
 * best-effort background refresh.  With no historical success, it returns a structured empty
 * result immediately and starts one background request; it never synthesizes news.
 */
export async function getGdeltRecentArticles(category: GdeltNewsCategory, options: GdeltRefreshOptions = {}): Promise<GdeltResult<GdeltArticle[]> | null> {
  const key = `gdelt:doc:${category}:${CATEGORY_QUERY[category]}`;
  const { fresh, stale } = readCache(key);
  if (fresh && !options.forceRefresh) {
    diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: fresh.sourceFormat, requestUrl: buildUrl(category, fresh.sourceFormat).toString(), attempt: 0, outcome: "success", cache: "fresh", timeoutMs: REQUEST_TIMEOUT_MS, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: fresh.sourceFormat === "json", rawArticleCount: fresh.data.length, filteredArticleCount: fresh.data.length, errorCategory: null });
    return fresh;
  }

  // A forced refresh treats otherwise fresh data as immediately displayable stale data.
  // The refresh itself remains deduplicated and cannot bypass a provider cooldown.
  const reusableEntry = stale ?? (options.forceRefresh ? cache.get(key) ?? null : null);
  const failure = failureCache.get(key);
  const now = Date.now();
  const inCooldown = now < providerCooldownUntil || (failure?.until ?? 0) > now;
  if (reusableEntry) {
    const error = failure?.outcome ?? null;
    const status: GdeltCacheStatus = inCooldown ? "stale_cooldown" : "stale_refreshing";
    if (!inCooldown) startRefresh(key, category);
    diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: reusableEntry.sourceFormat, requestUrl: buildUrl(category, reusableEntry.sourceFormat).toString(), attempt: 0, outcome: error ?? "success", cache: status, forcedRefresh: Boolean(options.forceRefresh), timeoutMs: REQUEST_TIMEOUT_MS, staleUntil: reusableEntry.staleUntil, cooldownUntil: providerCooldownUntil || null, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: reusableEntry.sourceFormat === "json", rawArticleCount: reusableEntry.value.length, filteredArticleCount: reusableEntry.value.length, errorCategory: error });
    return cachedResult(reusableEntry, status, error);
  }

  const outcome = failure?.outcome ?? (inCooldown ? "rate_limited_content" : "refresh_started");
  const status: GdeltCacheStatus = inCooldown ? "unavailable_cooldown" : "unavailable_refreshing";
  if (!inCooldown) startRefresh(key, category);
  diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: "json", requestUrl: buildUrl(category, "json").toString(), attempt: 0, outcome, cache: status, timeoutMs: REQUEST_TIMEOUT_MS, cooldownUntil: providerCooldownUntil || null, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: outcome });
  return unavailableResult("json", status, outcome);
}
