import React from "react";
import { Sparkles, BrainCircuit, ExternalLink, Calendar, CheckCircle2, TrendingUp, HelpCircle, Building2, Zap, Users2, ShieldCheck, Briefcase } from "lucide-react";
import { AIAnalysisResult } from "../types";

interface AIAnalystPanelProps {
  symbol: string;
  companyName: string;
  analysis: AIAnalysisResult | null;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

export const AIAnalystPanel: React.FC<AIAnalystPanelProps> = ({
  symbol,
  companyName,
  analysis,
  onAnalyze,
  isAnalyzing
}) => {
  // Color configuration based on recommendation
  const getRecommendationStyle = (rec: AIAnalysisResult["recommendation"]) => {
    switch (rec) {
      case "BUY":
        return { bg: "bg-emerald-50 border-emerald-200 text-emerald-800", glow: "shadow-emerald-100" };
      case "HOLD":
        return { bg: "bg-amber-50 border-amber-200 text-amber-800", glow: "shadow-amber-100" };
      case "SELL":
        return { bg: "bg-rose-50 border-rose-200 text-rose-800", glow: "shadow-rose-100" };
      default:
        return { bg: "bg-slate-50 border-slate-200 text-slate-800", glow: "shadow-slate-100" };
    }
  };

  const getSentimentBadge = (sentiment: "positive" | "negative" | "neutral") => {
    switch (sentiment) {
      case "positive":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Positive</span>;
      case "negative":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Negative</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">Neutral</span>;
    }
  };

  const recStyle = analysis ? getRecommendationStyle(analysis.recommendation) : null;

  // Set up rotating expert analyst messages during generation
  const [loaderMessage, setLoaderMessage] = React.useState("Initiating market crawler...");
  React.useEffect(() => {
    if (!isAnalyzing) return;
    
    const messages = [
      "Initiating real-time stock crawler...",
      "Searching Google Finance and Wall Street journals...",
      "Scraping recent earnings transcripts and releases...",
      "Synthesizing news sentiment indicators...",
      "Formulating short-term and long-term outlook grids...",
      "Verifying search citations & sources...",
      "Generating structured analyst brief..."
    ];
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % messages.length;
      setLoaderMessage(messages[idx]);
    }, 2500);

    return () => clearInterval(interval);
  }, [isAnalyzing]);

  return (
    <div id="ai-analyst-section" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col justify-between">
      {/* Title */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-slate-900 text-white">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Gemini AI Analyst</h2>
              <p className="text-xs text-slate-400 mt-0.5">Real-time financial synthesis & news aggregator</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-700 py-1 px-2.5 rounded-full font-bold">
            <Sparkles className="w-3 h-3 text-indigo-500 animate-pulse" />
            <span>GROUNDED SEARCH</span>
          </span>
        </div>

        {/* Dynamic State display */}
        {isAnalyzing ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <div className="relative flex items-center justify-center mb-5">
              {/* Spinning Ring */}
              <div className="w-12 h-12 rounded-full border-4 border-slate-100 border-t-slate-900 animate-spin" />
              <BrainCircuit className="w-5 h-5 absolute text-slate-800 animate-pulse" />
            </div>
            <p className="text-sm font-bold text-slate-800 animate-fade-in">{loaderMessage}</p>
            <p className="text-xs text-slate-400 mt-1.5 max-w-xs">
              Gemini is searching the live web to fetch current stock prices and 2026 news articles. This takes about 5-10 seconds.
            </p>
          </div>
        ) : analysis ? (
          <div className="mt-6 space-y-6 animate-fade-in">
            {/* Recommendation & Overview block */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
              {/* Large Recommendation Rating */}
              <div className={`md:col-span-1 border rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-sm ${recStyle?.bg} ${recStyle?.glow}`}>
                <span className="text-[9px] font-extrabold uppercase tracking-widest opacity-60">Recommendation</span>
                <span className="text-2xl font-black mt-1 tracking-tight font-sans">
                  {analysis.recommendation}
                </span>
                <div className="mt-3 flex items-center gap-1 bg-white/50 backdrop-blur-sm px-2 py-0.5 rounded-full text-[10px] font-semibold">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Verified</span>
                </div>
              </div>

              {/* Summary text */}
              <div className="md:col-span-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Analyst Summary</span>
                <p className="text-sm text-slate-600 leading-relaxed font-normal">
                  {analysis.summary}
                </p>
              </div>
            </div>

            {/* Outlook details */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Market Outlook</span>
              <p className="text-xs text-slate-600 leading-relaxed">
                {analysis.outlook}
              </p>
            </div>

            {/* 一句總結 (One-sentence Summary) */}
            {analysis.oneSentenceSummary && (
              <div className="border-l-4 border-indigo-500 bg-indigo-50/30 p-3.5 rounded-r-xl">
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block mb-1">一句總結</span>
                <p className="text-xs sm:text-sm font-bold text-slate-800 leading-snug">
                  「 {analysis.oneSentenceSummary} 」
                </p>
              </div>
            )}

            {/* 公司背景 (Company Background) */}
            {analysis.companyBackground && (
              <div className="bg-white p-4 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-500" />
                  公司背景
                </span>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {analysis.companyBackground}
                </p>
              </div>
            )}

            {/* 核心營收、優勢、催化劑、對手維度 */}
            {(analysis.top3RevenueSegment || analysis.advantages || analysis.catalysts || analysis.competitors) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Top 3 營收業務 */}
                {analysis.top3RevenueSegment && analysis.top3RevenueSegment.length > 0 && (
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/80">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2.5 flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5 text-blue-500" />
                      Top 3 營收業務
                    </span>
                    <ul className="space-y-1.5">
                      {analysis.top3RevenueSegment.map((item, i) => (
                        <li key={i} className="text-xs text-slate-700 flex items-center gap-2">
                          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-blue-100 text-[10px] font-bold flex items-center justify-center text-blue-600 font-mono">
                            {i + 1}
                          </span>
                          <span className="font-medium">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 競爭優勢 / 護城河 */}
                {analysis.advantages && analysis.advantages.length > 0 && (
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/80">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2.5 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                      競爭優勢 / 護城河
                    </span>
                    <ul className="space-y-1.5">
                      {analysis.advantages.map((item, i) => (
                        <li key={i} className="text-xs text-slate-700 flex items-start gap-2">
                          <span className="text-emerald-500 mt-0.5 font-bold">✓</span>
                          <span className="font-medium">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 核心催化劑 */}
                {analysis.catalysts && analysis.catalysts.length > 0 && (
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/80">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2.5 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-500" />
                      核心催化劑
                    </span>
                    <ul className="space-y-1.5">
                      {analysis.catalysts.map((item, i) => (
                        <li key={i} className="text-xs text-slate-700 flex items-start gap-2">
                          <span className="text-amber-500 mt-0.5 font-bold">✦</span>
                          <span className="font-medium">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 主要競爭對手 */}
                {analysis.competitors && analysis.competitors.length > 0 && (
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/80">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2.5 flex items-center gap-1.5">
                      <Users2 className="w-3.5 h-3.5 text-indigo-500" />
                      主要競爭對手
                    </span>
                    <ul className="space-y-1.5">
                      {analysis.competitors.map((item, i) => (
                        <li key={i} className="text-xs text-slate-700 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                          <span className="font-medium">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* News and Bulletins */}
            {analysis.recentNews && analysis.recentNews.length > 0 && (
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-3">Recent Grounded News & Events</span>
                <div className="space-y-2">
                  {analysis.recentNews.map((news, idx) => (
                    <a
                      key={idx}
                      href={news.url || "https://finance.yahoo.com"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start justify-between p-3 border border-slate-100 hover:border-slate-200 bg-white rounded-xl transition-all hover:shadow-sm"
                    >
                      <div className="space-y-1 pr-4">
                        <h4 className="text-xs font-bold text-slate-800 group-hover:text-slate-900 group-hover:underline line-clamp-2 leading-snug">
                          {news.title}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <span className="font-semibold">{news.source}</span>
                          <span>•</span>
                          {getSentimentBadge(news.sentiment)}
                        </div>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 flex-shrink-0 mt-0.5 transition-colors" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Citations block */}
            {analysis.sources && analysis.sources.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Sources Referenced</span>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.sources.map((source, idx) => (
                    <a
                      key={idx}
                      href={source.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200/80 border border-slate-200/50 rounded-lg transition-colors cursor-pointer"
                    >
                      <span className="truncate max-w-[140px]">{source.title}</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-slate-200 rounded-2xl mt-6">
            <Sparkles className="w-8 h-8 text-slate-300 mb-2 animate-pulse" />
            <span className="text-sm font-bold text-slate-700">No report generated for {symbol}</span>
            <p className="text-xs text-slate-400 mt-1 max-w-xs px-4">
              Get an instant AI analysis briefing of {companyName}'s recent financials, targets, and live market news.
            </p>
            <button
              id={`btn-initiate-analysis-${symbol}`}
              onClick={onAnalyze}
              className="mt-4 py-2 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <BrainCircuit className="w-4 h-4" />
              <span>Generate report for {symbol}</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer info */}
      {analysis && !isAnalyzing && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100 text-[10px] text-slate-400">
          <span>Analyzed on: {analysis.lastAnalyzed}</span>
          <button
            id={`btn-reanalyze-${symbol}`}
            onClick={onAnalyze}
            className="flex items-center gap-1 text-slate-500 hover:text-slate-950 font-semibold transition-colors cursor-pointer"
          >
            <Sparkles className="w-3 h-3 text-indigo-500" />
            <span>Recrawl & Reanalyze</span>
          </button>
        </div>
      )}
    </div>
  );
};
