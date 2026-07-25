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
