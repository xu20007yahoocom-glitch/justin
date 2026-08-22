import type {
  AnalysisContext,
  AnalysisSource,
  CompanyBackground,
  FinancialMetricSet,
  MarketScope,
  RevenueBusiness,
  SourcedField,
  StockQuote,
  UnavailableReason
} from "../src/types.js";
import {
  detectMarketScope,
  getFinnhubFinancials,
  getFinnhubFinancialsReported,
  getFinnhubMetric,
  getFinnhubProfile2,
  getFinnhubRevenueBreakdown,
  isFinnhubSupportedMarket,
  normalizeFinnhubSymbol,
  type FinnhubFinancialsReportedResponse,
  type FinnhubFinancialsResponse,
  type FinnhubMetricResponse,
  type FinnhubProfile2,
  type FinnhubRevenueBreakdownResponse,
  type FinnhubResult
} from "./providers/finnhub.js";

// Type alias kept local so AnalysisContext continues to expose a nullable string.
type ApiSource = Exclude<AnalysisSource, "Gemini 推理" | "模擬分析 fallback" | "Unavailable">;

const AI_CONFIDENCE = "AI 綜合判斷，非即時財報數據" as const;
const API_CONFIDENCE = "API 實測" as const;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function apiField<T>(
  value: T | null,
  source: ApiSource,
  endpoint: string | null,
  sourceField: string | null,
  fetchedAt: string | null,
  periodEnd: string | null,
  isStale: boolean,
  unavailableReason: UnavailableReason = "Finnhub 回傳無此欄位"
): SourcedField<T> {
  return {
    value,
    dataConfidence: API_CONFIDENCE,
    source: value === null ? "Unavailable" : source,
    endpoint: value === null ? null : endpoint,
    sourceField: value === null ? null : sourceField,
    fetchedAt: value === null ? null : fetchedAt,
    periodEnd: value === null ? null : periodEnd,
    isStale: value === null ? false : isStale,
    unavailableReason: value === null ? unavailableReason : null
  };
}

function aiPlaceholder<T>(reason: UnavailableReason): SourcedField<T> {
  return {
    value: null,
    dataConfidence: AI_CONFIDENCE,
    source: "Gemini 推理",
    endpoint: null,
    sourceField: null,
    fetchedAt: null,
    periodEnd: null,
    isStale: false,
    unavailableReason: reason
  };
}

function yahooCompanyName(quote: StockQuote): SourcedField<string> {
  const name = typeof quote.companyName === "string" && quote.companyName.trim() ? quote.companyName : null;
  return apiField(name, "Yahoo Finance", null, "StockQuote.companyName", quote.lastUpdated || null, null, false, "尚無可用資料");
}

function unavailableReasonForMarket(symbol: string): UnavailableReason {
  return isFinnhubSupportedMarket(symbol)
    ? process.env.FINNHUB_API_KEY
      ? "Finnhub 請求失敗"
      : "FINNHUB_API_KEY 未設定"
    : "非美股，Finnhub Free 基本面未覆蓋";
}

function pickMetric(metric: Record<string, unknown>, keys: string[]): { value: number | null; key: string | null } {
  for (const key of keys) {
    const value = finiteNumber(metric[key]);
    if (value !== null) return { value, key };
  }
  return { value: null, key: null };
}

function metricField(
  metricResult: FinnhubResult<FinnhubMetricResponse> | null,
  keys: string[],
  reason: UnavailableReason
): SourcedField<number> {
  const metric = metricResult?.data.metric;
  const picked = metric ? pickMetric(metric, keys) : { value: null, key: null };
  return apiField(
    picked.value,
    "Finnhub Metric",
    "/stock/metric?symbol=&metric=all",
    picked.key ? `metric.${picked.key}` : null,
    metricResult?.fetchedAt ?? null,
    null,
    metricResult?.isStale ?? false,
    reason
  );
}

function latestReportedFiling(data: FinnhubFinancialsReportedResponse | null) {
  const filings = Array.isArray(data?.data) ? data.data : [];
  return filings
    .filter((filing) => Boolean(filing?.report?.ic) && (filing.form === "10-K" || filing.form === "10-Q"))
    .sort((a, b) => String(b.endDate ?? "").localeCompare(String(a.endDate ?? "")))[0] ?? null;
}

function normalizedFinancialKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

/** Supports both Finnhub direct metric maps and Financials As Reported XBRL concept arrays. */
function pickFinancialConcept(value: unknown, keys: string[], path = ""): { value: number | null; key: string | null } {
  const normalizedKeys = new Set(keys.map(normalizedFinancialKey));
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const concept = [record.concept, record.name, record.label, record.field]
        .find((candidate): candidate is string => typeof candidate === "string");
      const amount = finiteNumber(record.value ?? record.amount ?? record.val);
      if (concept && normalizedKeys.has(normalizedFinancialKey(concept)) && amount !== null) {
        return { value: amount, key: `${path}[].${concept}` };
      }
      const nested = pickFinancialConcept(record, keys, path ? `${path}[]` : "[]");
      if (nested.value !== null) return nested;
    }
    return { value: null, key: null };
  }
  if (!value || typeof value !== "object") return { value: null, key: null };

  const record = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(record)) {
    if (normalizedKeys.has(normalizedFinancialKey(key))) {
      const amount = finiteNumber(candidate);
      if (amount !== null) return { value: amount, key: path ? `${path}.${key}` : key };
    }
  }
  for (const [key, candidate] of Object.entries(record)) {
    if (candidate && typeof candidate === "object") {
      const nested = pickFinancialConcept(candidate, keys, path ? `${path}.${key}` : key);
      if (nested.value !== null) return nested;
    }
  }
  return { value: null, key: null };
}

function reportedIncomeField(
  response: FinnhubResult<FinnhubFinancialsReportedResponse> | null,
  keys: string[],
  unavailableReason: UnavailableReason
): SourcedField<number> {
  const filing = latestReportedFiling(response?.data ?? null);
  const picked = pickFinancialConcept(filing?.report?.ic, keys, "data[].report.ic");
  return apiField(
    picked.value,
    "Finnhub Financials Reported",
    "/stock/financials-reported?symbol=&freq=annual",
    picked.key,
    response?.fetchedAt ?? null,
    filing?.endDate ?? null,
    response?.isStale ?? false,
    unavailableReason
  );
}

function latestStandardIncomeStatement(data: FinnhubFinancialsResponse | null) {
  const statements = Array.isArray(data?.financials) ? data.financials : [];
  return statements
    .sort((a, b) => String(b.endDate ?? "").localeCompare(String(a.endDate ?? "")))[0] ?? null;
}

function standardIncomeField(
  response: FinnhubResult<FinnhubFinancialsResponse> | null,
  keys: string[],
  unavailableReason: UnavailableReason
): SourcedField<number> {
  const statement = latestStandardIncomeStatement(response?.data ?? null);
  const picked = pickFinancialConcept(statement, keys, "financials[]");
  return apiField(
    picked.value,
    "Finnhub Financials Reported",
    "/stock/financials?symbol=&statement=ic&freq=annual",
    picked.key,
    response?.fetchedAt ?? null,
    statement?.endDate ?? null,
    response?.isStale ?? false,
    unavailableReason
  );
}

function firstAvailableFinancialField(primary: SourcedField<number>, fallback: SourcedField<number>): SourcedField<number> {
  return primary.value !== null ? primary : fallback;
}

function uniqueNonOverlappingBusinesses(
  response: FinnhubResult<FinnhubRevenueBreakdownResponse> | null,
  reason: UnavailableReason
): RevenueBusiness[] {
  const periods = Array.isArray(response?.data.data) ? response.data.data : [];
  const latest = periods
    .filter((period) => Array.isArray(period.breakdown?.revenueBreakdown))
    .sort((a, b) => String(b.breakdown?.endDate ?? "").localeCompare(String(a.breakdown?.endDate ?? "")))[0];

  const axes = latest?.breakdown?.revenueBreakdown ?? [];
  // A percentage is only shown where one axis is internally mutually exclusive. This avoids
  // presenting parents and children (e.g. Products + iPhone) as if they were additive peers.
  const usableAxis = axes.find((axis) => {
    const values = (axis.data ?? [])
      .map((item) => finiteNumber(item.percentage))
      .filter((value): value is number => value !== null);
    const total = values.reduce((sum, value) => sum + value, 0);
    return values.length > 0 && total >= 95 && total <= 105;
  });

  if (!usableAxis?.data || !response || !latest?.breakdown?.endDate) return [];

  const seenMembers = new Set<string>();
  return usableAxis.data
    .map((item) => ({ item, percentage: finiteNumber(item.percentage), value: finiteNumber(item.value) }))
    .filter(({ item, percentage }) => {
      const identity = String(item.member ?? item.label ?? "").trim().toLowerCase();
      if (!identity || percentage === null || seenMembers.has(identity)) return false;
      seenMembers.add(identity);
      return true;
    })
    .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))
    .slice(0, 5)
    .map(({ item, percentage, value }) => ({
      name: apiField(
        typeof item.label === "string" && item.label ? item.label : null,
        "Finnhub Revenue Breakdown",
        "/stock/revenue-breakdown?symbol=",
        "data[].breakdown.revenueBreakdown[].data[].label",
        response.fetchedAt,
        latest.breakdown?.endDate ?? null,
        response.isStale,
        reason
      ),
      description: aiPlaceholder<string>("尚無可用資料"),
      revenueSharePercent: apiField(
        percentage,
        "Finnhub Revenue Breakdown",
        "/stock/revenue-breakdown?symbol=",
        "data[].breakdown.revenueBreakdown[].data[].percentage",
        response.fetchedAt,
        latest.breakdown?.endDate ?? null,
        response.isStale,
        reason
      ),
      revenueAmount: apiField(
        value,
        "Finnhub Revenue Breakdown",
        "/stock/revenue-breakdown?symbol=",
        "data[].breakdown.revenueBreakdown[].data[].value",
        response.fetchedAt,
        latest.breakdown?.endDate ?? null,
        response.isStale,
        reason
      ),
      revenueUnit: apiField(
        typeof item.unit === "string" ? item.unit : null,
        "Finnhub Revenue Breakdown",
        "/stock/revenue-breakdown?symbol=",
        "data[].breakdown.revenueBreakdown[].data[].unit",
        response.fetchedAt,
        latest.breakdown?.endDate ?? null,
        response.isStale,
        reason
      ),
      axis: apiField(
        typeof usableAxis.axis === "string" ? usableAxis.axis : null,
        "Finnhub Revenue Breakdown",
        "/stock/revenue-breakdown?symbol=",
        "data[].breakdown.revenueBreakdown[].axis",
        response.fetchedAt,
        latest.breakdown?.endDate ?? null,
        response.isStale,
        reason
      )
    }));
}

function companyBackground(
  quote: StockQuote,
  profile: FinnhubResult<FinnhubProfile2> | null,
  reason: UnavailableReason
): CompanyBackground {
  const data = profile?.data;
  const fallbackName = yahooCompanyName(quote);
  const field = <T>(value: T | null, sourceField: string): SourcedField<T> =>
    apiField(value, "Finnhub Profile2", "/stock/profile2?symbol=", sourceField, profile?.fetchedAt ?? null, null, profile?.isStale ?? false, reason);

  return {
    companyName: data?.name ? field(data.name, "name") : fallbackName,
    industry: field(typeof data?.finnhubIndustry === "string" ? data.finnhubIndustry : null, "finnhubIndustry"),
    marketCapitalization: field(finiteNumber(data?.marketCapitalization), "marketCapitalization"),
    marketCapitalizationCurrency: field(typeof data?.currency === "string" ? data.currency : null, "currency"),
    exchange: field(typeof data?.exchange === "string" ? data.exchange : null, "exchange"),
    ipoDate: field(typeof data?.ipo === "string" ? data.ipo : null, "ipo"),
    logoUrl: field(typeof data?.logo === "string" ? data.logo : null, "logo"),
    country: field(typeof data?.country === "string" ? data.country : null, "country"),
    positioning: aiPlaceholder<string>("尚無可用資料")
  };
}

function buildFinancialMetrics(
  metric: FinnhubResult<FinnhubMetricResponse> | null,
  reported: FinnhubResult<FinnhubFinancialsReportedResponse> | null,
  standardFinancials: FinnhubResult<FinnhubFinancialsResponse> | null,
  reason: UnavailableReason
): FinancialMetricSet {
  const revenueKeys = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenue", "TotalRevenue"];
  const netIncomeKeys = ["NetIncomeLoss", "ProfitLoss", "NetIncome", "NetIncomeAvailableToCommonStockholders"];
  const revenue = firstAvailableFinancialField(
    reportedIncomeField(reported, revenueKeys, reason),
    standardIncomeField(standardFinancials, revenueKeys, reason)
  );
  const netIncome = firstAvailableFinancialField(
    reportedIncomeField(reported, netIncomeKeys, reason),
    standardIncomeField(standardFinancials, netIncomeKeys, reason)
  );

  return {
    pe: metricField(metric, ["peBasicExclExtraTTM", "peTTM", "pe"], reason),
    pb: metricField(metric, ["pbQuarterly", "priceToBook", "pbRatio", "pbAnnual"], reason),
    eps: metricField(metric, ["epsBasicExclExtraItemsTTM", "epsBasicExclExtraTTM", "earningsPerShareBasicTTM", "epsTTM", "eps"], reason),
    roe: metricField(metric, ["roeTTM", "returnOnEquityTTM"], reason),
    grossMargin: metricField(metric, ["grossMarginTTM", "grossProfitMarginTTM", "grossMarginPercent"], reason),
    week52High: metricField(metric, ["52WeekHigh"], reason),
    week52Low: metricField(metric, ["52WeekLow"], reason),
    revenue,
    netIncome
  };
}

function hasMeasuredFundamentals(metrics: FinancialMetricSet): boolean {
  return Object.values(metrics).some((field) => field.value !== null);
}

/**
 * Builds a Gemini-safe payload containing only normalised, source-labelled facts. Every provider
 * failure remains local and produces unavailable metadata rather than propagating a server error.
 */
export async function buildAnalysisContext(
  quote: StockQuote,
  locale: string
): Promise<AnalysisContext> {
  const marketScope = detectMarketScope(quote.symbol);
  const finnhubSupported = isFinnhubSupportedMarket(quote.symbol);
  const finnhubSymbol = normalizeFinnhubSymbol(quote.symbol);
  const reason = unavailableReasonForMarket(quote.symbol);

  const settled = finnhubSupported
    ? await Promise.allSettled([
        getFinnhubProfile2(quote.symbol),
        getFinnhubMetric(quote.symbol),
        getFinnhubFinancialsReported(quote.symbol, "annual"),
        getFinnhubFinancials(quote.symbol, "annual"),
        getFinnhubRevenueBreakdown(quote.symbol)
      ])
    : null;

  const profile = (settled?.[0]?.status === "fulfilled" ? settled[0].value : null) as FinnhubResult<FinnhubProfile2> | null;
  const metric = (settled?.[1]?.status === "fulfilled" ? settled[1].value : null) as FinnhubResult<FinnhubMetricResponse> | null;
  const reported = (settled?.[2]?.status === "fulfilled" ? settled[2].value : null) as FinnhubResult<FinnhubFinancialsReportedResponse> | null;
  const standardFinancials = (settled?.[3]?.status === "fulfilled" ? settled[3].value : null) as FinnhubResult<FinnhubFinancialsResponse> | null;
  const revenue = (settled?.[4]?.status === "fulfilled" ? settled[4].value : null) as FinnhubResult<FinnhubRevenueBreakdownResponse> | null;
  const metrics = buildFinancialMetrics(metric, reported, standardFinancials, reason);
  console.info("Finnhub financial mapping", {
    symbol: quote.symbol,
    revenueAvailable: metrics.revenue.value !== null,
    revenueEndpoint: metrics.revenue.endpoint,
    revenueField: metrics.revenue.sourceField,
    netIncomeAvailable: metrics.netIncome.value !== null,
    netIncomeEndpoint: metrics.netIncome.endpoint,
    netIncomeField: metrics.netIncome.sourceField
  });
  const revenueBusinesses = uniqueNonOverlappingBusinesses(revenue, "公司未揭露業務營收拆分");

  const unavailable: AnalysisContext["unavailable"] = [];
  for (const [field, sourced] of Object.entries(metrics)) {
    if (sourced.value === null) unavailable.push({ field, reason: sourced.unavailableReason ?? reason });
  }
  if (revenueBusinesses.length === 0) {
    unavailable.push({ field: "topRevenueBusinesses", reason: "公司未揭露業務營收拆分" });
  }

  return {
    quote,
    technicals: {
      // Filled by api/analyze.ts after Yahoo history computation so existing single source remains intact.
      smaShort: null,
      smaLong: null,
      smaShortPeriod: null,
      smaLongPeriod: null,
      trend: "SIDEWAYS",
      momentumPercent: null,
      volatilityPercent: null,
      supportLevel: null,
      resistanceLevel: null,
      pricePositionInRange: null,
      volumeNote: "尚未計算技術指標。",
      historyPoints: 0,
      dataSufficiency: "low"
    },
    locale,
    marketScope,
    finnhubSymbol,
    finnhubSupported,
    companyBackgroundBase: companyBackground(quote, profile, reason),
    financialMetrics: metrics,
    revenueBusinesses,
    unavailable,
    fundamentals: hasMeasuredFundamentals(metrics) ? metrics : null,
    analystRatings: null
  };
}
