import type { VercelRequest, VercelResponse } from "@vercel/node";
import { EIA_MAJOR_ENERGY_COUNTRIES, getEiaCountryEnergy, type EiaCountryEnergy, type EiaEnergyMetric, type EiaResult, type EiaInternationalObservation } from "../../lib/providers/eia.js";
import { FRED_MAJOR_RATE_DEFINITIONS, getFredCountryRate, getFredLatestObservation, type FredCountryRate, type FredLatestObservation, type FredRateMetric, type FredResult } from "../../lib/providers/fred.js";
import { getGdeltRecentArticles, type GdeltArticle, type GdeltResult } from "../../lib/providers/gdelt.js";
import { getMiningComMineralNews, MINING_RSS_URL, type MineralRssArticle, type MineralRssResult } from "../../lib/providers/mineral-rss.js";
import { USGS_CRITICAL_MINERALS_2026, USGS_DATA_YEAR } from "../../lib/data/mineral-reserves.js";
import type {
  CriticalMineralsSection,
  GlobalMacroCountryGroup,
  GlobalMacroItem,
  GlobalMacroProvider,
  GlobalMacroReference,
  GlobalMacroSection,
  GlobalMacroSource
} from "../../src/types.js";

const MACRO_CACHE_TTL_MS = 30 * 60 * 1_000;
const MACRO_NEWS_RETRY_TTL_MS = 60 * 1_000;
const DATA_NATURE = "真实数据整理，非实时，定期更新" as const;
const UNAVAILABLE_TEXT = "暂无可靠资料";
const EIA_INTERNATIONAL_URL = "https://www.eia.gov/international/data/world/";
const FRED_API_URL = "https://fred.stlouisfed.org/docs/api/fred/series_observations.html";
const FRED_LMBA_REMOVAL_URL = "https://fred.stlouisfed.org/series/GOLDAMGBD228NLBM";

const EIA_METRIC_LABELS: ReadonlyArray<{ id: EiaEnergyMetric["id"]; label: string }> = [
  { id: "oilConsumption", label: "石油消费" },
  { id: "oilProduction", label: "石油产量" },
  { id: "naturalGasConsumption", label: "天然气消费" },
  { id: "naturalGasProduction", label: "天然气产量" },
  { id: "electricityConsumption", label: "电力消费" }
];

interface CachedMacro {
  value: GlobalMacroReference;
  expiresAt: number;
}

let macroCache: CachedMacro | null = null;

function dedupeSources(sources: Array<GlobalMacroSource | null>): GlobalMacroSource[] {
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    if (!source) return [];
    const key = `${source.provider}:${source.url}:${source.dataTime ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [source];
  });
}

function section(title: string, items: GlobalMacroItem[], summary?: string): GlobalMacroSection {
  const sources = dedupeSources(items.map((item) => item.source));
  const availableItems = items.filter((item) => item.available);
  const updatedAt = availableItems.map((item) => item.dataTime).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return { title, summary: summary ?? (availableItems.length > 0 ? "真实来源数据；非实时，定期更新" : UNAVAILABLE_TEXT), updatedAt, items, sources };
}

function countrySection(title: string, countries: GlobalMacroCountryGroup[], summary: string): GlobalMacroSection {
  const allItems = countries.flatMap((country) => country.items);
  const sources = dedupeSources(allItems.map((item) => item.source));
  const updatedAt = countries.map((country) => country.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return { title, summary, updatedAt, items: allItems, countries, sources };
}

function unavailableItem(label: string, provider: GlobalMacroProvider, title: string, url: string, note: string): GlobalMacroItem {
  return {
    label, value: UNAVAILABLE_TEXT, unit: null, dataTime: null,
    source: { provider, title, url, dataTime: null }, note, available: false
  };
}

function fredItem(label: string, observation: FredResult<FredLatestObservation> | null, unit: string, seriesTitle: string): GlobalMacroItem {
  const seriesId = observation?.data.seriesId;
  const url = seriesId ? `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}` : FRED_API_URL;
  if (!observation) return unavailableItem(label, "FRED", seriesTitle, url, "FRED 无可验证观测值或 FRED_API_KEY 未配置；非实时，定期更新");
  return {
    label, value: observation.data.value, unit, dataTime: observation.data.observationDate,
    source: { provider: "FRED", title: `${seriesTitle}（${observation.data.seriesId}）`, url, dataTime: observation.data.observationDate },
    note: `${observation.isStale ? "服务端缓存可能过期；" : ""}非实时，定期更新`, available: true
  };
}

function eiaItem(label: string, result: EiaResult<EiaInternationalObservation> | null): GlobalMacroItem {
  if (!result) return unavailableItem(label, "EIA", "EIA International", EIA_INTERNATIONAL_URL, "EIA 无可验证观测值或 EIA_API_KEY 未配置；非实时，定期更新");
  const data = result.data;
  const title = data.countryRegionName && data.productName && data.activityName ? `EIA International：${data.countryRegionName} ${data.productName} ${data.activityName}` : "EIA International";
  return {
    label, value: data.value, unit: data.unitName ?? data.unit, dataTime: data.period,
    source: { provider: "EIA", title, url: EIA_INTERNATIONAL_URL, dataTime: data.period },
    note: `${result.isStale ? "服务端缓存可能过期；" : ""}${data.frequency ?? "annual"} 数据；非实时，定期更新`, available: true
  };
}

function fredRateItem(metric: FredRateMetric | null, fallbackLabel: string): GlobalMacroItem {
  if (!metric || !metric.unit) {
    return unavailableItem(fallbackLabel, "FRED", "FRED 动态 series 发现", FRED_API_URL, "FRED 未发现标题、百分比单位与观测值均可验证的 series；非实时，定期更新");
  }
  const url = `https://fred.stlouisfed.org/series/${encodeURIComponent(metric.seriesId)}`;
  return {
    label: metric.label, value: metric.value, unit: metric.unit, dataTime: metric.observationDate,
    source: { provider: "FRED", title: `${metric.seriesTitle}（${metric.seriesId}）`, url, dataTime: metric.observationDate },
    note: `${metric.frequency ?? "频率待确认"}；FRED 动态发现并核验；非实时，定期更新`, available: true
  };
}

function eiaDynamicItem(metric: EiaEnergyMetric | null, label: string): GlobalMacroItem {
  if (!metric) {
    return unavailableItem(label, "EIA", "EIA International 动态 facet 发现", EIA_INTERNATIONAL_URL, "EIA 未发现可验证 facet 或国家年度观测值；非实时，定期更新");
  }
  const data = metric.observation;
  const title = data.countryRegionName && data.productName && data.activityName ? `EIA International：${data.countryRegionName} ${data.productName} ${data.activityName}` : "EIA International";
  return {
    label: metric.label, value: data.value, unit: data.unitName ?? data.unit, dataTime: data.period,
    source: { provider: "EIA", title, url: EIA_INTERNATIONAL_URL, dataTime: data.period },
    note: `${data.frequency ?? "annual"}；EIA 动态 facet 发现（activity=${metric.activityId}, product=${metric.productId}）；非实时，定期更新`, available: true
  };
}

function fredCountryGroup(country: string, result: FredResult<FredCountryRate> | null): GlobalMacroCountryGroup {
  const rate = result?.data;
  const items = [
    fredRateItem(rate?.policyRate ?? null, "政策基准利率"),
    fredRateItem(rate?.tenYearYield ?? null, "10 年期公债收益率")
  ];
  const updatedAt = items.filter((item) => item.available).map((item) => item.dataTime).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return { country, updatedAt, items, available: items.some((item) => item.available) };
}

function eiaCountryGroup(country: string, result: EiaResult<EiaCountryEnergy> | null): GlobalMacroCountryGroup {
  const metrics = new Map((result?.data.metrics ?? []).map((metric) => [metric.id, metric]));
  const items = EIA_METRIC_LABELS.map((definition) => eiaDynamicItem(metrics.get(definition.id) ?? null, definition.label));
  const updatedAt = items.filter((item) => item.available).map((item) => item.dataTime).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return { country, updatedAt, items, available: items.some((item) => item.available) };
}

function gdeltItems(label: string, result: GdeltResult<GdeltArticle[]> | null): GlobalMacroItem[] {
  if (!result) return [unavailableItem(label, "GDELT", "GDELT DOC 2.0", "https://api.gdeltproject.org/api/v2/doc/doc", "GDELT 未返回可验证新闻；非实时，定期更新")];
  const transport = result.sourceFormat === "rss" ? "GDELT RSS fallback" : "GDELT JSON";
  return result.data.map((article) => ({
    label: article.title, value: article.domain ? `新闻来源：${article.domain}` : "新闻来源链接可用", unit: null, dataTime: article.seenAt,
    source: { provider: "GDELT", title: article.title, url: article.url, dataTime: article.seenAt },
    note: `类别：${label}；${result.isStale ? "服务端缓存可能过期；" : ""}${transport} 新闻索引，非实时，定期更新`, available: true
  }));
}

function mineralNewsItems(result: MineralRssResult<MineralRssArticle[]> | null): GlobalMacroItem[] {
  if (!result) return [unavailableItem("近期矿产新闻", "Mining.com", "Mining.com RSS", MINING_RSS_URL, "Mining.com RSS 未返回可验证矿产新闻；非实时，定期更新")];
  return result.data.map((article) => ({
    label: article.title, value: "新闻来源：Mining.com", unit: null, dataTime: article.publishedAt,
    source: { provider: "Mining.com", title: article.title, url: article.url, dataTime: article.publishedAt },
    note: `${result.isStale ? "服务端缓存可能过期；" : ""}Mining.com RSS 本地矿产关键词筛选；非实时，定期更新`, available: true
  }));
}

function criticalMineralsSection(newsResult: MineralRssResult<MineralRssArticle[]> | null): CriticalMineralsSection {
  const news = mineralNewsItems(newsResult);
  const mineralSources = USGS_CRITICAL_MINERALS_2026.map((mineral) => mineral.source);
  return {
    title: "关键矿产", summary: "USGS 年度储量／矿山产量与 Mining.com RSS 新闻；产量与储量单位分别显示，非实时，定期更新",
    updatedAt: newsResult?.fetchedAt ?? USGS_DATA_YEAR, minerals: USGS_CRITICAL_MINERALS_2026, news,
    sources: dedupeSources([...mineralSources, ...news.map((item) => item.source)])
  };
}

function unavailableRateGroups(): GlobalMacroCountryGroup[] {
  return FRED_MAJOR_RATE_DEFINITIONS.map((definition) => fredCountryGroup(definition.country, null));
}

function unavailableEnergyGroups(): GlobalMacroCountryGroup[] {
  return EIA_MAJOR_ENERGY_COUNTRIES.map((definition) => eiaCountryGroup(definition.country, null));
}

function unavailable(reason: string): GlobalMacroReference {
  const criticalMinerals = criticalMineralsSection(null);
  const preciousMetals = section("贵金属", [unavailableItem("黄金现货价", "FRED", "FRED：LMBA Gold Price 日度数据已移除", FRED_LMBA_REMOVAL_URL, "未使用已移除的 FRED LMBA 金价 series；非实时，定期更新")]);
  const energyPrices = section("能源价格", [
    unavailableItem("WTI 原油", "FRED", "FRED：WTI Cushing Spot Price", "https://fred.stlouisfed.org/series/DCOILWTICO", "非实时，定期更新"),
    unavailableItem("Brent 原油", "FRED", "FRED：Global price of Brent Crude", "https://fred.stlouisfed.org/series/POILBREUSDM", "非实时，定期更新"),
    unavailableItem("Henry Hub 天然气", "FRED", "FRED：Henry Hub Natural Gas Spot Price", "https://fred.stlouisfed.org/series/DHHNGSP", "非实时，定期更新")
  ]);
  const countryEnergy = countrySection("各国能源使用量", unavailableEnergyGroups(), "EIA International 动态 metadata／facet 发现；年度数据，非实时，定期更新");
  const centralBankRates = countrySection("央行利率", unavailableRateGroups(), "FRED 动态 series 搜索与 observations 核验；非实时，定期更新");
  const geopoliticalNews = section("地缘政治／全球新闻", [unavailableItem("近期地缘政治与全球新闻", "GDELT", "GDELT DOC 2.0", "https://api.gdeltproject.org/api/v2/doc/doc", "非实时，定期更新")]);
  return {
    available: criticalMinerals.minerals.some((mineral) => mineral.available), dataNature: DATA_NATURE, generatedAt: new Date().toISOString(), cachedAt: null, isStale: false,
    sources: dedupeSources([...criticalMinerals.sources, ...preciousMetals.sources, ...energyPrices.sources, ...countryEnergy.sources, ...centralBankRates.sources, ...geopoliticalNews.sources]),
    criticalMinerals, preciousMetals, energyPrices, countryEnergy, centralBankRates, geopoliticalNews, unavailableReason: reason
  };
}

async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

async function generateMacro(): Promise<GlobalMacroReference> {
  try {
    const newsPromise = Promise.allSettled([
      getGdeltRecentArticles("geopolitical"),
      getGdeltRecentArticles("economic"),
      getMiningComMineralNews()
    ]);
    const [wti, brent, henryHub, rateResults, energyResults] = await Promise.all([
      getFredLatestObservation("DCOILWTICO"),
      getFredLatestObservation("POILBREUSDM"),
      getFredLatestObservation("DHHNGSP"),
      mapWithConcurrency(FRED_MAJOR_RATE_DEFINITIONS, 2, (definition) => getFredCountryRate(definition)),
      mapWithConcurrency(EIA_MAJOR_ENERGY_COUNTRIES, 1, (definition) => getEiaCountryEnergy(definition))
    ]);
    const [geopoliticalSettled, economicSettled, mineralSettled] = await newsPromise;
    const geopolitical = geopoliticalSettled.status === "fulfilled" ? geopoliticalSettled.value : null;
    const economicNews = economicSettled.status === "fulfilled" ? economicSettled.value : null;
    const mineralNews = mineralSettled.status === "fulfilled" ? mineralSettled.value : null;
    const criticalMinerals = criticalMineralsSection(mineralNews);
    const preciousMetals = section("贵金属", [unavailableItem("黄金现货价", "FRED", "FRED：LMBA Gold Price 日度数据已移除", FRED_LMBA_REMOVAL_URL, "FRED 当前未提供本端点可验证的黄金现货 series；非实时，定期更新")], "黄金现货未取得可验证 FRED 观测值，显示暂无可靠资料");
    const energyPrices = section("能源价格", [
      fredItem("WTI 原油", wti, "美元／桶", "WTI Cushing Spot Price"),
      fredItem("Brent 原油", brent, "美元／桶", "Global price of Brent Crude"),
      fredItem("Henry Hub 天然气", henryHub, "美元／百万 Btu", "Henry Hub Natural Gas Spot Price")
    ]);
    const countryEnergy = countrySection(
      "各国能源使用量",
      EIA_MAJOR_ENERGY_COUNTRIES.map((definition, index) => eiaCountryGroup(definition.country, energyResults[index])),
      "EIA International 动态 metadata／facet 发现；仅显示返回的年度指标，单位以 EIA 原文为准；非实时，定期更新"
    );
    const centralBankRates = countrySection(
      "央行利率",
      FRED_MAJOR_RATE_DEFINITIONS.map((definition, index) => fredCountryGroup(definition.country, rateResults[index])),
      "FRED 动态 series 搜索后再以 observations 核验；每项保留 FRED 原始单位与观测时间；非实时，定期更新"
    );
    const geopoliticalNews = section("地缘政治／全球新闻", [...gdeltItems("地缘政治新闻", geopolitical), ...gdeltItems("经济相关新闻", economicNews)], "GDELT 新闻索引；仅展示来源文章元数据，非实时，定期更新");
    const sources = dedupeSources([...criticalMinerals.sources, ...preciousMetals.sources, ...energyPrices.sources, ...countryEnergy.sources, ...centralBankRates.sources, ...geopoliticalNews.sources]);
    const allCountryItems = [...(countryEnergy.countries ?? []).flatMap((country) => country.items), ...(centralBankRates.countries ?? []).flatMap((country) => country.items)];
    const allResults = [wti, brent, henryHub, geopolitical, economicNews, mineralNews, ...rateResults, ...energyResults];
    const available = criticalMinerals.minerals.some((mineral) => mineral.available) || [...criticalMinerals.news, ...preciousMetals.items, ...energyPrices.items, ...allCountryItems, ...geopoliticalNews.items].some((item) => item.available);
    const value: GlobalMacroReference = {
      available, dataNature: DATA_NATURE, generatedAt: new Date().toISOString(), cachedAt: new Date().toISOString(),
      isStale: allResults.some((result) => result?.isStale === true), sources, criticalMinerals, preciousMetals,
      energyPrices, countryEnergy, centralBankRates, geopoliticalNews,
      unavailableReason: available ? null : "所有数据源暂时不可用或未配置相应密钥"
    };
    // A missing news category gets a short macro cache so it can recover without holding empty cards for 30 minutes.
    const cacheTtl = geopolitical && economicNews && mineralNews ? MACRO_CACHE_TTL_MS : MACRO_NEWS_RETRY_TTL_MS;
    macroCache = { value, expiresAt: Date.now() + cacheTtl };
    return value;
  } catch (error) {
    console.error("Global macro real-data assembly failed; returning null-safe fallback", error instanceof Error ? error.message : String(error));
    return unavailable("全球宏观数据暂时不可用，请稍后再试");
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  try {
    if (macroCache && macroCache.expiresAt > Date.now()) {
      res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
      res.status(200).json({ ...macroCache.value, cachedAt: macroCache.value.generatedAt });
      return;
    }
    const value = await generateMacro();
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(value);
  } catch (error) {
    console.error("Global macro handler failed; returning null-safe fallback", error instanceof Error ? error.message : String(error));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(unavailable("全球宏观数据暂时不可用，请稍后再试"));
  }
}
