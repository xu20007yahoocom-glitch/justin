const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const REQUEST_TIMEOUT_MS = 12_000;
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

export interface GdeltResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
  sourceFormat: GdeltSourceFormat;
}

export interface GdeltArticle {
  title: string;
  url: string;
  seenAt: string | null;
  domain: string | null;
  language: string | null;
  sourceCountry: string | null;
}

type GdeltOutcome =
  | "success"
  | "rss_fallback_success"
  | "timeout"
  | "network_error"
  | "http_429"
  | "http_403"
  | "http_5xx"
  | "http_error"
  | "http_200_non_json"
  | "articles_empty"
  | "articles_filtered_empty";

interface RequestResult {
  articles: GdeltArticle[] | null;
  retryOnTimeout: boolean;
  sourceFormat: GdeltSourceFormat;
}

const cache = new Map<string, CacheEntry<GdeltArticle[]>>();
const failureCacheUntil = new Map<string, number>();
const inFlight = new Map<string, Promise<GdeltResult<GdeltArticle[]> | null>>();

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

function cacheSuccess(key: string, data: GdeltArticle[], sourceFormat: GdeltSourceFormat): GdeltResult<GdeltArticle[]> {
  const fetchedAt = new Date().toISOString();
  const now = Date.now();
  cache.set(key, { value: data, fetchedAt, sourceFormat, expiresAt: now + SUCCESS_TTL_MS, staleUntil: now + SUCCESS_TTL_MS + STALE_TTL_MS });
  failureCacheUntil.delete(key);
  return { data, fetchedAt, sourceFormat, isStale: false };
}

function getCache(key: string): { fresh: GdeltResult<GdeltArticle[]> | null; stale: GdeltResult<GdeltArticle[]> | null } {
  const entry = cache.get(key);
  if (!entry) return { fresh: null, stale: null };
  const now = Date.now();
  if (now <= entry.expiresAt) return { fresh: { data: entry.value, fetchedAt: entry.fetchedAt, sourceFormat: entry.sourceFormat, isStale: false }, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: { data: entry.value, fetchedAt: entry.fetchedAt, sourceFormat: entry.sourceFormat, isStale: true } };
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const base = { category, query: CATEGORY_QUERY[category], sourceFormat, requestUrl: url.toString(), attempt };

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: sourceFormat === "json" ? "application/json" : "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" },
      signal: controller.signal
    });
    const raw = await response.text();
    const contentType = response.headers.get("content-type") ?? null;

    if (!response.ok) {
      diagnostic({ ...base, outcome: outcomeForHttpStatus(response.status), httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: null });
      return { articles: null, retryOnTimeout: false, sourceFormat };
    }

    if (sourceFormat === "rss") {
      const parsed = parseRssArticles(raw);
      const outcome: GdeltOutcome = parsed.rawCount === 0 ? "articles_empty" : parsed.articles.length === 0 ? "articles_filtered_empty" : "rss_fallback_success";
      diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: parsed.rawCount, filteredArticleCount: parsed.articles.length, errorCategory: null });
      return { articles: parsed.articles.length ? parsed.articles : null, retryOnTimeout: false, sourceFormat };
    }

    let body: GdeltResponse;
    try {
      body = JSON.parse(raw) as GdeltResponse;
    } catch {
      diagnostic({ ...base, outcome: "http_200_non_json", httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: "json_parse" });
      return { articles: null, retryOnTimeout: false, sourceFormat };
    }

    const topLevelFields = Object.keys(body).slice(0, 30);
    const articlesIsArray = Array.isArray(body.articles);
    const rows = articlesIsArray ? body.articles as GdeltArticleRow[] : [];
    const articles = rows.map(mapArticle).filter((article): article is GdeltArticle => article !== null).slice(0, MAX_ARTICLES);
    const outcome: GdeltOutcome = rows.length === 0 ? "articles_empty" : articles.length === 0 ? "articles_filtered_empty" : "success";
    diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields, articlesIsArray, rawArticleCount: rows.length, filteredArticleCount: articles.length, errorCategory: null });
    return { articles: articles.length ? articles : null, retryOnTimeout: false, sourceFormat };
  } catch (error) {
    const categoryName = errorCategory(error);
    diagnostic({ ...base, outcome: categoryName, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: categoryName });
    return { articles: null, retryOnTimeout: categoryName === "timeout" && sourceFormat === "json", sourceFormat };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestArticles(category: GdeltNewsCategory): Promise<RequestResult> {
  let json = await requestAttempt(category, "json", 1);
  if (!json.articles && json.retryOnTimeout) json = await requestAttempt(category, "json", 2);
  // JSON timeout, HTTP/parse failure or empty output falls back to the same GDELT DOC endpoint in RSS format.
  return json.articles ? json : requestAttempt(category, "rss", 1);
}

/**
 * Fetches only article metadata from fixed, public GDELT probes. It never synthesizes news.
 * JSON is preferred; GDELT RSS is a same-endpoint fallback when JSON is unusable.
 */
export async function getGdeltRecentArticles(category: GdeltNewsCategory): Promise<GdeltResult<GdeltArticle[]> | null> {
  const key = `gdelt:doc:${category}:${CATEGORY_QUERY[category]}`;
  const { fresh, stale } = getCache(key);
  if (fresh) {
    diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: fresh.sourceFormat, requestUrl: buildUrl(category, fresh.sourceFormat).toString(), attempt: 0, outcome: "success", cache: "fresh", httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: fresh.sourceFormat === "json", rawArticleCount: fresh.data.length, filteredArticleCount: fresh.data.length, errorCategory: null });
    return fresh;
  }
  const failureUntil = failureCacheUntil.get(key) ?? 0;
  if (failureUntil > Date.now()) {
    diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: "json", requestUrl: buildUrl(category, "json").toString(), attempt: 0, outcome: "network_error", cache: "failure_short", httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: "short_failure_cache" });
    return stale;
  }
  const running = inFlight.get(key);
  if (running) return running;

  const operation = (async (): Promise<GdeltResult<GdeltArticle[]> | null> => {
    try {
      const result = await requestArticles(category);
      if (!result.articles) {
        failureCacheUntil.set(key, Date.now() + EMPTY_OR_FAILURE_TTL_MS);
        // Retain the last successful payload as stale; a failed refresh never overwrites it.
        return stale;
      }
      return cacheSuccess(key, result.articles, result.sourceFormat);
    } catch (error) {
      diagnostic({ category, query: CATEGORY_QUERY[category], sourceFormat: "json", requestUrl: buildUrl(category, "json").toString(), attempt: 0, outcome: "network_error", httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: error instanceof Error ? error.name : "unknown" });
      failureCacheUntil.set(key, Date.now() + EMPTY_OR_FAILURE_TTL_MS);
      return stale;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, operation);
  return operation;
}
