/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { Sparkles, RefreshCw, AlertTriangle, Play, Pause, Clock } from "lucide-react";
import { StockQuote, AIAnalysisResult } from "./types";
import { StockCard } from "./components/StockCard";
import { StockChart } from "./components/StockChart";
import { PortfolioCalculator } from "./components/PortfolioCalculator";
import { AIAnalystPanel } from "./components/AIAnalystPanel";
import { WhatsAppNotifications } from "./components/WhatsAppNotifications";

export default function App() {
  const [stocks, setStocks] = useState<StockQuote[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("UGI");
  const [selectedRange, setSelectedRange] = useState<string>("1m");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Auto-refresh configuration
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [countdown, setCountdown] = useState<number>(30);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Analyses map
  const [analyses, setAnalyses] = useState<Record<string, AIAnalysisResult | null>>({
    UGI: null,
    LNG: null,
    DXCM: null,
    PTEN: null
  });
  const [isAnalyzingMap, setIsAnalyzingMap] = useState<Record<string, boolean>>({
    UGI: false,
    LNG: false,
    DXCM: false,
    PTEN: false
  });

  // Fetch stocks function with Safety Sanitize
  const fetchStocks = async (range: string, isSilent: boolean = false) => {
    if (!isSilent) setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/stocks?range=${range}`);
      if (!response.ok) {
        throw new Error(`Failed to load stock data: ${response.statusText}`);
      }
      const data: StockQuote[] = await response.json();
      
      // 🛡️ 防崩溃的核心：对 API 返回的所有字段强行清洗兜底
      const sanitizedData = (Array.isArray(data) ? data : []).map(item => ({
        ...item,
        price: Number(item?.price) || 0,
        change: Number(item?.change) || 0,
        changePercent: Number(item?.changePercent) || 0,
        high: Number(item?.high) || 0,
        low: Number(item?.low) || 0,
        open: Number(item?.open) || 0,
        previousClose: Number(item?.previousClose) || 0,
      }));

      setStocks(sanitizedData);
      setCountdown(30);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred while fetching prices.");
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  };

  // Run AI analysis
  const runAnalysis = async (symbol: string) => {
    setIsAnalyzingMap(prev => ({ ...prev, [symbol]: true }));
    try {
      const response = await fetch("/api/stocks/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      if (!response.ok) {
        throw new Error(`Failed to analyze stock: ${response.statusText}`);
      }
      const data: AIAnalysisResult = await response.json();
      setAnalyses(prev => ({ ...prev, [symbol]: data }));
    } catch (err: any) {
      console.error(err);
      alert(`AI Analysis failed for ${symbol}: ${err.message}`);
    } finally {
      setIsAnalyzingMap(prev => ({ ...prev, [symbol]: false }));
    }
  };

  useEffect(() => {
    fetchStocks(selectedRange);
  }, [selectedRange]);

  useEffect(() => {
    if (!autoRefresh) {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      return;
    }

    countdownTimerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchStocks(selectedRange, true);
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [autoRefresh, selectedRange]);

  const activeStock = stocks.find(s => s.symbol === selectedSymbol);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-16 font-sans">
      {/* Top Banner */}
      <header id="main-header" className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-slate-200 py-4 px-6 md:px-12 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-sm shadow-md">
            S
          </div>
          <div>
            <h1 className="text-md font-extrabold tracking-tight text-slate-900 flex items-center gap-1.5">
              Stock Price Tracker
            </h1>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Auto-Scraping Hub</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 font-semibold bg-slate-100/80 px-3 py-1.5 rounded-full border border-slate-200/50">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Auto Refresh: {autoRefresh ? `${countdown}s` : "PAUSED"}</span>
            <button
              id="btn-toggle-auto-refresh"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="text-slate-400 hover:text-slate-900 p-0.5 rounded transition-colors cursor-pointer"
            >
              {autoRefresh ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </button>
          </div>

          <button
            id="btn-manual-refresh"
            onClick={() => fetchStocks(selectedRange)}
            disabled={isLoading}
            className="p-2 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 shadow-sm transition-all flex items-center justify-center disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 space-y-8">
        {error && (
          <div id="error-banner" className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-500" />
            <div className="text-xs font-semibold">
              <p>{error}</p>
              <button
                onClick={() => fetchStocks(selectedRange)}
                className="mt-1 text-rose-900 underline hover:text-rose-950 block"
              >
                Retry Request
              </button>
            </div>
          </div>
        )}

        {/* Ticker Cards */}
        {isLoading && stocks.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white border border-slate-100 p-6 rounded-2xl h-44 animate-pulse space-y-4">
                <div className="h-4 bg-slate-200 rounded w-1/4" />
                <div className="h-8 bg-slate-200 rounded w-1/2" />
                <div className="h-10 bg-slate-200 rounded w-full" />
              </div>
            ))}
          </div>
        ) : (
          <section id="stock-tickers" className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {stocks.map(stock => (
              <StockCard
                key={stock.symbol}
                stock={stock}
                isSelected={selectedSymbol === stock.symbol}
                onSelect={() => setSelectedSymbol(stock.symbol)}
                onAnalyze={() => runAnalysis(stock.symbol)}
                isAnalyzing={isAnalyzingMap[stock.symbol]}
              />
            ))}
          </section>
        )}

        {/* Visualizations */}
        <section id="dashboard-chart" className="w-full">
          {isLoading && stocks.length === 0 ? (
            <div className="bg-white border border-slate-100 p-6 rounded-2xl h-[420px] animate-pulse" />
          ) : (
            <StockChart
              stocks={stocks}
              selectedSymbol={selectedSymbol}
              selectedRange={selectedRange}
              onRangeChange={(range) => setSelectedRange(range)}
            />
          )}
        </section>

        <section id="dashboard-portfolio" className="w-full">
          {isLoading && stocks.length === 0 ? (
            <div className="bg-white border border-slate-100 p-6 rounded-2xl h-[280px] animate-pulse" />
          ) : (
            <PortfolioCalculator stocks={stocks} />
          )}
        </section>

        <section id="whatsapp-notifications" className="grid grid-cols-1 gap-8">
          <WhatsAppNotifications stocks={stocks} />
        </section>

        <section id="analyst-report" className="grid grid-cols-1 gap-8">
          {activeStock && (
            <AIAnalystPanel
              symbol={activeStock.symbol}
              companyName={activeStock.companyName}
              analysis={analyses[activeStock.symbol]}
              onAnalyze={() => runAnalysis(activeStock.symbol)}
              isAnalyzing={isAnalyzingMap[activeStock.symbol]}
            />
          )}
        </section>
      </main>
    </div>
  );
}
