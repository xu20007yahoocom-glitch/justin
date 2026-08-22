import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getEiaInternationalLatest, type EiaInternationalObservation, type EiaResult } from "../../lib/providers/eia.js";
import { getFredLatestObservation, type FredLatestObservation, type FredResult } from "../../lib/providers/fred.js";
import { getGdeltRecentArticles, type GdeltArticle, type GdeltResult } from "../../lib/providers/gdelt.js";
import type {
  GlobalMacroItem,
  GlobalMacroProvider,
  GlobalMacroReference,
  GlobalMacroSection,
  GlobalMacroSource
} from "../../src/types.js";

const MACRO_CACHE_TTL_MS = 30 * 60 * 1_000;
const DATA_NATURE = "真实数据整理，非实时，定期更新" as const;
const UNAVAILABLE_TEXT = "暂无可靠资料";
const EIA_INTERNATIONAL_URL = "https://www.eia.gov/international/data/world/";
const FRED_LMBA_REMOVAL_URL = "https://fred.stlouisfed.org/series/GOLDAMGBD228NLBM";

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
  const updatedAt = availableItems
    .map((item) => item.dataTime)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    title,
    summary: summary ?? (availableItems.length > 0 ? "真实来源数据；非实时，定期更新" : UNAVAILABLE_TEXT),
    updatedAt,
    items,
    sources
  };
}

function unavailableItem(
  label: string,
  provider: GlobalMacroProvider,
  title: string,
  url: string,
  note: string
): GlobalMacroItem {
  return {
    label,
    value: UNAVAILABLE_TEXT,
    unit: null,
    dataTime: null,
    source: { provider, title, url, dataTime: null },
    note,
    available: false
  };
}

function fredItem(
  label: string,
  observation: FredResult<FredLatestObservation> | null,
  unit: string,
  seriesTitle: string
): GlobalMacroItem {
  const seriesId = observation?.data.seriesId;
  const url = seriesId ? `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}` : "https://fred.stlouisfed.org/docs/api/fred/series_observations.html";
  if (!observation) {
    return unavailableItem(label, "FRED", seriesTitle, url, "FRED 无可验证观测值或 FRED_API_KEY 未配置；非实时，定期更新");
  }
  return {
    label,
    value: observation.data.value,
    unit,
    dataTime: observation.data.observationDate,
    source: {
      provider: "FRED",
      title: `${seriesTitle}（${observation.data.seriesId}）`,
      url,
      dataTime: observation.data.observationDate
    },
    note: `${observation.isStale ? "服务端缓存可能过期；" : ""}非实时，定期更新`,
    available: true
  };
}

function eiaItem(label: string, result: EiaResult<EiaInternationalObservation> | null): GlobalMacroItem {
  if (!result) {
    return unavailableItem(label, "EIA", "EIA International", EIA_INTERNATIONAL_URL, "EIA 无可验证观测值或 EIA_API_KEY 未配置；非实时，定期更新");
  }
  const data = result.data;
  const title = data.countryRegionName && data.productName && data.activityName
    ? `EIA International：${data.countryRegionName} ${data.productName} ${data.activityName}`
    : "EIA International";
  return {
    label,
    value: data.value,
    unit: data.unitName ?? data.unit,
    dataTime: data.period,
    source: {
      provider: "EIA",
      title,
      url: EIA_INTERNATIONAL_URL,
      dataTime: data.period
    },
    note: `${result.isStale ? "服务端缓存可能过期；" : ""}${data.frequency ?? "annual"} 数据；非实时，定期更新`,
    available: true
  };
}

function gdeltItems(label: string, result: GdeltResult<GdeltArticle[]> | null): GlobalMacroItem[] {
  if (!result) {
    return [unavailableItem(label, "GDELT", "GDELT DOC 2.0", "https://api.gdeltproject.org/api/v2/doc/doc", "GDELT 未返回可验证新闻；非实时，定期更新")];
  }
  return result.data.map((article) => ({
    label: article.title,
    value: article.domain ? `新闻来源：${article.domain}` : "新闻来源链接可用",
    unit: null,
    dataTime: article.seenAt,
    source: {
      provider: "GDELT",
      title: article.title,
      url: article.url,
      dataTime: article.seenAt
    },
    note: `${result.isStale ? "服务端缓存可能过期；" : ""}GDELT 新闻索引，非实时，定期更新`,
    available: true
  }));
}

function unavailable(reason: string): GlobalMacroReference {
  const preciousMetals = section("贵金属", [
    unavailableItem("黄金现货价", "FRED", "FRED：LMBA Gold Price 日度数据已移除", FRED_LMBA_REMOVAL_URL, "未使用已移除的 FRED LMBA 金价 series；非实时，定期更新")
  ]);
  const energyPrices = section("能源价格", [
    unavailableItem("WTI 原油", "FRED", "FRED：WTI Cushing Spot Price", "https://fred.stlouisfed.org/series/DCOILWTICO", "非实时，定期更新"),
    unavailableItem("Brent 原油", "FRED", "FRED：Global price of Brent Crude", "https://fred.stlouisfed.org/series/POILBREUSDM", "非实时，定期更新"),
    unavailableItem("Henry Hub 天然气", "FRED", "FRED：Henry Hub Natural Gas Spot Price", "https://fred.stlouisfed.org/series/DHHNGSP", "非实时，定期更新")
  ]);
  const countryEnergy = section("各国储备／使用量", [
    unavailableItem("中国石油及其他液体消费", "EIA", "EIA International", EIA_INTERNATIONAL_URL, "非实时，定期更新"),
    unavailableItem("美国石油及其他液体消费", "EIA", "EIA International", EIA_INTERNATIONAL_URL, "非实时，定期更新"),
    unavailableItem("中国石油储备", "EIA", "EIA International", EIA_INTERNATIONAL_URL, "EIA International 未验证支持此指标；非实时，定期更新")
  ]);
  const centralBankRates = section("央行利率", [
    unavailableItem("美国有效联邦基金利率", "FRED", "FRED：Federal Funds Effective Rate", "https://fred.stlouisfed.org/series/DFF", "非实时，定期更新"),
    unavailableItem("美国联邦基金目标区间上限", "FRED", "FRED：Federal Funds Target Range - Upper Limit", "https://fred.stlouisfed.org/series/DFEDTARU", "非实时，定期更新"),
    unavailableItem("欧元区 ECB 存款便利利率", "FRED", "FRED：ECB Deposit Facility Rate", "https://fred.stlouisfed.org/series/ECBDFR", "非实时，定期更新")
  ]);
  const geopoliticalNews = section("地缘政治／全球新闻", [
    unavailableItem("近期地缘政治与全球新闻", "GDELT", "GDELT DOC 2.0", "https://api.gdeltproject.org/api/v2/doc/doc", "非实时，定期更新")
  ]);

  return {
    available: false,
    dataNature: DATA_NATURE,
    generatedAt: new Date().toISOString(),
    cachedAt: null,
    isStale: false,
    sources: dedupeSources([
      ...preciousMetals.sources,
      ...energyPrices.sources,
      ...countryEnergy.sources,
      ...centralBankRates.sources,
      ...geopoliticalNews.sources
    ]),
    preciousMetals,
    energyPrices,
    countryEnergy,
    centralBankRates,
    geopoliticalNews,
    unavailableReason: reason
  };
}

async function generateMacro(): Promise<GlobalMacroReference> {
  try {
    const [wti, brent, henryHub, fedFunds, fedTargetUpper, ecbDeposit, chinaConsumption, usConsumption, geopolitical, energyNews] = await Promise.all([
      getFredLatestObservation("DCOILWTICO"),
      getFredLatestObservation("POILBREUSDM"),
      getFredLatestObservation("DHHNGSP"),
      getFredLatestObservation("DFF"),
      getFredLatestObservation("DFEDTARU"),
      getFredLatestObservation("ECBDFR"),
      getEiaInternationalLatest({ activityId: "2", productId: "5", countryRegionId: "CHN", unit: "TBPD" }),
      getEiaInternationalLatest({ activityId: "2", productId: "5", countryRegionId: "USA", unit: "TBPD" }),
      getGdeltRecentArticles("geopolitics"),
      getGdeltRecentArticles("energy")
    ]);

    // FRED removed the LMBA Gold Price daily series. This item intentionally remains unavailable rather than substituting an estimate.
    const preciousMetals = section("贵金属", [
      unavailableItem("黄金现货价", "FRED", "FRED：LMBA Gold Price 日度数据已移除", FRED_LMBA_REMOVAL_URL, "FRED 当前未提供本端点可验证的黄金现货 series；非实时，定期更新")
    ], "黄金现货未取得可验证 FRED 观测值，显示暂无可靠资料");

    const energyPrices = section("能源价格", [
      fredItem("WTI 原油", wti, "美元／桶", "WTI Cushing Spot Price"),
      fredItem("Brent 原油", brent, "美元／桶", "Global price of Brent Crude"),
      fredItem("Henry Hub 天然气", henryHub, "美元／百万 Btu", "Henry Hub Natural Gas Spot Price")
    ]);

    const countryEnergy = section("各国储备／使用量", [
      eiaItem("中国石油及其他液体消费", chinaConsumption),
      eiaItem("美国石油及其他液体消费", usConsumption),
      unavailableItem("中国石油储备", "EIA", "EIA International", EIA_INTERNATIONAL_URL, "EIA International 未验证支持中国石油储备指标；非实时，定期更新")
    ], "EIA International 年度数据；储备缺失时显示暂无可靠资料");

    const centralBankRates = section("央行利率", [
      fredItem("美国有效联邦基金利率", fedFunds, "百分比", "Federal Funds Effective Rate"),
      fredItem("美国联邦基金目标区间上限", fedTargetUpper, "百分比", "Federal Funds Target Range - Upper Limit"),
      fredItem("欧元区 ECB 存款便利利率", ecbDeposit, "百分比", "ECB Deposit Facility Rate for Euro Area")
    ]);

    const geopoliticalItems = [
      ...gdeltItems("地缘政治新闻", geopolitical),
      ...gdeltItems("能源相关新闻", energyNews)
    ];
    const geopoliticalNews = section("地缘政治／全球新闻", geopoliticalItems, "GDELT 新闻索引；仅展示来源文章元数据，非实时，定期更新");

    const sources = dedupeSources([
      ...preciousMetals.sources,
      ...energyPrices.sources,
      ...countryEnergy.sources,
      ...centralBankRates.sources,
      ...geopoliticalNews.sources
    ]);
    const anyStale = [wti, brent, henryHub, fedFunds, fedTargetUpper, ecbDeposit, chinaConsumption, usConsumption, geopolitical, energyNews]
      .some((result) => result?.isStale === true);
    const available = [
      ...preciousMetals.items,
      ...energyPrices.items,
      ...countryEnergy.items,
      ...centralBankRates.items,
      ...geopoliticalNews.items
    ].some((item) => item.available);

    const value: GlobalMacroReference = {
      available,
      dataNature: DATA_NATURE,
      generatedAt: new Date().toISOString(),
      cachedAt: new Date().toISOString(),
      isStale: anyStale,
      sources,
      preciousMetals,
      energyPrices,
      countryEnergy,
      centralBankRates,
      geopoliticalNews,
      unavailableReason: available ? null : "所有数据源暂时不可用或未配置相应密钥"
    };
    macroCache = { value, expiresAt: Date.now() + MACRO_CACHE_TTL_MS };
    return value;
  } catch (error) {
    console.error("Global macro real-data assembly failed; returning null-safe fallback", error instanceof Error ? error.message : String(error));
    return unavailable("全球宏观数据暂时不可用，请稍后再试");
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (macroCache && macroCache.expiresAt > Date.now()) {
      const cached = { ...macroCache.value, cachedAt: macroCache.value.generatedAt };
      res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
      res.status(200).json(cached);
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
