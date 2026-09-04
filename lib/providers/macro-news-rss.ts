import { waitUntil } from "@vercel/functions";

const SOURCE_TIMEOUT_MS = 6_000;
const FRESH_TTL_MS = 15 * 60 * 1_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 60 * 1_000;
const MAX_ARTICLES_PER_CATEGORY = 5;
const MANUAL_JOIN_MAX_AGE_MS = 3_000;
const MANUAL_JOIN_MIN_REMAINING_MS = 3_000;

export type MacroRssCategory = "geopolitical" | "economic";
export type MacroRssSourceName = "BBC News" | "UN News" | "Federal Reserve" | "European Central Bank";
export type MacroRssCacheStatus = "fresh" | "stale" | "stale_refreshing" | "unavailable";

export interface MacroRssSourceDefinition {
  id: string;
  category: MacroRssCategory;
  sourceName: MacroRssSourceName;
  endpoint: string;
  sourceUrl: string;
}

export const MACRO_RSS_SOURCES: readonly MacroRssSourceDefinition[] = [
  { id: "bbc-world", category: "geopolitical", sourceName: "BBC News", endpoint: "https://feeds.bbci.co.uk/news/world/rss.xml", sourceUrl: "https://www.bbc.com/news/world" },
  { id: "un-news", category: "geopolitical", sourceName: "UN News", endpoint: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", sourceUrl: "https://news.un.org/" },
  { id: "bbc-business", category: "economic", sourceName: "BBC News", endpoint: "https://feeds.bbci.co.uk/news/business/rss.xml", sourceUrl: "https://www.bbc.com/business" },
  { id: "federal-reserve", category: "economic", sourceName: "Federal Reserve", endpoint: "https://www.federalreserve.gov/feeds/press_all.xml", sourceUrl: "https://www.federalreserve.gov/" },
  { id: "ecb", category: "economic", sourceName: "European Central Bank", endpoint: "https://www.ecb.europa.eu/rss/press.html", sourceUrl: "https://www.ecb.europa.eu/" }
] as const;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string;
}

interface FailureEntry {
  until: number;
  errorCategory: MacroRssErrorCategory;
}

interface SourceInFlightEntry {
  promise: Promise<SourceFetchResult>;
  controller: AbortController;
  startedAt: number;
  deadlineAt: number;
  source: MacroRssSourceDefinition;
  settled: boolean;
}

interface CategoryInFlightEntry {
  promise: Promise<MacroRssCategoryResult>;
  startedAt: number;
  deadlineAt: number;
  settled: boolean;
}

export type MacroRssErrorCategory = "timeout" | "network_error" | "http_403" | "http_429" | "http_5xx" | "http_error" | "parse_error" | "items_empty" | "items_filtered_empty" | "short_failure_cache";

export interface MacroRssArticle {
  title: string;
  url: string;
  publishedAt: string | null;
  description: string | null;
  sourceName: MacroRssSourceName;
  sourceUrl: string;
}

export interface MacroRssSourceResult {
  source: MacroRssSourceDefinition;
  data: MacroRssArticle[];
  fetchedAt: string | null;
  isStale: boolean;
  cacheStatus: MacroRssCacheStatus;
  errorCategory: MacroRssErrorCategory | null;
  rawCount: number;
  parsedCount: number;
  filteredCount: number;
}

export interface MacroRssCategoryResult {
  category: MacroRssCategory;
  data: MacroRssArticle[];
  fetchedAt: string | null;
  isStale: boolean;
  cacheStatus: MacroRssCacheStatus;
  errorCategory: MacroRssErrorCategory | null;
  sourceResults: MacroRssSourceResult[];
}

export interface MacroRssRefreshOptions {
  forceRefresh?: boolean;
  awaitRefresh?: boolean;
  requestId?: string;
  refreshId?: string;
  invocationStartedAt?: string;
  deadlineAt?: number;
}

interface ParsedFeed {
  rawCount: number;
  parsedCount: number;
  filteredCount: number;
  articles: MacroRssArticle[];
}

interface SourceFetchResult {
  source: MacroRssSourceDefinition;
  articles: MacroRssArticle[] | null;
  rawCount: number;
  parsedCount: number;
  filteredCount: number;
  httpStatus: number | null;
  contentType: string | null;
  responseTextLength: number;
  providerStartedAt: string | null;
  providerEndedAt: string | null;
  elapsedMs: number;
  errorCategory: MacroRssErrorCategory | null;
}

const sourceCache = new Map<string, CacheEntry<MacroRssArticle[]>>();
const categoryCache = new Map<string, CacheEntry<MacroRssCategoryResult>>();
const sourceFailureCache = new Map<string, FailureEntry>();
const categoryFailureCache = new Map<string, FailureEntry>();
const sourceInFlight = new Map<string, SourceInFlightEntry>();
const categoryInFlight = new Map<string, CategoryInFlightEntry>();

function diagnostic(payload: Record<string, unknown>): void {
  // Do not log RSS bodies, full article text, credentials, cookies, or request headers.
  console.info("MACRO_RSS_DIAGNOSTIC", payload);
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

function xmlLink(block: string): string | null {
  const atomHref = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i)?.[1];
  return validHttpUrl(atomHref ?? xmlText(block, "link"));
}

function validHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  return parsed.toString();
}

function dateValue(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFeed(xml: string, source: MacroRssSourceDefinition): ParsedFeed {
  const rssItems = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const atomEntries = rssItems.length ? [] : [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  const blocks = rssItems.length ? rssItems : atomEntries;
  const seen = new Set<string>();
  const articles: MacroRssArticle[] = [];
  let parsedCount = 0;
  for (const block of blocks) {
    const title = xmlText(block, "title");
    const url = xmlLink(block);
    const publishedAt = xmlText(block, "pubDate") ?? xmlText(block, "published") ?? xmlText(block, "updated") ?? xmlText(block, "dc:date");
    const description = xmlText(block, "description") ?? xmlText(block, "summary") ?? xmlText(block, "content");
    // Only title and an original HTTP(S) link are mandatory. Other metadata stays optional.
    if (!title || !url) continue;
    const dedupeKey = normalizedUrl(url);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    parsedCount += 1;
    articles.push({
      title: title.slice(0, 500),
      url,
      publishedAt: publishedAt?.slice(0, 160) ?? null,
      description: description?.slice(0, 1_000) ?? null,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl
    });
  }
  return { rawCount: blocks.length, parsedCount, filteredCount: articles.length, articles };
}

function elapsedMs(startedAt: string | null, endedAt: string | null): number {
  if (!startedAt || !endedAt) return 0;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function cachedSourceResult(source: MacroRssSourceDefinition, entry: CacheEntry<MacroRssArticle[]>, cacheStatus: MacroRssCacheStatus, errorCategory: MacroRssErrorCategory | null = null): MacroRssSourceResult {
  return {
    source,
    data: entry.value,
    fetchedAt: entry.fetchedAt,
    isStale: cacheStatus !== "fresh",
    cacheStatus,
    errorCategory,
    rawCount: entry.value.length,
    parsedCount: entry.value.length,
    filteredCount: entry.value.length
  };
}

function readSourceCache(source: MacroRssSourceDefinition): { fresh: CacheEntry<MacroRssArticle[]> | null; stale: CacheEntry<MacroRssArticle[]> | null } {
  const entry = sourceCache.get(source.id);
  if (!entry) return { fresh: null, stale: null };
  const now = Date.now();
  if (now <= entry.expiresAt) return { fresh: entry, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: entry };
  sourceCache.delete(source.id);
  return { fresh: null, stale: null };
}

function cacheSourceSuccess(source: MacroRssSourceDefinition, articles: MacroRssArticle[]): MacroRssSourceResult {
  const now = Date.now();
  const entry: CacheEntry<MacroRssArticle[]> = { value: articles, expiresAt: now + FRESH_TTL_MS, staleUntil: now + STALE_TTL_MS, fetchedAt: new Date(now).toISOString() };
  sourceCache.set(source.id, entry);
  sourceFailureCache.delete(source.id);
  return cachedSourceResult(source, entry, "fresh");
}

function sourceDeadlineAt(options: MacroRssRefreshOptions): number {
  const ownDeadline = Date.now() + SOURCE_TIMEOUT_MS;
  return options.deadlineAt ? Math.min(options.deadlineAt, ownDeadline) : ownDeadline;
}

function canManualJoin(entry: SourceInFlightEntry): boolean {
  const now = Date.now();
  const age = Math.max(0, now - entry.startedAt);
  const remaining = Math.max(0, entry.deadlineAt - now);
  return !entry.settled && !entry.controller.signal.aborted && age < MANUAL_JOIN_MAX_AGE_MS && remaining >= MANUAL_JOIN_MIN_REMAINING_MS;
}

function abortSourceEntry(source: MacroRssSourceDefinition, entry: SourceInFlightEntry, reason: "manual_replaced" | "deadline"): void {
  if (!entry.controller.signal.aborted) entry.controller.abort();
  if (sourceInFlight.get(source.id) === entry) sourceInFlight.delete(source.id);
  diagnostic({ event: "source_inflight_aborted", provider: source.sourceName, endpoint: source.endpoint, reason, startedAt: new Date(entry.startedAt).toISOString(), deadlineAt: new Date(entry.deadlineAt).toISOString() });
}

async function fetchSource(source: MacroRssSourceDefinition, options: MacroRssRefreshOptions, entry: SourceInFlightEntry): Promise<SourceFetchResult> {
  const providerStartedAt = new Date().toISOString();
  const remainingMs = Math.max(0, entry.deadlineAt - Date.now());
  const base = { requestId: options.requestId ?? null, refreshId: options.refreshId ?? null, invocationStartedAt: options.invocationStartedAt ?? null, provider: source.sourceName, endpoint: source.endpoint, category: source.category, cacheStatus: "refreshing", timeoutMs: Math.max(0, entry.deadlineAt - entry.startedAt), remainingMs };
  if (remainingMs <= 0 || entry.controller.signal.aborted) {
    const providerEndedAt = new Date().toISOString();
    diagnostic({ ...base, event: "provider_request_failed", httpStatus: null, contentType: null, responseTextLength: 0, rawCount: 0, parsedCount: 0, filteredCount: 0, elapsedMs: 0, cacheStatus: "unavailable", errorCategory: "timeout" });
    return { source, articles: null, rawCount: 0, parsedCount: 0, filteredCount: 0, httpStatus: null, contentType: null, responseTextLength: 0, providerStartedAt: null, providerEndedAt, elapsedMs: 0, errorCategory: "timeout" };
  }
  diagnostic({ ...base, event: "provider_request_started", httpStatus: null, contentType: null, responseTextLength: 0, rawCount: 0, parsedCount: 0, filteredCount: 0, elapsedMs: 0, errorCategory: null });
  try {
    const response = await fetch(source.endpoint, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; JustinMacroReference/1.0; +https://github.com/xu20007yahoocom-glitch/justin)"
      },
      signal: entry.controller.signal
    });
    const xml = await response.text();
    const contentType = response.headers.get("content-type") ?? null;
    const providerEndedAt = new Date().toISOString();
    const duration = elapsedMs(providerStartedAt, providerEndedAt);
    if (!response.ok) {
      const errorCategory: MacroRssErrorCategory = response.status === 403 ? "http_403" : response.status === 429 ? "http_429" : response.status >= 500 ? "http_5xx" : "http_error";
      diagnostic({ ...base, event: "provider_response_received", httpStatus: response.status, contentType, responseTextLength: xml.length, rawCount: 0, parsedCount: 0, filteredCount: 0, elapsedMs: duration, cacheStatus: "unavailable", errorCategory });
      return { source, articles: null, rawCount: 0, parsedCount: 0, filteredCount: 0, httpStatus: response.status, contentType, responseTextLength: xml.length, providerStartedAt, providerEndedAt, elapsedMs: duration, errorCategory };
    }
    const parsed = parseFeed(xml, source);
    const hasFeedMarkup = /<(?:rss|feed|channel)\b/i.test(xml);
    const errorCategory: MacroRssErrorCategory | null = !hasFeedMarkup ? "parse_error" : parsed.rawCount === 0 ? "items_empty" : parsed.parsedCount === 0 ? "items_filtered_empty" : null;
    diagnostic({ ...base, event: "provider_response_received", httpStatus: response.status, contentType, responseTextLength: xml.length, rawCount: parsed.rawCount, parsedCount: parsed.parsedCount, filteredCount: parsed.filteredCount, elapsedMs: duration, cacheStatus: errorCategory ? "unavailable" : "fresh", errorCategory });
    return { source, articles: parsed.articles.length ? parsed.articles : null, rawCount: parsed.rawCount, parsedCount: parsed.parsedCount, filteredCount: parsed.filteredCount, httpStatus: response.status, contentType, responseTextLength: xml.length, providerStartedAt, providerEndedAt, elapsedMs: duration, errorCategory };
  } catch (error) {
    const providerEndedAt = new Date().toISOString();
    const errorCategory: MacroRssErrorCategory = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    diagnostic({ ...base, event: "provider_request_failed", httpStatus: null, contentType: null, responseTextLength: 0, rawCount: 0, parsedCount: 0, filteredCount: 0, elapsedMs: elapsedMs(providerStartedAt, providerEndedAt), cacheStatus: "unavailable", errorCategory });
    return { source, articles: null, rawCount: 0, parsedCount: 0, filteredCount: 0, httpStatus: null, contentType: null, responseTextLength: 0, providerStartedAt, providerEndedAt, elapsedMs: elapsedMs(providerStartedAt, providerEndedAt), errorCategory };
  }
}

function startSourceFetch(source: MacroRssSourceDefinition, options: MacroRssRefreshOptions): Promise<SourceFetchResult> {
  const running = sourceInFlight.get(source.id);
  if (running) {
    if (!options.awaitRefresh || canManualJoin(running)) return running.promise;
    abortSourceEntry(source, running, "manual_replaced");
  }
  const startedAt = Date.now();
  const deadlineAt = sourceDeadlineAt(options);
  const controller = new AbortController();
  const entry: SourceInFlightEntry = { promise: Promise.resolve(null as never), controller, startedAt, deadlineAt, source, settled: false };
  const timer = setTimeout(() => abortSourceEntry(source, entry, "deadline"), Math.max(1, deadlineAt - Date.now()));
  const operation = (async (): Promise<SourceFetchResult> => {
    try {
      return await fetchSource(source, options, entry);
    } finally {
      clearTimeout(timer);
      entry.settled = true;
      if (sourceInFlight.get(source.id) === entry) sourceInFlight.delete(source.id);
    }
  })();
  entry.promise = operation;
  sourceInFlight.set(source.id, entry);
  return operation;
}

async function getSourceNews(source: MacroRssSourceDefinition, options: MacroRssRefreshOptions): Promise<MacroRssSourceResult> {
  const { fresh, stale } = readSourceCache(source);
  const fallback = stale ?? (options.forceRefresh && fresh ? fresh : null);
  const failure = sourceFailureCache.get(source.id);
  const now = Date.now();
  if (failure && failure.until <= now) sourceFailureCache.delete(source.id);
  const activeFailure = failure && failure.until > now ? failure : null;
  if (fresh && !options.forceRefresh) return cachedSourceResult(source, fresh, "fresh");
  if (activeFailure && !options.awaitRefresh) return fallback ? cachedSourceResult(source, fallback, "stale", activeFailure.errorCategory) : { source, data: [], fetchedAt: null, isStale: true, cacheStatus: "unavailable", errorCategory: activeFailure.errorCategory, rawCount: 0, parsedCount: 0, filteredCount: 0 };
  if (!options.awaitRefresh && fallback) {
    waitUntil(startSourceFetch(source, options).then((result) => {
      if (result.articles) cacheSourceSuccess(source, result.articles);
      else sourceFailureCache.set(source.id, { until: Date.now() + FAILURE_TTL_MS, errorCategory: result.errorCategory ?? "network_error" });
    }));
    return cachedSourceResult(source, fallback, "stale", activeFailure?.errorCategory ?? null);
  }
  const result = await startSourceFetch(source, options);
  if (result.articles) return cacheSourceSuccess(source, result.articles);
  sourceFailureCache.set(source.id, { until: Date.now() + FAILURE_TTL_MS, errorCategory: result.errorCategory ?? "network_error" });
  return fallback ? cachedSourceResult(source, fallback, "stale", result.errorCategory) : { source, data: [], fetchedAt: null, isStale: true, cacheStatus: "unavailable", errorCategory: result.errorCategory ?? "network_error", rawCount: result.rawCount, parsedCount: result.parsedCount, filteredCount: result.filteredCount };
}

function readCategoryCache(category: MacroRssCategory): { fresh: CacheEntry<MacroRssCategoryResult> | null; stale: CacheEntry<MacroRssCategoryResult> | null } {
  const key = `category:${category}`;
  const entry = categoryCache.get(key);
  if (!entry) return { fresh: null, stale: null };
  const now = Date.now();
  if (now <= entry.expiresAt) return { fresh: entry, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: entry };
  categoryCache.delete(key);
  return { fresh: null, stale: null };
}

function cacheCategorySuccess(category: MacroRssCategory, result: MacroRssCategoryResult): MacroRssCategoryResult {
  const now = Date.now();
  const entry: CacheEntry<MacroRssCategoryResult> = { value: { ...result, fetchedAt: new Date(now).toISOString(), isStale: result.isStale, cacheStatus: result.isStale ? "stale" : "fresh" }, expiresAt: now + FRESH_TTL_MS, staleUntil: now + STALE_TTL_MS, fetchedAt: new Date(now).toISOString() };
  categoryCache.set(`category:${category}`, entry);
  categoryFailureCache.delete(`category:${category}`);
  return entry.value;
}

function mergeArticles(sourceResults: MacroRssSourceResult[]): MacroRssArticle[] {
  const byUrl = new Map<string, MacroRssArticle>();
  for (const sourceResult of sourceResults) {
    for (const article of sourceResult.data) {
      const key = normalizedUrl(article.url);
      const existing = byUrl.get(key);
      if (!existing || (dateValue(article.publishedAt) ?? -Infinity) > (dateValue(existing.publishedAt) ?? -Infinity)) byUrl.set(key, article);
    }
  }
  return [...byUrl.values()].sort((left, right) => {
    const leftTime = dateValue(left.publishedAt);
    const rightTime = dateValue(right.publishedAt);
    if (leftTime === null && rightTime === null) return 0;
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime;
  }).slice(0, MAX_ARTICLES_PER_CATEGORY);
}

async function refreshCategory(category: MacroRssCategory, options: MacroRssRefreshOptions): Promise<MacroRssCategoryResult> {
  const sources = MACRO_RSS_SOURCES.filter((source) => source.category === category);
  const settled = await Promise.allSettled(sources.map((source) => getSourceNews(source, options)));
  const sourceResults = settled.map((result, index): MacroRssSourceResult => result.status === "fulfilled"
    ? result.value
    : { source: sources[index], data: [], fetchedAt: null, isStale: true, cacheStatus: "unavailable", errorCategory: "network_error", rawCount: 0, parsedCount: 0, filteredCount: 0 });
  const data = mergeArticles(sourceResults);
  const fetchedAt = sourceResults.map((result) => result.fetchedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const sourceFailures = sourceResults.filter((result) => result.errorCategory !== null);
  const result: MacroRssCategoryResult = {
    category,
    data,
    fetchedAt,
    isStale: sourceResults.some((item) => item.isStale),
    cacheStatus: data.length ? (sourceResults.some((item) => item.isStale) ? "stale" : "fresh") : "unavailable",
    errorCategory: sourceFailures[0]?.errorCategory ?? null,
    sourceResults
  };
  if (data.length) return cacheCategorySuccess(category, result);
  categoryFailureCache.set(`category:${category}`, { until: Date.now() + FAILURE_TTL_MS, errorCategory: result.errorCategory ?? "items_empty" });
  return result;
}

function startCategoryRefresh(category: MacroRssCategory, options: MacroRssRefreshOptions): Promise<MacroRssCategoryResult> {
  const key = `category:${category}`;
  const running = categoryInFlight.get(key);
  if (running) {
    const now = Date.now();
    const age = Math.max(0, now - running.startedAt);
    const remaining = Math.max(0, running.deadlineAt - now);
    const joinable = !options.awaitRefresh || (!running.settled && age < MANUAL_JOIN_MAX_AGE_MS && remaining >= MANUAL_JOIN_MIN_REMAINING_MS);
    if (joinable) {
      if (options.awaitRefresh) diagnostic({ event: "category_refresh_joined_inflight", category, requestId: options.requestId ?? null, refreshId: options.refreshId ?? null, inFlightAgeMs: age, remainingMs: remaining });
      return running.promise;
    }
    diagnostic({ event: "category_refresh_replaced_inflight", category, requestId: options.requestId ?? null, refreshId: options.refreshId ?? null, inFlightAgeMs: age, remainingMs: remaining });
    // Source-level calls below receive awaitRefresh and abort/replace their non-joinable entries.
    categoryInFlight.delete(key);
  }
  const startedAt = Date.now();
  const deadlineAt = sourceDeadlineAt(options);
  const entry: CategoryInFlightEntry = { promise: Promise.resolve(null as never), startedAt, deadlineAt, settled: false };
  const operation = refreshCategory(category, options).finally(() => {
    entry.settled = true;
    if (categoryInFlight.get(key) === entry) categoryInFlight.delete(key);
  });
  entry.promise = operation;
  categoryInFlight.set(key, entry);
  return operation;
}

/**
 * Aggregates category-specific, source-native RSS metadata. It does not translate, generate,
 * or infer news. Successful source/cache entries are never overwritten by empty or failed fetches.
 */
export async function getMacroRssNews(category: MacroRssCategory, options: MacroRssRefreshOptions = {}): Promise<MacroRssCategoryResult> {
  const { fresh, stale } = readCategoryCache(category);
  const fallback = stale ?? (options.forceRefresh && fresh ? fresh : null);
  const failure = categoryFailureCache.get(`category:${category}`);
  const now = Date.now();
  if (failure && failure.until <= now) categoryFailureCache.delete(`category:${category}`);
  const activeFailure = failure && failure.until > now ? failure : null;
  if (fresh && !options.forceRefresh) return fresh.value;
  if (!options.awaitRefresh && fallback) {
    if (!activeFailure) waitUntil(startCategoryRefresh(category, options));
    return { ...fallback.value, isStale: true, cacheStatus: "stale", errorCategory: activeFailure?.errorCategory ?? fallback.value.errorCategory };
  }
  if (!options.awaitRefresh && activeFailure) return fallback ? { ...fallback.value, isStale: true, cacheStatus: "stale", errorCategory: activeFailure.errorCategory } : { category, data: [], fetchedAt: null, isStale: true, cacheStatus: "unavailable", errorCategory: activeFailure.errorCategory, sourceResults: [] };
  const refreshed = await startCategoryRefresh(category, options);
  if (refreshed.data.length || !fallback) return refreshed;
  return { ...fallback.value, isStale: true, cacheStatus: "stale", errorCategory: refreshed.errorCategory };
}
