@@
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
 
@@
 export interface AnalystRatingsData {
   averageRating?: string;
   priceTarget?: number;
   numAnalysts?: number;
   distribution?: { buy?: number; hold?: number; sell?: number };
   [key: string]: unknown;
 }
+
+/** Company profile metadata fetched from providers like Finnhub. */
+export interface CompanyProfile {
+  name?: string | null;
+  industry?: string | null;
+  exchange?: string | null;
+  ipoDate?: string | null;
+  marketCap?: number | null;
+  website?: string | null;
+  [key: string]: unknown;
+}
@@
 export interface AnalysisContext {
   quote: StockQuote;
   technicals: TechnicalIndicators;
   fundamentals: FundamentalsData | null;
   analystRatings: AnalystRatingsData | null;
+  profile?: CompanyProfile | null;
+  recentNews?: AnalysisNewsItem[] | null;
   /** BCP-47-ish locale string (e.g. "zh-TW", "en-US") the output text
    *  should be written in. */
   locale: string;
 }
*** End Patch
