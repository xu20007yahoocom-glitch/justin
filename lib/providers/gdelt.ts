const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const REQUEST_TIMEOUT_MS = 12_000;
// GDELT's public DOC endpoint asks clients to limit requests to one every five seconds.
const MIN_REQUEST_INTERVAL_MS = 5_200;
const SUCCESS_TTL_MS = 30 * 60 * 1_000;
const EMPTY_OR_FAILURE_TTL_MS = 60_000;
const STALE_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_ARTICLES = 5;

export type GdeltNewsCategory = "geopolitical" | "economic";
export type GdeltSourceFormat = "json" | "rss";

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
  | "failure_short_cache";

export interface GdeltResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
  sourceFormat: GdeltSourceFormat;
  /** Null for a verified article payload; otherwise a safe, non-body diagnostic category. */
  errorCategory: GdeltOutcome | null;
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
}

const cache = new Map<string, CacheEntry<GdeltArticle[]>>();
const failureCacheUntil = new Map<string, number>();
const inFlight = new Map<string, Promise<GdeltResult<GdeltArticle[]> | null>>();
let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

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
  // Does not include response bodies, article descriptions, credentials or user data.
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

function errorCategory(error: unknown): "timeout" | "network_error" {
  return error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
}

function looksLikeGdeltRateLimit(raw: string): boolean {
  return /please limit requests to one every\s+\d+\s+seconds|high-traffic users should switch/i.test(raw);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes outbound DOC API starts without requiring an API key. */
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

function cacheSuccess(key: string, data: GdeltArticle[], sourceFormat: GdeltSourceFormat): GdeltResult<GdeltArticle[]> {
  const fetchedAt = new Date().toISOString();
  const now = Date.now();
  cache.set(key, { value: data, fetchedAt, sourceFormat, expiresAt: now + SUCCESS_TTL_MS, staleUntil: now + SUCCESS_TTL_MS + STALE_TTL_MS });
  failureCacheUntil.delete(key);
  return { data, fetchedAt, sourceFormat, isStale: false, errorCategory: null };
}

function getCache(key: string): { fresh: GdeltResult<GdeltArticle[]> | null; stale: GdeltResult<GdeltArticle[]> | null } {
  const entry = cache.get(key);
  if (!entry) return { fresh: null, stale: null };
  const now = Date.now();
  if (now <= entry.expiresAt) return { fresh: { data: entry.value, fetchedAt: entry.fetchedAt, sourceFormat: entry.sourceFormat, isStale: false, errorCategory: null }, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: { data: entry.value, fetchedAt: entry.fetchedAt, sourceFormat: entry.sourceFormat, isStale: true, errorCategory: null } };
  cache.delete(key);
  return { fresh: null, stale: null };
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
      diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: outcome });
      return { articles: null, retryOnTimeout: false, allowRssFallback: sourceFormat === "json" && outcome !== "http_429", sourceFormat, outcome };
    }

    // GDELT can return a plaintext public-rate-limit notice with HTTP 200.
    if (looksLikeGdeltRateLimit(raw)) {
      const outcome: GdeltOutcome = "rate_limited_content";
      diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: outcome });
      return { articles: null, retryOnTimeout: false, allowRssFallback: false, sourceFormat, outcome };
    }

    if (sourceFormat === "rss") {
      const parsed = parseRssArticles(raw);
      const outcome: GdeltOutcome = parsed.rawCount === 0 ? "articles_empty" : parsed.articles.length === 0 ? "articles_filtered_empty" : "rss_fallback_success";
      diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: parsed.rawCount, filteredArticleCount: parsed.articles.length, errorCategory: outcome === "rss_fallback_success" ? null : outcome });
      return { articles: parsed.articles.length ? parsed.articles : null, retryOnTimeout: false, allowRssFallback: false, sourceFormat, outcome };
    }

    let body: GdeltResponse;
    try {
      body = JSON.parse(raw) as GdeltResponse;
    } catch {
      const outcome: GdeltOutcome = "http_200_non_json";
      diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: outcome });
      return { articles: null, retryOnTimeout: false, allowRssFallback: true, sourceFormat, outcome };
    }

    const topLevelFields = Object.keys(body).slice(0, 30);
    const articlesIsArray = Array.isArray(body.articles);
    const rows = articlesIsArray ? body.articles as GdeltArticleRow[] : [];
    const articles = rows.map(mapArticle).filter((article): article is GdeltArticle => article !== null).slice(0, MAX_ARTICLES);
    const outcome: GdeltOutcome = rows.length === 0 ? "articles_empty" : articles.length === 0 ? "articles_filtered_empty" : "success";
    diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields, articlesIsArray, rawArticleCount: rows.length, filteredArticleCount: articles.length, errorCategory: outcome === "success" ? null : outcome });
    return { articles: articles.length ? articles : null, retryOnTimeout: false, allowRssFallback: outcome !== "success", sourceFormat, outcome };
  } catch (error) {
    const outcome = errorCategory(error);
    diagnostic({ ...base, outcome, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: outcome });
    return { articles: null, retryOnTimeout: outcome === "timeout" && sourceFormat === "json", allowRssFallback: sourceFormat === "json", sourceFormat, outcome };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestArticles(category: GdeltNewsCategory): Promise<RequestResult> {
  let json = await requestAttempt(category, "json", 1);
  if (!json.articles && json.retryOnTimeout) json = await requestAttempt(category, "json", 2);
  // Invalid/empty JSON may use same-endpoint RSS fallback; explicit public rate limiting does not send another immediate request.
  return json.articles || !json.allowRssFallback ? json : requestAttempt(category, "rss", 1);
}

function failureResult(sourceFormat: GdeltSourceFormat, outcome: GdeltOutcome): GdeltResult<GdeltArticle[]> {
  return { data: [], fetchedAt: new Date().toISOString(), isStale: false, sourceFormat, errorCategory: outcome };
}

/**
 * Fetches only article metadata from fixed, public GDELT probes. It never synthesizes news.
 * JSON is preferred; GDELT RSS is a same-endpoint fallback when JSON is unusable.
 */
export async function getGdeltRecentArticles(category: GdeltNewsCategory): Promise<GdeltResult<GdeltArticle[]> | null> {
  const key = `gdelt:doc:${category}:${CATEGORY_QUERY[category]}`;
  const { fresh, stale } = getCache(key);
  if (fresh) {
    diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: fresh.sourceFormat, requestUrl: buildUrl(category, fresh.sourceFormat).toString(), attempt: 0, outcome: "success", cache: "fresh", timeoutMs: REQUEST_TIMEOUT_MS, rateLimitWaitMs: 0, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: fresh.sourceFormat === "json", rawArticleCount: fresh.data.length, filteredArticleCount: fresh.data.length, errorCategory: null });
    return fresh;
  }
  const failureUntil = failureCacheUntil.get(key) ?? 0;
  if (failureUntil > Date.now()) {
    diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: "json", requestUrl: buildUrl(category, "json").toString(), attempt: 0, outcome: "failure_short_cache", cache: "failure_short", timeoutMs: REQUEST_TIMEOUT_MS, rateLimitWaitMs: 0, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: "failure_short_cache" });
    return stale ?? failureResult("json", "failure_short_cache");
  }
  const running = inFlight.get(key);
  if (running) return running;

  const operation = (async (): Promise<GdeltResult<GdeltArticle[]> | null> => {
    try {
      const result = await requestArticles(category);
      if (!result.articles) {
        failureCacheUntil.set(key, Date.now() + EMPTY_OR_FAILURE_TTL_MS);
        // Retain the last successful payload as stale; a failed refresh never overwrites it.
        return stale ?? failureResult(result.sourceFormat, result.outcome);
      }
      return cacheSuccess(key, result.articles, result.sourceFormat);
    } catch (error) {
      const outcome: GdeltOutcome = "network_error";
      diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: "json", requestUrl: buildUrl(category, "json").toString(), attempt: 0, outcome, timeoutMs: REQUEST_TIMEOUT_MS, rateLimitWaitMs: 0, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: error instanceof Error ? error.name : outcome });
      failureCacheUntil.set(key, Date.now() + EMPTY_OR_FAILURE_TTL_MS);
      return stale ?? failureResult("json", outcome);
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, operation);
  return operation;
}
