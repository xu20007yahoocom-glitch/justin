const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const REQUEST_TIMEOUT_MS = 12_000;
const SUCCESS_TTL_MS = 30 * 60 * 1_000;
const EMPTY_OR_FAILURE_TTL_MS = 60_000;
const STALE_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_ARTICLES = 5;

export type GdeltNewsCategory = "geopolitical" | "economic";

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
  value: T | null;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string | null;
}

export interface GdeltResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
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
  | "not_started"
  | "timeout"
  | "network_error"
  | "http_429"
  | "http_403"
  | "http_5xx"
  | "http_error"
  | "http_200_non_json"
  | "articles_empty"
  | "articles_filtered_empty";

interface FetchAttemptResult {
  articles: GdeltArticle[] | null;
  retryOnTimeout: boolean;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<GdeltResult<unknown> | null>>();

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

function cacheValue<T>(key: string, value: T | null, ttlMs: number, fetchedAt: string | null): void {
  const now = Date.now();
  cache.set(key, { value, expiresAt: now + ttlMs, staleUntil: now + ttlMs + STALE_TTL_MS, fetchedAt });
}

function getCache<T>(key: string): { fresh: GdeltResult<T> | null; stale: GdeltResult<T> | null } {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.value === null || !entry.fetchedAt) return { fresh: null, stale: null };
  const now = Date.now();
  const result: GdeltResult<T> = { data: entry.value, fetchedAt: entry.fetchedAt, isStale: now > entry.expiresAt };
  if (now <= entry.expiresAt) return { fresh: result, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: result };
  cache.delete(key);
  return { fresh: null, stale: null };
}

/** Builds the public, fully encoded GDELT DOC 2.0 ArtList probe URL. */
function buildUrl(category: GdeltNewsCategory): URL {
  const params = new URLSearchParams({
    query: CATEGORY_QUERY[category],
    mode: "artlist",
    format: "json",
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

function diagnostic(payload: Record<string, unknown>): void {
  // Deliberately excludes response bodies, article text and any credentials.
  console.info("GDELT_DIAGNOSTIC", payload);
}

function mapArticle(row: GdeltArticleRow): GdeltArticle | null {
  const url = validUrl(row.url);
  const title = text(row.title, 400);
  // A malformed or absent date must not remove an otherwise valid article.
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

async function requestAttempt(category: GdeltNewsCategory, attempt: number): Promise<FetchAttemptResult> {
  const url = buildUrl(category);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const base = { category, query: CATEGORY_QUERY[category], requestUrl: url.toString(), attempt };

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const raw = await response.text();
    const contentType = response.headers.get("content-type") ?? null;

    if (!response.ok) {
      diagnostic({ ...base, outcome: outcomeForHttpStatus(response.status), httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: null });
      return { articles: null, retryOnTimeout: false };
    }

    let body: GdeltResponse;
    try {
      body = JSON.parse(raw) as GdeltResponse;
    } catch {
      diagnostic({ ...base, outcome: "http_200_non_json", httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: "json_parse" });
      return { articles: null, retryOnTimeout: false };
    }

    const topLevelFields = Object.keys(body).slice(0, 30);
    const articlesIsArray = Array.isArray(body.articles);
    const rows = articlesIsArray ? body.articles as GdeltArticleRow[] : [];
    const articles = rows.map(mapArticle).filter((article): article is GdeltArticle => article !== null).slice(0, MAX_ARTICLES);
    const outcome: GdeltOutcome = rows.length === 0 ? "articles_empty" : articles.length === 0 ? "articles_filtered_empty" : "success";
    diagnostic({ ...base, outcome, httpStatus: response.status, contentType, responseTextLength: raw.length, topLevelFields, articlesIsArray, rawArticleCount: rows.length, filteredArticleCount: articles.length, errorCategory: null });
    return { articles: articles.length > 0 ? articles : null, retryOnTimeout: false };
  } catch (error) {
    const categoryName = errorCategory(error);
    diagnostic({ ...base, outcome: categoryName, httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: categoryName });
    return { articles: null, retryOnTimeout: categoryName === "timeout" };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestArticles(category: GdeltNewsCategory): Promise<GdeltArticle[] | null> {
  const initial = await requestAttempt(category, 1);
  if (initial.articles || !initial.retryOnTimeout) return initial.articles;
  // Exactly one retry after a timeout; the query remains the same simple probe.
  return (await requestAttempt(category, 2)).articles;
}

/**
 * Returns only linked GDELT article metadata for the fixed simple category probe.
 * It never synthesizes news and never requires optional article fields.
 */
export async function getGdeltRecentArticles(category: GdeltNewsCategory): Promise<GdeltResult<GdeltArticle[]> | null> {
  const key = `gdelt:doc:${category}:${CATEGORY_QUERY[category]}`;
  const { fresh, stale } = getCache<GdeltArticle[]>(key);
  if (fresh) {
    diagnostic({ category, query: CATEGORY_QUERY[category], requestUrl: buildUrl(category).toString(), attempt: 0, outcome: "success", cache: "fresh", httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: true, rawArticleCount: fresh.data.length, filteredArticleCount: fresh.data.length, errorCategory: null });
    return fresh;
  }
  const running = inFlight.get(key) as Promise<GdeltResult<GdeltArticle[]> | null> | undefined;
  if (running) return running;

  const operation = (async (): Promise<GdeltResult<GdeltArticle[]> | null> => {
    try {
      const data = await requestArticles(category);
      if (!data) {
        // Empty/error responses get only a short cache and never overwrite a good stale result.
        cacheValue(key, null, EMPTY_OR_FAILURE_TTL_MS, null);
        return stale;
      }
      const fetchedAt = new Date().toISOString();
      cacheValue(key, data, SUCCESS_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: false };
    } catch (error) {
      diagnostic({ category, query: CATEGORY_QUERY[category], requestUrl: buildUrl(category).toString(), attempt: 0, outcome: "network_error", httpStatus: null, contentType: null, responseTextLength: 0, topLevelFields: [], articlesIsArray: false, rawArticleCount: 0, filteredArticleCount: 0, errorCategory: error instanceof Error ? error.name : "unknown" });
      cacheValue(key, null, EMPTY_OR_FAILURE_TTL_MS, null);
      return stale;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, operation as Promise<GdeltResult<unknown> | null>);
  return operation;
}
