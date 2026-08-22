const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const REQUEST_TIMEOUT_MS = 15_000;
const GDELT_TTL_MS = 30 * 60 * 1_000;
const FAILURE_TTL_MS = 5 * 60 * 1_000;
const STALE_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_ARTICLES = 6;

interface GdeltArticleRow {
  url?: unknown;
  url_mobile?: unknown;
  title?: unknown;
  seendate?: unknown;
  domain?: unknown;
  language?: unknown;
  sourcecountry?: unknown;
}

interface GdeltResponse {
  articles?: unknown;
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
  seenAt: string;
  domain: string | null;
  language: string | null;
  sourceCountry: string | null;
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

function validQuery(value: string): string | null {
  const query = value.trim().replace(/\s+/g, " ");
  return query && query.length <= 500 ? query : null;
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

function buildUrl(query: string): URL {
  const url = new URL(GDELT_DOC_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("timespan", "1week");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("maxrecords", String(MAX_ARTICLES));
  return url;
}

function mapArticle(row: GdeltArticleRow): GdeltArticle | null {
  const url = validUrl(row.url);
  const title = text(row.title, 400);
  const seenAt = text(row.seendate, 64);
  if (!url || !title || !seenAt) return null;
  return {
    title,
    url,
    seenAt,
    domain: text(row.domain, 160),
    language: text(row.language, 64),
    sourceCountry: text(row.sourcecountry, 96)
  };
}

async function requestArticles(query: string): Promise<GdeltArticle[] | null> {
  const url = buildUrl(query);
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
      console.warn("GDELT DOC response", { endpoint: url.origin + url.pathname, httpStatus: response.status, query, responsePreview: raw.slice(0, 500) });
      return null;
    }

    let body: GdeltResponse;
    try {
      body = JSON.parse(raw) as GdeltResponse;
    } catch {
      console.warn("GDELT DOC invalid JSON", { endpoint: url.origin + url.pathname, query, httpStatus: response.status });
      return null;
    }

    const rows = Array.isArray(body.articles) ? body.articles : [];
    const articles = rows
      .map((row) => mapArticle(row as GdeltArticleRow))
      .filter((row): row is GdeltArticle => row !== null)
      .slice(0, MAX_ARTICLES);
    if (articles.length === 0) {
      console.info("GDELT DOC no verifiable articles", { endpoint: url.origin + url.pathname, query });
      return null;
    }
    return articles;
  } catch (error) {
    console.warn("GDELT DOC request failed", {
      endpoint: url.origin + url.pathname,
      query,
      reason: error instanceof Error ? error.message : String(error)
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Returns recent, linked news metadata only. It does not infer facts from titles
 * and it never synthesizes prices, reserve values, or policy conclusions.
 */
export async function getGdeltRecentArticles(queryInput: string): Promise<GdeltResult<GdeltArticle[]> | null> {
  const query = validQuery(queryInput);
  if (!query) return null;
  const key = `gdelt:doc:${query.toLowerCase()}`;
  const { fresh, stale } = getCache<GdeltArticle[]>(key);
  if (fresh) return fresh;
  const running = inFlight.get(key) as Promise<GdeltResult<GdeltArticle[]> | null> | undefined;
  if (running) return running;

  const operation = (async (): Promise<GdeltResult<GdeltArticle[]> | null> => {
    try {
      const data = await requestArticles(query);
      if (!data) {
        cacheValue(key, null, FAILURE_TTL_MS, null);
        return stale;
      }
      const fetchedAt = new Date().toISOString();
      cacheValue(key, data, GDELT_TTL_MS, fetchedAt);
      return { data, fetchedAt, isStale: false };
    } catch (error) {
      console.warn("GDELT DOC fallback", { query, reason: error instanceof Error ? error.message : String(error) });
      cacheValue(key, null, FAILURE_TTL_MS, null);
      return stale;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, operation as Promise<GdeltResult<unknown> | null>);
  return operation;
}
