import type { AnalysisContext, ConfidenceLevel, StockQuote, TechnicalIndicators, Trend } from "../src/types.js";

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function simpleMovingAverage(prices: number[]): number | null {
  if (prices.length === 0) return null;
  return round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** 僅以 Yahoo 實測價格序列產生技術指標；資料不足時一律回傳 null。 */
export function computeTechnicalIndicators(quote: StockQuote): TechnicalIndicators {
  const prices = quote.history
    .map((point) => point.price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price));
  const historyPoints = prices.length;

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
      volumeNote: "歷史資料點過少，且沒有逐日成交量序列，無法產生量價指標。",
      historyPoints,
      dataSufficiency: "low"
    };
  }

  const shortPeriod = Math.max(2, Math.min(20, Math.round(historyPoints * 0.2)));
  const longPeriod = Math.max(shortPeriod + 1, Math.min(60, Math.round(historyPoints * 0.6)));
  const effectiveShortPeriod = Math.min(shortPeriod, historyPoints);
  const effectiveLongPeriod = Math.min(longPeriod, historyPoints);
  const smaShort = simpleMovingAverage(prices.slice(-effectiveShortPeriod));
  const smaLong = simpleMovingAverage(prices.slice(-effectiveLongPeriod));

  let trend: Trend = "SIDEWAYS";
  if (smaShort !== null && smaLong !== null && smaLong !== 0) {
    const difference = ((smaShort - smaLong) / smaLong) * 100;
    if (difference > 0.5) trend = "UP";
    else if (difference < -0.5) trend = "DOWN";
  } else if (prices[0] !== 0) {
    const difference = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
    if (difference > 0.5) trend = "UP";
    else if (difference < -0.5) trend = "DOWN";
  }

  const momentumLookback = Math.min(effectiveShortPeriod, historyPoints - 1);
  const pastPrice = prices[prices.length - 1 - momentumLookback];
  const momentumPercent = momentumLookback >= 1 && pastPrice !== 0
    ? round(((prices[prices.length - 1] - pastPrice) / pastPrice) * 100)
    : null;

  const changes: number[] = [];
  for (let index = 1; index < prices.length; index += 1) {
    if (prices[index - 1] !== 0) changes.push(((prices[index] - prices[index - 1]) / prices[index - 1]) * 100);
  }
  const volatility = standardDeviation(changes);
  const volatilityPercent = volatility === null ? null : round(volatility);

  const supportLevel = round(Math.min(Math.min(...prices), quote.low ?? Number.POSITIVE_INFINITY));
  const resistanceLevel = round(Math.max(Math.max(...prices), quote.high ?? Number.NEGATIVE_INFINITY));
  const range = resistanceLevel - supportLevel;
  const pricePositionInRange = range > 0 ? round(Math.min(1, Math.max(0, (quote.price - supportLevel) / range)), 3) : null;
  const dataSufficiency: ConfidenceLevel = historyPoints >= 20 ? "high" : historyPoints >= 8 ? "medium" : "low";

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
    volumeNote: `目前成交量約為 ${quote.volume.toLocaleString()}（單一時間點快照）；缺少逐日成交量序列，不能推論 OBV 或量價背離。`,
    historyPoints,
    dataSufficiency
  };
}

/** 後端強制限制整體信心，不能只依賴模型的自我評等。 */
export function deriveConfidence(
  technicalSufficiency: ConfidenceLevel,
  hasFundamentals: boolean,
  hasAnalystRatings: boolean
): ConfidenceLevel {
  if (!hasFundamentals && !hasAnalystRatings) return technicalSufficiency === "low" ? "low" : "medium";
  return technicalSufficiency;
}

/** 讓 AI 及前端都取得相同、可稽核的資料不足揭露。 */
export function buildDataLimitations(context: AnalysisContext): string[] {
  const limitations: string[] = [];

  if (!context.finnhubSupported) {
    limitations.push("此標的不是美股；Finnhub Free 基本面資料未覆蓋，研究型欄位屬 AI 綜合判斷，非即時財報數據。");
  } else if (!context.fundamentals) {
    limitations.push(
      "未取得可驗證的 Finnhub 基本面數據（例如 EPS、營收、毛利率、ROE）；精確財務數值皆標示為需查證。"
    );
  }

  if (context.revenueBusinesses.length === 0) {
    limitations.push("公司未取得可驗證的業務營收拆分；所有業務佔比均顯示為佔比未知。");
  }

  if (context.technicals.historyPoints < 20) {
    limitations.push(`技術指標只基於 ${context.technicals.historyPoints} 個價格資料點，均線與動能訊號的穩定性有限。`);
  }

  limitations.push("歷史資料沒有逐點成交量序列，無法計算 OBV、量價背離等進階量能指標。");
  return limitations;
}
