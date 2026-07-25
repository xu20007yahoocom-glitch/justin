import { StockQuote } from "../types";
import { Sparkles, TrendingUp, TrendingDown } from "lucide-react";

interface StockCardProps {
  stock: StockQuote;
  isSelected: boolean;
  onSelect: () => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

export function StockCard({ stock, isSelected, onSelect, onAnalyze, isAnalyzing }: StockCardProps) {
  // 安全获取数值，防止 undefined / null 导致 .toFixed 崩溃
  const price = stock?.price ?? 0;
  const change = stock?.change ?? 0;
  const changePercent = stock?.changePercent ?? 0;
  const isPositive = change >= 0;

  return (
    <div
      onClick={onSelect}
      className={`p-5 rounded-2xl border transition-all cursor-pointer bg-white shadow-sm hover:shadow-md ${
        isSelected ? "border-indigo-600 ring-2 ring-indigo-600/10" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{stock?.symbol || "--"}</h3>
          <p className="text-xs text-slate-500 font-medium truncate max-w-[150px]">{stock?.companyName || "Unknown"}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAnalyze();
          }}
          disabled={isAnalyzing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50"
        >
          <Sparkles className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin" : ""}`} />
          {isAnalyzing ? "Analyzing..." : "AI Report"}
        </button>
      </div>

      <div className="flex items-baseline justify-between mt-2">
        <span className="text-2xl font-black text-slate-900">${price.toFixed(2)}</span>
        <div className={`flex items-center gap-1 text-xs font-bold ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
          {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          <span>
            {isPositive ? "+" : ""}
            {change.toFixed(2)} ({isPositive ? "+" : ""}
            {changePercent.toFixed(2)}%)
          </span>
        </div>
      </div>
    </div>
  );
}
