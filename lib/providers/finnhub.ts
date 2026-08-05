// lib/providers/finnhub.ts
// Lightweight Finnhub provider helpers with in-memory cache + in-flight dedupe.
// Uses global fetch (available in Vercel/Node 18+). All imports from src use .js

import type { FundamentalsData, AnalystRatingsData, AnalysisNewsItem, CompanyProfile } from "../src/types.js";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const BASE = "https://finnhub.io/api/v1";

type CacheEntry = { value: any; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<any>>();

function nowMs() {
  return Date.now();
}
function getCache<T>(key: string) {
  const e = cache.get(key);
  if (e && e.expiresAt > nowMs()) return e.value as T;
  cache.delete(key);
  return null;
}
function setCache(key: string, value: any, ttlSeconds: number) {
  try {
    cache.set(key, { value, expiresAt: nowMs() + ttlSeconds * 1000 });
  } catch (e) {
    // ignore cache set errors in constrained envs
  }
}

async function fetchJson(url: string) {
  if (!FINNHUB_KEY) throw new Error("NO_KEY");
  const sep = url.includes("?") ? "&" : "?";
  const full = `${url}${sep}token=${encodeURIComponent(FINNHUB_KEY)}`;
  const res = await fetch(full, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function safeNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeSymbolForFinnhub(symbol: string): string {
  if (!symbol) return symbol;
  // Remove common suffixes like ".US" or exchange suffixes (keep only ticker before dot or slash)
  const s = symbol.toUpperCase().trim();
  const parts = s.split(/[\.\/:_-]/);
  return parts[0];
}

export async function getFinnhubMetrics(symbolIn: string): Promise<FundamentalsData | null> {
  const symbol = normalizeSymbolForFinnhub(symbolIn);
  const key = `metric:${symbol}`;
  const cached = getCache<FundamentalsData>(key);
  if (cached) return cached;
  if (inFlight.has(key)) return inFlight.get(key)!;

  const p = (async () => {
    try {
      const url = `${BASE}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`;
      const data = await fetchJson(url);
      const m = data?.metric ?? data ?? {};
      const out: FundamentalsData = {
        peRatio: safeNumber(m?.peBasicExclExtraTTM ?? m?.peTTM ?? m?.pe),
        pbRatio: safeNumber(m?.priceToBook ?? m?.pbRatio),
        eps: safeNumber(m?.earningsPerShareBasicTTM ?? m?.epsTTM ?? m?.eps),
        roe: safeNumber(m?.roeTTM ?? m?.returnOnEquityTTM),
        grossMarginPercent: safeNumber(m?.grossProfitMarginTTM ?? m?.grossMarginPercent),
        revenueGrowthPercent: safeNumber(m?.revenueGrowthPercent ?? null),
        marketCap: safeNumber(data?.marketCapitalization ?? null),
        fiftyTwoWeekHigh: safeNumber(m?.["52WeekHigh"] ?? null),
        fiftyTwoWeekLow: safeNumber(m?.["52WeekLow"] ?? null)
      };
      setCache(key, out, 3600); // 1 hour
      return out;
    } catch (err) {
      // short error TTL to avoid immediate retry storms
      setCache(key, null, 60);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, p);
  return p;
}

export async function getFinnhubProfile(symbolIn: string): Promise<CompanyProfile | null> {
  const symbol = normalizeSymbolForFinnhub(symbolIn);
  const key = `profile:${symbol}`;
  const cached = getCache<CompanyProfile>(key);
  if (cached) return cached;
  if (inFlight.has(key)) return inFlight.get(key)!;

  const p = (async () => {
    try {
      const url = `${BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}`;
      const data = await fetchJson(url);
      const out: CompanyProfile = {
        name: data?.name ?? null,
        industry: data?.finnhubIndustry ?? data?.industry ?? null,
        exchange: data?.exchange ?? null,
        ipoDate: data?.ipo ?? null,
        marketCap: safeNumber(data?.marketCapitalization ?? null),
        website: data?.weburl ?? null
      };
      setCache(key, out, 86400); // 24h
      return out;
    } catch (err) {
      setCache(key, null, 60);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, p);
  return p;
}

export async function getFinnhubRecommendations(symbolIn: string): Promise<AnalystRatingsData | null> {
  const symbol = normalizeSymbolForFinnhub(symbolIn);
  const key = `rec:${symbol}`;
  const cached = getCache<AnalystRatingsData>(key);
  if (cached) return cached;
  if (inFlight.has(key)) return inFlight.get(key)!;

  const p = (async () => {
    try {
      const url = `${BASE}/stock/recommendation?symbol=${encodeURIComponent(symbol)}`;
      const data = await fetchJson(url);
      if (!Array.isArray(data) || data.length === 0) {
        setCache(key, null, 3600);
        return null;
      }
      const latest = data[0];
      const out: AnalystRatingsData = {
        averageRating: null,
        priceTarget: null,
        numAnalysts: null,
        distribution: {
          buy: latest?.buy ?? null,
          hold: latest?.hold ?? null,
          sell: latest?.sell ?? null
        },
        raw: data as any
      } as any;
      // store as raw structure as well
      setCache(key, out, 3600);
      return out;
    } catch (err) {
      setCache(key, null, 60);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, p);
  return p;
}

export async function getFinnhubCompanyNews(symbolIn: string, from: string, to: string): Promise<AnalysisNewsItem[] | null> {
  const symbol = normalizeSymbolForFinnhub(symbolIn);
  const key = `news:${symbol}:${from}:${to}`;
  const cached = getCache<AnalysisNewsItem[]>(key);
  if (cached) return cached;
  if (inFlight.has(key)) return inFlight.get(key)!;

  const p = (async () => {
    try {
      const url = `${BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const data = await fetchJson(url);
      if (!Array.isArray(data)) {
        setCache(key, null, 900);
        return null;
      }
      const out: AnalysisNewsItem[] = data.slice(0, 10).map((n: any) => ({
        title: n.headline ?? n.summary ?? n.title ?? "News",
        source: n.source ?? "news",
        sentiment: "neutral",
        url: n.url ?? undefined
      }));
      setCache(key, out, 900); // 15m
      return out;
    } catch (err) {
      setCache(key, null, 60);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, p);
  return p;
}
