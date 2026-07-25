import React, { useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { LineChart as ChartIcon, Percent, Calendar } from "lucide-react";
import { StockQuote } from "../types";

interface StockChartProps {
  stocks: StockQuote[];
  selectedSymbol: string;
  selectedRange: string;
  onRangeChange: (range: string) => void;
}

export const StockChart: React.FC<StockChartProps> = ({
  stocks,
  selectedSymbol,
  selectedRange,
  onRangeChange
}) => {
  const [compareMode, setCompareMode] = useState<boolean>(false);
  
  const activeStock = stocks.find(s => s.symbol === selectedSymbol) || stocks[0];
  if (!activeStock) return null;

  const ranges = [
    { label: "1D", value: "1d" },
    { label: "5D", value: "5d" },
    { label: "1M", value: "1m" },
    { label: "6M", value: "6m" },
    { label: "1Y", value: "1y" }
  ];

  // Helper to build normalized comparison data
  // We align all stocks by their date indexes and normalize prices to % change from the start of the timeframe.
  const buildComparisonData = () => {
    if (stocks.length === 0) return [];
    
    // Find the stock with the longest history as base dates, or use UGI
    const baseStock = stocks.find(s => s.symbol === "UGI") || stocks[0];
    const baseHistory = baseStock.history;

    return baseHistory.map((point, index) => {
      const dataPoint: Record<string, any> = { date: point.date };
      
      stocks.forEach(stock => {
        const historyPoint = stock.history[index] || stock.history[stock.history.length - 1];
        if (historyPoint && stock.history.length > 0) {
          const startPrice = stock.history[0].price;
          const currentPrice = historyPoint.price;
          const pctChange = ((currentPrice - startPrice) / startPrice) * 100;
          dataPoint[stock.symbol] = parseFloat(pctChange.toFixed(2));
          dataPoint[`${stock.symbol}_price`] = currentPrice;
        } else {
          dataPoint[stock.symbol] = 0;
        }
      });
      
      return dataPoint;
    });
  };

  const comparisonData = buildComparisonData();

  // Custom tooltip for single chart
  const CustomSingleTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 text-white p-3 rounded-xl border border-slate-800 shadow-xl font-sans text-xs">
          <div className="text-slate-400 font-medium mb-1">{payload[0].payload.date}</div>
          <div className="text-sm font-bold text-slate-100">
            Price: <span className="font-mono">${payload[0].value.toFixed(2)}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  // Custom tooltip for comparison chart
  const CustomCompareTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 text-white p-3 rounded-xl border border-slate-800 shadow-xl font-sans text-xs max-w-xs">
          <div className="text-slate-400 font-medium mb-2">{payload[0].payload.date}</div>
          <div className="space-y-1.5">
            {payload.map((entry: any) => {
              const sym = entry.dataKey;
              const price = entry.payload[`${sym}_price`]?.toFixed(2) || "N/A";
              return (
                <div key={sym} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.stroke }} />
                    <span className="font-bold">{sym}:</span>
                  </div>
                  <div className="font-mono text-right">
                    <span>${price} </span>
                    <span className={entry.value >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      ({entry.value >= 0 ? "+" : ""}{entry.value}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div id="stock-chart-section" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[420px]">
      {/* Chart controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ChartIcon className="w-5 h-5 text-slate-700" />
            {compareMode ? "Portfolio Market Comparison" : `${activeStock.companyName} (${activeStock.symbol})`}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {compareMode ? "Performance normalized to percentage growth starting from interval open" : "Historical price tracking and movement indices"}
          </p>
        </div>

        {/* Buttons & Toggles */}
        <div className="flex items-center gap-3">
          {/* Compare toggle */}
          <button
            id="btn-toggle-compare"
            onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              compareMode
                ? "bg-slate-900 border-slate-900 text-white shadow-sm"
                : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
            }`}
          >
            <Percent className="w-3.5 h-3.5" />
            <span>Compare {compareMode ? "ON" : "OFF"}</span>
          </button>

          {/* Range picker */}
          <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200/50">
            {ranges.map(range => (
              <button
                key={range.value}
                id={`btn-range-${range.value}`}
                onClick={() => onRangeChange(range.value)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  selectedRange === range.value
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart container */}
      <div className="flex-1 min-h-0 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {compareMode ? (
            <LineChart data={comparisonData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                stroke="#94a3b8"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => `${val > 0 ? "+" : ""}${val}%`}
              />
              <Tooltip content={<CustomCompareTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }} />
              <Line
                type="monotone"
                dataKey="UGI"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="LNG"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="DXCM"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          ) : (
            <AreaChart data={activeStock.history} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
              <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={activeStock.change >= 0 ? "#10b981" : "#f43f5e"} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={activeStock.change >= 0 ? "#10b981" : "#f43f5e"} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                stroke="#94a3b8"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                domain={["auto", "auto"]}
                tickFormatter={(val) => `$${val}`}
              />
              <Tooltip content={<CustomSingleTooltip />} />
              <Area
                type="monotone"
                dataKey="price"
                stroke={activeStock.change >= 0 ? "#10b981" : "#f43f5e"}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorPrice)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
