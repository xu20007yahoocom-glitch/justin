import { fetchStockFromYahoo } from "./stocksData.js";
import { computeTechnicalIndicators } from "./technicalIndicators.js";
import type { AnalysisResult } from "../src/types.js";

export async function getSimulatedAnalysis(symbol: string, companyName?: string): Promise<AnalysisResult> {
  // Defensive: ensure we always return the full AnalysisResult shape.
  companyName = companyName ?? symbol;

  try {
    const quote = await fetchStockFromYahoo(symbol);
    const technicals = computeTechnicalIndicators(quote);

    const dataLimitations: string[] = [];
    // If fundamentals/ratings are not available, note that in limitations
    dataLimitations.push("缺少即時財報 / 估值資料（例如 EPS、營收明細、分析師目標價等）");
    dataLimitations.push("若需要更完整估值請接入外部基本面資料來源（如 Finnhub / Longbridge 等）");

    const technicalSummary = {
      trend: technicals.trend,
      movingAverageNote:
        technicals.smaShort !== null && technicals.smaLong !== null
          ? `短期均線(${technicals.smaShortPeriod}期) 約 ${technicals.smaShort}，長期均線(${technicals.smaLongPeriod}期) 約 ${technicals.smaLong}，當前排列顯示 ${technicals.trend}`
          : "歷史資料點不足，暫無法計算穩定的均線關係。",
      momentumNote:
        technicals.momentumPercent !== null
          ? `短期動能 (ROC) 約 ${technicals.momentumPercent}%，顯示當前價格相較於數日前的變化趨勢。`
          : "歷史資料不足，無法計算動能。",
      volumePriceNote: technicals.volumeNote || "成交量資料不足或不可用。",
      supportLevel: technicals.supportLevel,
      resistanceLevel: technicals.resistanceLevel,
      summary:
        `依據歷史價格與技術指標，趨勢為 ${technicals.trend}，價格位於支撐-壓力區間的 ${
          technicals.pricePositionInRange !== null ? (technicals.pricePositionInRange * 100).toFixed(1) + "%" : "N/A"
        }。`
    };

    const result: AnalysisResult = {
      symbol: quote.symbol,
      companyName: quote.companyName ?? companyName,
      lastAnalyzed: new Date().toISOString(),

      recommendation: "NEUTRAL",
      recommendationReason: "資料有限，建議以技術指標作為短期參考，若需長期投資評估請補充基本面資料。",
      confidenceLevel: "low",
      dataLimitations,

      technicalSummary,

      valuation: {
        assessment: "INSUFFICIENT_DATA",
        reasoning: "缺乏即時完整的基本面數據以進行準確估值判斷（EPS、營收、目標價等）。"
      },

      catalysts: [],
      risks: [],

      summary: technicalSummary.summary,
      outlook: "在資料有限情況下，以技術面短期觀察為主；若取得基本面資料，建議重新評估。",
      oneSentenceSummary: `技術面觀察偏向 ${technicals.trend}，但基本面資料不足以得出確定性結論。`,
      companyBackground: quote.companyName ?? "",
      top3RevenueSegment: [],
      competitors: [],
      advantages: [],

      recentNews: [],
      sources: []
    };

    return result;
  } catch (err) {
    // In case of any runtime error, return a minimal but valid AnalysisResult
    const fallback: AnalysisResult = {
      symbol: symbol,
      companyName: companyName ?? symbol,
      lastAnalyzed: new Date().toISOString(),

      recommendation: "NEUTRAL",
      recommendationReason: "本地模擬分析因內部錯誤未能完成，請稍後重試。",
      confidenceLevel: "low",
      dataLimitations: ["模擬分析執行錯誤：無法取得或處理歷史價格資料。"],

      technicalSummary: {
        trend: "SIDEWAYS",
        movingAverageNote: "無法計算（模擬分析錯誤）",
        momentumNote: "無法計算（模擬分析錯誤）",
        volumePriceNote: "無法計算（模擬分析錯誤）",
        supportLevel: null,
        resistanceLevel: null,
        summary: "模擬分析失敗。"
      },

      valuation: {
        assessment: "INSUFFICIENT_DATA",
        reasoning: "模擬分析失敗，無法提供估值判斷。"
      },

      catalysts: [],
      risks: [],

      summary: "模擬分析錯誤，請稍後再試或檢查伺服器日誌。",
      outlook: "N/A",
      oneSentenceSummary: "模擬分析未完成。",
      companyBackground: "",
      top3RevenueSegment: [],
      competitors: [],
      advantages: [],

      recentNews: [],
      sources: []
    };

    return fallback;
  }
}
