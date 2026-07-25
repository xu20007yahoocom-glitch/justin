import React from "react";
import { ArrowUpRight, ArrowDownRight, RefreshCw } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, YAxis } from "recharts";
import { StockQuote } from "../types";

interface StockCardProps {
  stock: StockQuote;
  isSelected: boolean;
  onSelect: () => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

export const StockCard: React.FC<StockCardProps> = ({
  stock,
  isSelected,
  onSelect,
  onAnalyze,
  isAnalyzing
}) => {
  const isPositive = stock.change >= 0;

  // Format volume for display (e.g. 1.2M)
  const formatVolume = (vol: number) => {
    if (vol >= 1000000) {
      return `${(vol / 1000000).toFixed(2)}M`;
    }
    if (vol >= 1000) {
      return `${(vol / 1000).toFixed(1)}K`;
    }
    return vol.toString();
  };

  return (
    <div
      id={`stock-card-${stock.symbol}`}
      className={`relative flex flex-col p-5 rounded-2xl border transition-all duration-300 cursor-pointer ${
        isSelected
          ? "bg-slate-50 border-slate-900 shadow-md ring-1 ring-slate-950/5"
          : "bg-white border-slate-200 hover:border-slate-400 hover:shadow-sm"
      }`}
      onClick={onSelect}
    >
      {/* Header Info */}
      <div className="flex items-start justify-between">
        <div>
          <span className="inline-block px-2 py-0.5 text-xs font-bold font-mono tracking-wider bg-slate-100 text-slate-800 rounded-md">
            {stock.symbol}
          </span>
          <h3 className="mt-1.5 text-sm font-semibold text-slate-500 truncate max-w-[150px]">
            {stock.companyName}
          </h3>
        </div>
        <div className={`flex items-center gap-0.5 px-2 py-1 rounded-full text-xs font-semibold ${
          isPositive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
        }`}>
          {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          <span>{isPositive ? "+" : ""}{stock.changePercent.toFixed(2)}%</span>
        </div>
      </div>

      {/* Pricing and Sparkline Row */}
      <div className="flex items-end justify-between mt-4">
        <div>
          <div className="text-3xl font-bold font-sans tracking-tight text-slate-900">
            ${stock.price.toFixed(2)}
          </div>
          <div className={`text-xs font-medium mt-1 ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
            {isPositive ? "+" : ""}{stock.change.toFixed(2)} (Today)
          </div>
        </div>

        {/* Small Sparkline */}
        <div className="w-24 h-12 overflow-hidden opacity-85">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stock.history}>
              <YAxis domain={["dataMin", "dataMax"]} hide />
              <Line
                type="monotone"
                dataKey="price"
                stroke={isPositive ? "#10b981" : "#f43f5e"}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Details Row */}
      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-100 text-[11px] font-mono text-slate-400">
        <div>
          <div className="text-slate-400">Open</div>
          <div className="font-semibold text-slate-700">${stock.open.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-slate-400">Range</div>
          <div className="font-semibold text-slate-700 truncate">
            ${stock.low.toFixed(1)}-${stock.high.toFixed(1)}
          </div>
        </div>
        <div>
          <div className="text-slate-400">Volume</div>
          <div className="font-semibold text-slate-700">{formatVolume(stock.volume)}</div>
        </div>
      </div>

      {/* AI Analyst Shortcut Button */}
      <div className="mt-4 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
        <span className="text-[10px] text-slate-400">
          Updated: {stock.lastUpdated.split(" ")[0]}
        </span>
        <button
          id={`btn-analyze-${stock.symbol}`}
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="flex items-center gap-1 py-1 px-2.5 rounded-lg bg-slate-900 text-[11px] font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${isAnalyzing ? "animate-spin" : ""}`} />
          <span>AI Analysis</span>
        </button>
      </div>
    </div>
  );
};
