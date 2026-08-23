const MINING_RSS_URL = "https://www.mining.com/feed/";
const REQUEST_TIMEOUT_MS = 15_000;
const RSS_CACHE_TTL_MS = 30 * 60 * 1_000;
const FAILURE_TTL_MS = 5 * 60 * 1_000;
const STALE_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_ARTICLES = 8;

const MINERAL_KEYWORDS = [
  "lithium", "copper", "rare earth", "nickel", "cobalt", "graphite", "manganese", "bauxite",
  "iron ore", "zinc", "tin", "uranium", "gold", "silver", "platinum", "palladium", "rhodium",
  "critical mineral", "critical minerals", "mining"
];

interface CacheEntry<T> {
  value: T | null;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string | null;
}

export interface MineralRssArticle {
  title: string;
  url: string;
  publishedAt: string;
  description: string | null;
  categories: string[];
}

export interface MineralRssResult<T> {
  data: T;
  fetchedAt: string;
  isStale: boolean;
}

const cache = new Map<string, CacheEntry<unknown>>();
let inFlight: Promise<MineralRssResult<MineralRssArticle[]> | null> | null = null;

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
  return [...block.matchAll(expression)]
    .map((match) => decodeXml(match[1]))
    .filter(Boolean)
    .slice(0, 12);
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

function parseArticles(xml: string): MineralRssArticle[] {
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const seen = new Set<string>();
  return itemBlocks.flatMap((block) => {
    const title = xmlText(block, "title");
    const url = validHttpUrl(xmlText(block, "link"));
    const publishedAt = xmlText(block, "pubDate");
    if (!title || !url || !publishedAt || seen.has(url)) return [];
    seen.add(url);
    const article: MineralRssArticle = {
      title: title.slice(0, 500),
      url,
      publishedAt: publishedAt.slice(0, 128),
      description: xmlText(block, "description")?.slice(0, 1_000) ?? null,
      categories: xmlAllText(block, "category")
    };
    return matchesMineralKeywords(article) ? [article] : [];
  }).slice(0, MAX_ARTICLES);
}

function getCached<T>(key: string): { fresh: MineralRssResult<T> | null; stale: MineralRssResult<T> | null } {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.value === null || !entry.fetchedAt) return { fresh: null, stale: null };
  const now = Date.now();
  const value = { data: entry.value, fetchedAt: entry.fetchedAt, isStale: now > entry.expiresAt };
  if (now <= entry.expiresAt) return { fresh: value, stale: null };
  if (now <= entry.staleUntil) return { fresh: null, stale: value };
  cache.delete(key);
  return { fresh: null, stale: null };
}

function setCached<T>(key: string, value: T | null, ttlMs: number, fetchedAt: string | null): void {
  const now = Date.now();
  cache.set(key, { value, expiresAt: now + ttlMs, staleUntil: now + ttlMs + STALE_TTL_MS, fetchedAt });
}

async function requestArticles(): Promise<MineralRssArticle[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(MINING_RSS_URL, {
      method: "GET",
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "JustinMacroReference/1.0 (+https://github.com/xu20007yahoocom-glitch/justin)"
      },
      signal: controller.signal
    });
    const xml = await response.text();
    if (!response.ok || !/<rss\b/i.test(xml)) {
      console.warn("Mining.com RSS unavailable", {
        endpoint: MINING_RSS_URL,
        httpStatus: response.status,
        contentType: response.headers.get("content-type"),
        responsePreview: xml.slice(0, 300)
      });
      return null;
    }
    const articles = parseArticles(xml);
    if (articles.length === 0) {
      console.info("Mining.com RSS returned no verifiable mineral articles", { endpoint: MINING_RSS_URL });
      return null;
    }
    return articles;
  } catch (error) {
    console.warn("Mining.com RSS request failed", {
      endpoint: MINING_RSS_URL,
      reason: error instanceof Error ? error.message : String(error)
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Returns only linked Mining.com article metadata selected by local mineral keywords.
 * It does not infer production, reserve, price, or policy data from article titles.
 */
export async function getMiningComMineralNews(): Promise<MineralRssResult<MineralRssArticle[]> | null> {
  const key = "mining-com:mineral-rss:v1";
  const { fresh, stale } = getCached<MineralRssArticle[]>(key);
  if (fresh) return fresh;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const articles = await requestArticles();
      if (!articles) {
        setCached(key, null, FAILURE_TTL_MS, null);
        return stale;
      }
      const fetchedAt = new Date().toISOString();
      setCached(key, articles, RSS_CACHE_TTL_MS, fetchedAt);
      return { data: articles, fetchedAt, isStale: false };
    } catch (error) {
      console.warn("Mining.com RSS fallback", { reason: error instanceof Error ? error.message : String(error) });
      setCached(key, null, FAILURE_TTL_MS, null);
      return stale;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export { MINING_RSS_URL };
