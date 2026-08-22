export interface PriceHistoryPoint {
  date: string;
  price: number;
}

/** 與既有 Yahoo 行情資料提供者相容的歷史價格點名稱。 */
export type HistoricalDataPoint = PriceHistoryPoint;

export interface StockQuote {
  symbol: string;
  companyName: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  lastUpdated: string;
  history: PriceHistoryPoint[];
}

export type Trend = "UP" | "DOWN" | "SIDEWAYS";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface TechnicalIndicators {
  smaShort: number | null;
  smaLong: number | null;
  smaShortPeriod: number | null;
  smaLongPeriod: number | null;
  trend: Trend;
  momentumPercent: number | null;
  volatilityPercent: number | null;
  supportLevel: number | null;
  resistanceLevel: number | null;
  pricePositionInRange: number | null;
  volumeNote: string;
  historyPoints: number;
  dataSufficiency: ConfidenceLevel;
}

/** 僅使用產品需求指定的兩種可視信心標記。 */
export type DataConfidence =
  | "API 實測"
  | "AI 綜合判斷，非即時財報數據";

export type AnalysisSource =
  | "Finnhub Profile2"
  | "Finnhub Metric"
  | "Finnhub Financials Reported"
  | "Finnhub Revenue Breakdown"
  | "FMP Income Statement（年報／可能延遲）"
  | "Yahoo Finance"
  | "Gemini 推理"
  | "模擬分析 fallback"
  | "Unavailable";

export type MarketScope = "US" | "HK" | "CN" | "OTHER";

export type UnavailableReason =
  | "非美股，Finnhub Free 基本面未覆蓋"
  | "FINNHUB_API_KEY 未設定"
  | "Finnhub 端點權限不足"
  | "Finnhub 額度已達上限"
  | "Finnhub 回傳無此欄位"
  | "Finnhub 請求失敗"
  | "FMP_API_KEY 未設定"
  | "FMP 端點權限不足"
  | "FMP 額度已達上限"
  | "FMP 回傳無此欄位"
  | "FMP 請求失敗"
  | "公司未揭露業務營收拆分"
  | "尚無可用資料";

export interface SourceAttribution {
  dataConfidence: DataConfidence;
  source: AnalysisSource;
  endpoint: string | null;
  periodEnd: string | null;
  fetchedAt: string | null;
  isStale: boolean;
}

/**
 * 所有面板欄位均以這個 wrapper 表達來源。value 為 null 時，
 * UI 只能顯示「需查證」或「佔比未知」，不得臆造數字。
 */
export interface SourcedField<T> extends SourceAttribution {
  value: T | null;
  sourceField: string | null;
  unavailableReason: UnavailableReason | null;
}

export interface CompanyBackground {
  companyName: SourcedField<string>;
  industry: SourcedField<string>;
  marketCapitalization: SourcedField<number>;
  marketCapitalizationCurrency: SourcedField<string>;
  exchange: SourcedField<string>;
  ipoDate: SourcedField<string>;
  logoUrl: SourcedField<string>;
  country: SourcedField<string>;
  /** 僅是 AI 對已知事實的定性定位，禁止未支撐的精確財務數字。 */
  positioning: SourcedField<string>;
}

export type CatalystDirection = "正面" | "負面" | "中性" | "待驗證";

export interface Catalyst {
  title: SourcedField<string>;
  direction: SourcedField<CatalystDirection>;
  rationale: SourcedField<string>;
  evidence: SourcedField<string>;
}

export interface RevenueBusiness {
  name: SourcedField<string>;
  description: SourcedField<string>;
  revenueSharePercent: SourcedField<number>;
  revenueAmount: SourcedField<number>;
  revenueUnit: SourcedField<string>;
  axis: SourcedField<string>;
}

export interface Competitor {
  name: SourcedField<string>;
  comparison: SourcedField<string>;
}

export interface CompetitiveAdvantage {
  summary: SourcedField<string>;
  limitations: SourcedField<string>;
}

export interface FinancialMetricSet {
  pe: SourcedField<number>;
  pb: SourcedField<number>;
  eps: SourcedField<number>;
  roe: SourcedField<number>;
  grossMargin: SourcedField<number>;
  week52High: SourcedField<number>;
  week52Low: SourcedField<number>;
  revenue: SourcedField<number>;
  netIncome: SourcedField<number>;
}

/** 使用者要求的結構化分析主契約。 */
export interface StockAnalysis {
  schemaVersion: "1.0";
  symbol: string;
  finnhubSymbol: string | null;
  marketScope: MarketScope;
  generatedAt: string;
  companyBackground: CompanyBackground;
  oneLineSummary: SourcedField<string>;
  catalysts: Catalyst[];
  topRevenueBusinesses: RevenueBusiness[];
  competitors: Competitor[];
  competitiveAdvantage: CompetitiveAdvantage;
  financialMetrics: FinancialMetricSet;
}

export interface AnalysisNewsItem {
  title: string;
  source: string;
  sentiment: "positive" | "negative" | "neutral";
  url?: string;
}

export interface AnalysisSourceLink {
  title: string;
  uri: string;
}

/** 舊版推薦與技術面卡片仍可使用；新增欄位皆來自 StockAnalysis。 */
export interface AnalysisResult extends StockAnalysis {
  companyName: string;
  lastAnalyzed: string;
  recommendation: "BUY" | "HOLD" | "SELL" | "NEUTRAL";
  recommendationReason: string;
  confidenceLevel: ConfidenceLevel;
  dataLimitations: string[];
  technicalSummary: {
    trend: Trend;
    movingAverageNote: string;
    momentumNote: string;
    volumePriceNote: string;
    supportLevel: number | null;
    resistanceLevel: number | null;
    summary: string;
  };
  valuation: {
    assessment: "UNDERVALUED" | "FAIR" | "OVERVALUED" | "INSUFFICIENT_DATA";
    reasoning: string;
  };
  risks: string[];
  summary: string;
  outlook: string;
  recentNews: AnalysisNewsItem[];
  sources: AnalysisSourceLink[];
}

/** 相容現有 React 元件的 import 名稱。 */
export type AIAnalysisResult = AnalysisResult;

export interface AnalysisContext {
  quote: StockQuote;
  technicals: TechnicalIndicators;
  locale: string;
  marketScope: MarketScope;
  finnhubSymbol: string | null;
  finnhubSupported: boolean;
  companyBackgroundBase: CompanyBackground;
  financialMetrics: FinancialMetricSet;
  revenueBusinesses: RevenueBusiness[];
  unavailable: Array<{ field: string; reason: UnavailableReason }>;
  /** 僅在至少一個實測基本面欄位存在時為非 null。 */
  fundamentals: FinancialMetricSet | null;
  analystRatings: null;
}

/** 下列介面保留給既有引用，不用於新的結構化面板。 */
export interface FundamentalsData {
  peRatio: number | null;
  pbRatio: number | null;
  eps: number | null;
  roe: number | null;
  grossMarginPercent: number | null;
  revenueGrowthPercent: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export interface AnalystRatingsData {
  averageRating: string | null;
  priceTarget: number | null;
  numAnalysts: number | null;
  distribution: { buy: number | null; hold: number | null; sell: number | null };
}

export interface CompanyProfile {
  name: string | null;
  industry: string | null;
  exchange: string | null;
  ipoDate: string | null;
  marketCap: number | null;
  website: string | null;
}

export interface PortfolioItem {
  symbol: string;
  shares: number;
  /** 加權平均持有成本；與 PortfolioCalculator 的 persisted 資料格式一致。 */
  avgCost: number;
  /** 可選的自動停損觸發價格。 */
  stopLossPrice?: number;
  [key: string]: unknown;
}
