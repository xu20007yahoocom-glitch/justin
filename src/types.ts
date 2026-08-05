export interface HistoricalDataPoint {
  date: string; // MM/DD or HH:MM
  price: number;
  volume?: number;
}

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
  history: HistoricalDataPoint[];
}

export interface PortfolioItem {
  symbol: string;
  shares: number;
  avgCost: number;
  stopLossPrice?: number;
}

export interface AIAnalysisResult {
  summary: string;
  recommendation: 'BUY' | 'HOLD' | 'SELL' | 'NEUTRAL';
  outlook: string;
  recentNews: {
    title: string;
    source: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    url?: string;
  }[];
  sources?: {
    title: string;
    uri: string;
  }[];
  lastAnalyzed: string;
  companyBackground?: string;
  oneSentenceSummary?: string;
  catalysts?: string[];
  top3RevenueSegment?: string[];
  competitors?: string[];
  advantages?: string[];
}

/* =========================================================================
 * AnalysisResult — structured AI analysis output (Longbridge-inspired
 * framework, adapted to only rely on the Yahoo Finance data this app
 * actually has access to). See PR discussion for the full framework
 * mapping. Key design principles:
 *   1. Any *numeric* technical figure (SMA, momentum, support/resistance)
 *      is computed by lib/technicalIndicators.ts from real history data —
 *      never invented by the LLM.
 *   2. Fields describing data we structurally do not have (financial
 *      statements, analyst consensus) must be flagged via
 *      `dataLimitations`, never filled with fabricated precise numbers.
 *   3. `recommendation` intentionally keeps the existing four-state union
 *      (BUY/HOLD/SELL/NEUTRAL) used by AIAnalysisResult/the frontend —
 *      no new recommendation vocabulary was introduced.
 * ========================================================================= */

/** Confidence in the overall analysis. Capped at "medium" whenever
 *  fundamentals/analystRatings data is unavailable (which, today, is
 *  always — see AnalysisContext). */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Direction inferred from real price/SMA data, not guessed. */
export type Trend = 'UP' | 'DOWN' | 'SIDEWAYS';

/** Relative valuation call. Deliberately has no numeric PE/PB fields —
 *  those require financial-statement data this app does not have. */
export type ValuationAssessment = 'UNDERVALUED' | 'FAIR' | 'OVERVALUED' | 'INSUFFICIENT_DATA';

/** Whether a catalyst/event is expected to help or hurt the stock. */
export type CatalystType = 'bullish' | 'bearish';

/** A single near/mid-term event that could move the stock, tagged by
 *  direction (replaces the old flat `catalysts: string[]`). */
export interface Catalyst {
  type: CatalystType;
  description: string;
}

/**
 * Deterministic, real-number technical indicators computed from
 * StockQuote.history by lib/technicalIndicators.ts. Every field is either
 * a genuine computed value or `null` when there isn't enough history to
 * compute it meaningfully — never a placeholder/fabricated number.
 */
export interface TechnicalIndicators {
  /** Short-period simple moving average of history prices, or null if
   *  there are too few data points to compute one meaningfully. */
  smaShort: number | null;
  /** Long-period simple moving average of history prices, or null. */
  smaLong: number | null;
  /** Number of data points each SMA actually averaged over (for
   *  transparency in the prompt/UI — these are NOT fixed 20/50-day
   *  windows, they adapt to however much history is available). */
  smaShortPeriod: number | null;
  smaLongPeriod: number | null;
  /** Trend derived from SMA relationship (or first/last price if SMAs
   *  are unavailable). */
  trend: Trend;
  /** Rate-of-change momentum over the available lookback window, in %. */
  momentumPercent: number | null;
  /** Standard deviation of period-over-period % price changes, in %. */
  volatilityPercent: number | null;
  /** Lowest price observed in the available history (used as a naive
   *  support estimate). */
  supportLevel: number | null;
  /** Highest price observed in the available history (used as a naive
   *  resistance estimate). */
  resistanceLevel: number | null;
  /** Current price's position within the observed [support, resistance]
   *  range, 0 = at support, 1 = at resistance. Null if range is zero
   *  width or unavailable. */
  pricePositionInRange: number | null;
  /** Human-readable note about volume, always including the disclaimer
   *  that only a single current-day volume figure is available (no
   *  historical per-bar volume series), so volume/price divergence
   *  (e.g. OBV-style signals) cannot be assessed. */
  volumeNote: string;
  /** How many usable history points fed this calculation. */
  historyPoints: number;
  /** Self-assessed sufficiency of the *technical* data alone (independent
   *  of the fundamentals/analyst-rating gap, which is handled by the
   *  overall confidenceLevel cap). */
  dataSufficiency: ConfidenceLevel;
}

/** Gemini-authored (or, offline, template-authored) narrative wrapping the
 *  real numbers in TechnicalIndicators. Numeric fields here are copied
 *  straight from TechnicalIndicators, never re-derived by the LLM. */
export interface TechnicalSummary {
  trend: Trend;
  movingAverageNote: string;
  momentumNote: string;
  volumePriceNote: string;
  supportLevel: number | null;
  resistanceLevel: number | null;
  summary: string;
}

export interface ValuationSummary {
  assessment: ValuationAssessment;
  reasoning: string;
}

export interface AnalysisNewsItem {
  title: string;
  source: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  url?: string;
}

export interface AnalysisSourceRef {
  title: string;
  uri: string;
}

/**
 * Placeholder for future financial-statement data (a real fundamentals
 * API/Longbridge integration). Every field is optional and the whole
 * object is `null` today — nothing in the current pipeline populates it.
 * Keeping the shape defined now means a future data source can be wired
 * in later by filling this object, without changing the analysis logic
 * or the AnalysisResult contract.
 */
export interface FundamentalsData {
  eps?: number;
  peRatio?: number;
  pbRatio?: number;
  roe?: number;
  revenueGrowthPercent?: number;
  grossMarginPercent?: number;
  debtToEquity?: number;
  dividendYieldPercent?: number;
  [key: string]: unknown;
}

/**
 * Placeholder for future analyst-consensus data (price targets, ratings
 * distribution). Optional, `null` today — same rationale as
 * FundamentalsData above.
 */
export interface AnalystRatingsData {
  averageRating?: string;
  priceTarget?: number;
  numAnalysts?: number;
  distribution?: { buy?: number; hold?: number; sell?: number };
  [key: string]: unknown;
}

/**
 * The full "analysis material package" assembled server-side before
 * calling Gemini. Today `fundamentals` and `analystRatings` are always
 * null (no such data source is wired up) — this is intentional and is
 * exactly what `dataLimitations` in AnalysisResult communicates to the
 * end user. The shape is defined now so that plugging in a real
 * fundamentals/ratings provider later only requires filling these two
 * fields; no analysis-logic rewrite needed.
 */
export interface AnalysisContext {
  quote: StockQuote;
  technicals: TechnicalIndicators;
  fundamentals: FundamentalsData | null;
  analystRatings: AnalystRatingsData | null;
  /** BCP-47-ish locale string (e.g. "zh-TW", "en-US") the output text
   *  should be written in. */
  locale: string;
}

/**
 * The structured AI analysis result returned by api/analyze.ts (Gemini
 * path) and lib/simulatedAnalysis.ts (offline/fallback path) — both
 * MUST return exactly this shape so the frontend never has to branch on
 * which path produced the data.
 */
export interface AnalysisResult {
  symbol: string;
  companyName: string;
  lastAnalyzed: string;

  // --- Core conclusion ---
  recommendation: 'BUY' | 'HOLD' | 'SELL' | 'NEUTRAL';
  /** One-sentence reason for the recommendation. */
  recommendationReason: string;
  /** Overall confidence in this analysis. Capped at "medium" whenever
   *  fundamentals/analystRatings are unavailable — see deriveConfidence()
   *  in lib/technicalIndicators.ts, which is the single source of truth
   *  for this value (the server always overrides whatever the LLM says
   *  here, to guarantee the cap is actually enforced). */
  confidenceLevel: ConfidenceLevel;
  /** Explicit list of analysis dimensions that are limited/unavailable
   *  given the current Yahoo-only data source (e.g. "no financial
   *  statement data"). Always non-empty today. This is the core
   *  anti-fabrication mechanism: rather than trusting prompt wording
   *  alone, the app forces a structured admission of data gaps. */
  dataLimitations: string[];

  // --- Structured analysis blocks (Longbridge-framework-inspired) ---
  technicalSummary: TechnicalSummary;
  valuation: ValuationSummary;
  /** Bullish and bearish catalysts in one tagged array (replaces the old
   *  flat `catalysts: string[]`). */
  catalysts: Catalyst[];
  /** Risk warnings (new — mirrors the "bear case" side that the old
   *  AIAnalysisResult didn't have a dedicated field for). */
  risks: string[];

  // --- Narrative / qualitative fields (kept for continuity with the
  //     existing frontend panel) ---
  summary: string;
  outlook: string;
  oneSentenceSummary: string;
  companyBackground: string;
  top3RevenueSegment: string[];
  competitors: string[];
  advantages: string[];

  // --- News & citations (kept from the existing grounded-search flow) ---
  recentNews: AnalysisNewsItem[];
  sources: AnalysisSourceRef[];
}
