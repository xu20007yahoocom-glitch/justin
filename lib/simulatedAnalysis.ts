import { buildAnalysisContext } from "./analysisData.js";
import { fetchStockFromYahoo } from "./stocksData.js";
import { buildDataLimitations, computeTechnicalIndicators } from "./technicalIndicators.js";
import type {
  AnalysisContext,
  AnalysisResult,
  CompanyBackground,
  FinancialMetricSet,
  MarketScope,
  SourcedField
} from "../src/types.js";

const AI_CONFIDENCE = "AI 綜合判斷，非即時財報數據" as const;

function fallbackField(value: string | null, reason = "尚無可用資料"): SourcedField<string> {
  return {
    value,
    dataConfidence: AI_CONFIDENCE,
    source: "模擬分析 fallback",
    endpoint: null,
    sourceField: null,
    fetchedAt: null,
    periodEnd: null,
    isStale: false,
    unavailableReason: value === null ? "尚無可用資料" : null
  };
}

function unavailableNumber(reason = "尚無可用資料"): SourcedField<number> {
  return {
    value: null,
    dataConfidence: AI_CONFIDENCE,
    source: "Unavailable",
    endpoint: null,
    sourceField: null,
    fetchedAt: null,
    periodEnd: null,
    isStale: false,
    unavailableReason: reason as SourcedField<number>["unavailableReason"]
  };
}

function bareCompanyBackground(companyName: string): CompanyBackground {
  return {
    companyName: fallbackField(companyName),
    industry: fallbackField(null),
    marketCapitalization: unavailableNumber(),
    marketCapitalizationCurrency: fallbackField(null),
    exchange: fallbackField(null),
    ipoDate: fallbackField(null),
    logoUrl: fallbackField(null),
    country: fallbackField(null),
    positioning: fallbackField("系統處於安全 fallback，未取得可驗證的公司定位資料。")
  };
}

function bareMetrics(): FinancialMetricSet {
  return {
    pe: unavailableNumber(),
    pb: unavailableNumber(),
    eps: unavailableNumber(),
    roe: unavailableNumber(),
    grossMargin: unavailableNumber(),
    week52High: unavailableNumber(),
    week52Low: unavailableNumber(),
    revenue: unavailableNumber(),
    netIncome: unavailableNumber()
  };
}

function minimalResult(symbol: string, companyName: string): AnalysisResult {
  const background = bareCompanyBackground(companyName);
  return {
    schemaVersion: "1.0",
    symbol,
    finnhubSymbol: null,
    marketScope: symbol.toUpperCase().endsWith(".HK")
      ? "HK"
      : symbol.toUpperCase().endsWith(".SH") || symbol.toUpperCase().endsWith(".SZ")
        ? "CN"
        : "OTHER",
    generatedAt: new Date().toISOString(),
    companyName,
    lastAnalyzed: new Date().toISOString(),
    companyBackground: background,
    oneLineSummary: fallbackField("資料取得失敗，暫無法形成可驗證的投資摘要。"),
    catalysts: [],
    topRevenueBusinesses: [],
    competitors: [],
    competitiveAdvantage: {
      summary: fallbackField(null),
      limitations: fallbackField("缺乏可驗證資料，競爭優勢需查證。")
    },
    financialMetrics: bareMetrics(),
    recommendation: "NEUTRAL",
    recommendationReason: "資料不足，僅回傳安全 fallback。",
    confidenceLevel: "low",
    dataLimitations: ["無法取得或處理即時行情與基本面資料；所有財務數值均標為需查證。"],
    technicalSummary: {
      trend: "SIDEWAYS",
      movingAverageNote: "無法計算。",
      momentumNote: "無法計算。",
      volumePriceNote: "無法計算。",
      supportLevel: null,
      resistanceLevel: null,
      summary: "技術資料不可用。"
    },
    valuation: {
      assessment: "INSUFFICIENT_DATA",
      reasoning: "缺乏可驗證的基本面與技術面資料。"
    },
    risks: ["資料可用性風險。"],
    summary: "安全 fallback 已啟用。",
    outlook: "需取得可驗證資料後重新分析。",
    recentNews: [],
    sources: []
  };
}

/**
 * Returns the identical AnalysisResult shape used by the Gemini path. It preserves every API
 * measurement already assembled in context, and only adds explicitly-labelled qualitative fallback text.
 */
export async function getSimulatedAnalysis(
  symbol: string,
  companyName?: string,
  suppliedContext?: AnalysisContext
): Promise<AnalysisResult> {
  try {
    let context = suppliedContext;
    if (!context) {
      const quote = await fetchStockFromYahoo(symbol);
      context = await buildAnalysisContext(quote, "zh-TW");
      context.technicals = computeTechnicalIndicators(quote);
    }

    const technicals = context.technicals;
    const dataLimitations = buildDataLimitations(context);
    dataLimitations.push("Gemini 未配置或呼叫失敗；定性欄位使用安全 fallback，非即時財報數據。");

    const trendText = technicals.trend === "UP" ? "上行" : technicals.trend === "DOWN" ? "下行" : "盤整";
    const apiRevenueBusinesses = context.revenueBusinesses.map((business) => ({
      ...business,
      description: business.description.value
        ? business.description
        : fallbackField("此項目名稱與占比（如有）來自 Finnhub；未取得可驗證的業務文字說明。")
    }));

    return {
      schemaVersion: "1.0",
      symbol: context.quote.symbol,
      finnhubSymbol: context.finnhubSymbol,
      marketScope: context.marketScope,
      generatedAt: new Date().toISOString(),
      companyName: context.companyBackgroundBase.companyName.value ?? companyName ?? context.quote.companyName,
      lastAnalyzed: new Date().toISOString(),
      companyBackground: {
        ...context.companyBackgroundBase,
        positioning: fallbackField("未使用 AI 即時推理；公司定位僅以目前可用 API 公司背景為準。")
      },
      oneLineSummary: fallbackField(`技術面目前呈現${trendText}，但未完成 AI 推理，基本面缺口請以欄位來源標記為準。`),
      catalysts: [],
      topRevenueBusinesses: apiRevenueBusinesses,
      competitors: [],
      competitiveAdvantage: {
        summary: fallbackField(null),
        limitations: fallbackField("未完成 AI 研究；競爭優勢與同業比較均需查證。")
      },
      financialMetrics: context.financialMetrics,
      recommendation: "NEUTRAL",
      recommendationReason: "Gemini 不可用或未設定，系統不將技術資料延伸為個人化買賣建議。",
      confidenceLevel: technicals.dataSufficiency === "high" && context.fundamentals ? "medium" : "low",
      dataLimitations,
      technicalSummary: {
        trend: technicals.trend,
        movingAverageNote:
          technicals.smaShort !== null && technicals.smaLong !== null
            ? `短期與長期均線由 Yahoo 歷史價格計算，訊號為${trendText}。`
            : "歷史資料不足，無法計算穩定的均線關係。",
        momentumNote:
          technicals.momentumPercent !== null
            ? "動能已依 Yahoo 價格序列計算；請參考技術指標欄位。"
            : "歷史資料不足，無法計算動能。",
        volumePriceNote: technicals.volumeNote,
        supportLevel: technicals.supportLevel,
        resistanceLevel: technicals.resistanceLevel,
        summary: `此 fallback 僅保留實測行情與可用基本面資料；趨勢為${trendText}。`
      },
      valuation: {
        assessment: context.fundamentals ? "INSUFFICIENT_DATA" : "INSUFFICIENT_DATA",
        reasoning: "未完成 Gemini 分析；不可根據不完整資料產生精確估值結論。"
      },
      risks: ["AI 分析服務目前不可用。", "未標示為 API 實測的研究性欄位均需查證。"],
      summary: "系統已啟用安全 fallback；所有可用數值均保留原始 API 來源。",
      outlook: "待 Gemini 服務恢復後，可在不覆寫現有 API 事實的前提下補充定性研究。",
      recentNews: [],
      sources: []
    };
  } catch (error) {
    console.error("Simulated analysis failed:", error);
    return minimalResult(symbol, companyName ?? symbol);
  }
}
