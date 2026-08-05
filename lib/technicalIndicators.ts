/**
 * Deterministic technical-indicator computation from real Yahoo Finance
 * data (StockQuote.history). This module produces ONLY real numbers (or
 * `null` when there isn't enough data to compute something meaningfully)
 * — it never invents figures. lib/simulatedAnalysis.ts and api/analyze.ts
 * both rely on this as the single source of truth for anything numeric
 * in the "technical" analysis block, so the LLM is only ever asked to
 * *narrate* these numbers, never to *guess* them.
 *
 * Important limitation (by design, not a bug): StockQuote.history only
 * carries { date, price } for real Yahoo Finance responses (no per-bar
 * volume series — see lib/stocksData.ts). That means classic volume-based
 * signals (OBV, volume/price divergence) cannot be computed here. This
 * module is explicit about that via `volumeNote`, and callers must not
 * ask the LLM to fill that gap with invented figures.
 */
import type { StockQuote, TechnicalIndicators, ConfidenceLevel, Trend, AnalysisContext } from "../src/types.js";

function round(n: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function simpleMovingAverage(prices: number[]): number | null {
  if (prices.length === 0) return null;
  const sum = prices.reduce((acc, p) => acc + p, 0);
  return round(sum / prices.length);
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute a real, number-only technical indicator snapshot from a
 * StockQuote. Adapts window sizes to however many history points are
 * actually available instead of assuming a fixed 20/50-day window that
 * the data may not support.
 */
export function computeTechnicalIndicators(quote: StockQuote): TechnicalIndicators {
  const prices = quote.history
    .map((h) => h.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));

  const historyPoints = prices.length;

  // Not enough data to compute anything meaningful.
  if (historyPoints < 3) {
    return {
      smaShort: null,
      smaLong: null,
      smaShortPeriod: null,
      smaLongPeriod: null,
      trend: "SIDEWAYS",
      momentumPercent: null,
      volatilityPercent: null,
      supportLevel: quote.low ?? null,
      resistanceLevel: quote.high ?? null,
      pricePositionInRange: null,
      volumeNote:
        "歷史資料點過少，無法計算量能相關指標；僅有當日成交量，缺乏逐日量能序列，無法判斷量價背離。",
      historyPoints,
      dataSufficiency: "low"
    };
  }

  // Adaptive window sizes: "short" ~= 20% of available points, "long" ~= 60%,
  // each clamped to sensible bounds so tiny datasets still produce a usable
  // (if coarse) signal, and large datasets don't use unreasonably short windows.
  const shortPeriod = Math.max(2, Math.min(20, Math.round(historyPoints * 0.2)));
  const longPeriod = Math.max(shortPeriod + 1, Math.min(60, Math.round(historyPoints * 0.6)));
  const effectiveLongPeriod = Math.min(longPeriod, historyPoints);
  const effectiveShortPeriod = Math.min(shortPeriod, historyPoints);

  const recentForShort = prices.slice(-effectiveShortPeriod);
  const recentForLong = prices.slice(-effectiveLongPeriod);

  const smaShort = simpleMovingAverage(recentForShort);
  const smaLong = simpleMovingAverage(recentForLong);

  // Trend: prefer SMA relationship; fall back to first/last price comparison.
  let trend: Trend = "SIDEWAYS";
  if (smaShort !== null && smaLong !== null) {
    const diffPercent = ((smaShort - smaLong) / smaLong) * 100;
    if (diffPercent > 0.5) trend = "UP";
    else if (diffPercent < -0.5) trend = "DOWN";
    else trend = "SIDEWAYS";
  } else {
    const first = prices[0];
    const last = prices[prices.length - 1];
    const diffPercent = ((last - first) / first) * 100;
    if (diffPercent > 0.5) trend = "UP";
    else if (diffPercent < -0.5) trend = "DOWN";
  }

  // Momentum: rate of change over the available lookback window
  // (uses the same window as the "short" SMA period for consistency).
  const momentumLookback = Math.min(effectiveShortPeriod, historyPoints - 1);
  let momentumPercent: number | null = null;
  if (momentumLookback >= 1) {
    const past = prices[prices.length - 1 - momentumLookback];
    const latest = prices[prices.length - 1];
    if (past !== 0) {
      momentumPercent = round(((latest - past) / past) * 100);
    }
  }

  // Volatility: stdev of period-over-period % changes.
  const pctChanges: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    if (prev !== 0) pctChanges.push(((prices[i] - prev) / prev) * 100);
  }
  const volatilityPercent = pctChanges.length >= 2 ? round(standardDeviation(pctChanges) as number) : null;

  // Support / resistance from observed history extremes, widened slightly
  // by the quote's own intraday high/low if those extend the range.
  const historyMin = Math.min(...prices);
  const historyMax = Math.max(...prices);
  const supportLevel = round(Math.min(historyMin, quote.low ?? historyMin));
  const resistanceLevel = round(Math.max(historyMax, quote.high ?? historyMax));

  let pricePositionInRange: number | null = null;
  const range = resistanceLevel - supportLevel;
  if (range > 0) {
    pricePositionInRange = round(Math.min(1, Math.max(0, (quote.price - supportLevel) / range)), 3);
  }

  const volumeNote =
    `目前成交量約為 ${quote.volume.toLocaleString()}（僅單一時間點快照）。` +
    `因歷史資料僅含逐日/逐時「價格」而無逐點「成交量」序列，無法計算量價背離或 OBV 等量能指標，此處僅供參考。`;

  // Data sufficiency for the technical block alone.
  let dataSufficiency: ConfidenceLevel = "low";
  if (historyPoints >= 20) dataSufficiency = "high";
  else if (historyPoints >= 8) dataSufficiency = "medium";

  return {
    smaShort,
    smaLong,
    smaShortPeriod: effectiveShortPeriod,
    smaLongPeriod: effectiveLongPeriod,
    trend,
    momentumPercent,
    volatilityPercent,
    supportLevel,
    resistanceLevel,
    pricePositionInRange,
    volumeNote,
    historyPoints,
    dataSufficiency
  };
}

/**
 * Derive the overall AnalysisResult.confidenceLevel from the technical
 * data sufficiency AND the (currently always-missing) fundamentals /
 * analyst-ratings data. This is intentionally computed server-side (not
 * left to the LLM) so the "cap confidence when data is incomplete" rule
 * the user asked for is actually enforced rather than merely requested
 * via prompt wording.
 */
export function deriveConfidence(
  technicalSufficiency: ConfidenceLevel,
  hasFundamentals: boolean,
  hasAnalystRatings: boolean
): ConfidenceLevel {
  // Without fundamentals/analyst data, we structurally cannot be "high"
  // confidence overall, no matter how good the technical picture looks.
  if (!hasFundamentals && !hasAnalystRatings) {
    return technicalSufficiency === "low" ? "low" : "medium";
  }
  return technicalSufficiency;
}

/**
 * Build the explicit "what this analysis structurally cannot cover"
 * list from an AnalysisContext. Shared by api/analyze.ts (Gemini path)
 * and lib/simulatedAnalysis.ts (offline path) so both surfaces present
 * the exact same honesty disclosure regardless of which one runs.
 */
export function buildDataLimitations(context: AnalysisContext): string[] {
  const limitations: string[] = [];

  if (!context.fundamentals) {
    limitations.push(
      "缺乏完整財務報表數據（如精確 EPS、營收、毛利率、ROE），基本面相關判斷僅供參考，不構成精確財務分析。"
    );
  }
  if (!context.analystRatings) {
    limitations.push("缺乏分析師評等與目標價共識數據，無法納入市場專業機構觀點。");
  }
  if (context.technicals.historyPoints < 20) {
    limitations.push(
      `技術指標僅基於 ${context.technicals.historyPoints} 個歷史資料點計算，樣本較短，均線與動能訊號的穩定性有限。`
    );
  }
  limitations.push(
    "歷史資料僅含價格序列、缺乏逐點成交量序列，無法計算量價背離（如 OBV）等進階量能指標。"
  );

  return limitations;
}
