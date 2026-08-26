const MINING_RSS_URL = "https://www.mining.com/feed/";
const REQUEST_TIMEOUT_MS = 15_000;
const RSS_CACHE_TTL_MS = 30 * 60 * 1_000;
const FAILURE_TTL_MS = 60_000;
const STALE_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_ARTICLES = 8;

const MINERAL_KEYWORDS = [
  "lithium", "copper", "rare earth", "nickel", "cobalt", "graphite", "manganese", "bauxite",
  "iron ore", "zinc", "tin", "uranium", "gold", "silver", "platinum", "palladium", "rhodium",
  "critical mineral", "critical minerals", "mining"
];

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string;
}

export interface MineralRssArticle {
  title: string;
  url: string;
  publishedAt: string | null;
  description: string | null;
  categories: string[];
}

export interface MineralRssResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
}

interface ParseResult {
  rawItemCount: number;
  parsedCount: number;
  filteredCount: number;
  articles: MineralRssArticle[];
}

const cache = new Map<string, CacheEntry<MineralRssArticle[]>>();
const failureCacheUntil = new Map<string, number>();
let inFlight: Promise<MineralRssResult<MineralRssArticle[]> | null> | null = null;

function diagnostic(payload: Record<string, unknown>): void {
  // Never records a full RSS body, article body, credentials or private headers.
  console.info("MINING_RSS_DIAGNOSTIC", payload);
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

function xmlAllText(block: string, tag: string): string[] {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...block.matchAll(expression)].map((match) => decodeXml(match[1])).filter(Boolean).slice(0, 12);
}

function validHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function matchesMineralKeywords(article: MineralRssArticle): boolean {
  const haystack = `${article.title} ${article.description ?? ""} ${article.categories.join(" ")}`.toLowerCase();
  return MINERAL_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function parseArticles(xml: string): ParseResult {
  const blocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const seen = new Set<string>();
  let parsedCount = 0;
  const parsed: MineralRssArticle[] = [];
  for (const block of blocks) {
    const title = xmlText(block, "title");
    const url = validHttpUrl(xmlText(block, "link"));
    // Publication date, image, description, author and categories are all optional.
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    parsedCount += 1;
    parsed.push({
      title: title.slice(0, 500),
      url,
      publishedAt: xmlText(block, "pubDate")?.slice(0, 128) ?? null,
      description: xmlText(block, "description")?.slice(0, 1_000) ?? null,
      categories: xmlAllText(block, "category")
    });
  }
  const articles = parsed.filter(matchesMineralKeywords).slice(0, MAX_ARTICLES);
  return { rawItemCount: blocks.length, parsedCount, filteredCount: articles.length, articles };
}

function getCached(key: string): { fresh: MineralRssResult<MineralRssArticle[]> | null; stale: MineralRssResult<MineralRssArticle[]> | null } {
  const entry = cache.get(key);
  if (!entry) return { fresh: null, stale: null };
  const now = Date.now();
  if (now <= entry.expiresAt) return { fresh: { data: entry.value, fetchedAt: entry.fetchedAt, isStale: false }, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: { data: entry.value, fetchedAt: entry.fetchedAt, isStale: true } };
  cache.delete(key);
  return { fresh: null, stale: null };
}

function cacheSuccess(key: string, data: MineralRssArticle[]): MineralRssResult<MineralRssArticle[]> {
  const now = Date.now();
  const fetchedAt = new Date().toISOString();
  cache.set(key, { value: data, expiresAt: now + RSS_CACHE_TTL_MS, staleUntil: now + RSS_CACHE_TTL_MS + STALE_TTL_MS, fetchedAt });
  failureCacheUntil.delete(key);
  return { data, fetchedAt, isStale: false };
}

async function requestArticles(): Promise<MineralRssArticle[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(MINING_RSS_URL, {
      method: "GET",
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Referer: "https://www.mining.com/",
        "User-Agent": "Mozilla/5.0 (compatible; JustinMacroReference/1.0; +https://github.com/xu20007yahoocom-glitch/justin)"
      },
      signal: controller.signal
    });
    const xml = await response.text();
    const contentType = response.headers.get("content-type") ?? null;
    if (!response.ok) {
      diagnostic({ endpoint: MINING_RSS_URL, outcome: response.status === 403 ? "http_403" : response.status === 429 ? "http_429" : response.status >= 500 ? "http_5xx" : "http_error", httpStatus: response.status, contentType, responseTextLength: xml.length, rawItemCount: 0, parsedCount: 0, filteredCount: 0, errorCategory: null });
      return null;
    }
    const parsed = parseArticles(xml);
    const outcome = parsed.rawItemCount === 0 ? "items_empty" : parsed.parsedCount === 0 ? "items_parse_filtered_empty" : parsed.filteredCount === 0 ? "items_keyword_filtered_empty" : "success";
    diagnostic({ endpoint: MINING_RSS_URL, outcome, httpStatus: response.status, contentType, responseTextLength: xml.length, rawItemCount: parsed.rawItemCount, parsedCount: parsed.parsedCount, filteredCount: parsed.filteredCount, errorCategory: null });
    return parsed.articles.length ? parsed.articles : null;
  } catch (error) {
    const errorCategory = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    diagnostic({ endpoint: MINING_RSS_URL, outcome: errorCategory, httpStatus: null, contentType: null, responseTextLength: 0, rawItemCount: 0, parsedCount: 0, filteredCount: 0, errorCategory });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Returns only linked Mining.com article metadata selected by local mineral keywords.
 * It never invents mining news or overwrites a recent successful cache with an empty refresh.
 */
export async function getMiningComMineralNews(): Promise<MineralRssResult<MineralRssArticle[]> | null> {
  const key = "mining-com:mineral-rss:v2";
  const { fresh, stale } = getCached(key);
  if (fresh) {
    diagnostic({ endpoint: MINING_RSS_URL, outcome: "success", cache: "fresh", httpStatus: null, contentType: null, responseTextLength: 0, rawItemCount: fresh.data.length, parsedCount: fresh.data.length, filteredCount: fresh.data.length, errorCategory: null });
    return fresh;
  }
  if ((failureCacheUntil.get(key) ?? 0) > Date.now()) {
    diagnostic({ endpoint: MINING_RSS_URL, outcome: "failure_short_cache", cache: "failure_short", httpStatus: null, contentType: null, responseTextLength: 0, rawItemCount: 0, parsedCount: 0, filteredCount: 0, errorCategory: "short_failure_cache" });
    return stale;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const articles = await requestArticles();
      if (!articles) {
        failureCacheUntil.set(key, Date.now() + FAILURE_TTL_MS);
        return stale;
      }
      return cacheSuccess(key, articles);
    } catch (error) {
      failureCacheUntil.set(key, Date.now() + FAILURE_TTL_MS);
      diagnostic({ endpoint: MINING_RSS_URL, outcome: "network_error", httpStatus: null, contentType: null, responseTextLength: 0, rawItemCount: 0, parsedCount: 0, filteredCount: 0, errorCategory: error instanceof Error ? error.name : "unknown" });
      return stale;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export { MINING_RSS_URL };
