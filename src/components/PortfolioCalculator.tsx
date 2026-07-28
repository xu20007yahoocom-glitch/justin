import React, { useState, useEffect } from "react";
import { Briefcase, Plus, Minus, RefreshCw, Trash2, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { StockQuote, PortfolioItem } from "../types";

interface PortfolioCalculatorProps {
  stocks: StockQuote[];
}

export const PortfolioCalculator: React.FC<PortfolioCalculatorProps> = ({ stocks }) => {
  // Load portfolio from localStorage
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>(() => {
    const saved = localStorage.getItem("stock_tracker_portfolio");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    // Default initial empty portfolio
    return [
      { symbol: "UGI", shares: 100, avgCost: 24.10 },
      { symbol: "LNG", shares: 15, avgCost: 175.50 },
      { symbol: "DXCM", shares: 25, avgCost: 85.00 },
      { symbol: "PTEN", shares: 200, avgCost: 10.50 }
    ];
  });

  const [editSymbol, setEditSymbol] = useState<string>("UGI");
  const [operationMode, setOperationMode] = useState<"buy" | "sell" | "adjust">("buy");
  const [inputShares, setInputShares] = useState<string>("");
  const [inputCost, setInputCost] = useState<string>("");
  const [inputStopLoss, setInputStopLoss] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load realized profit/loss from localStorage
  const [realizedPL, setRealizedPL] = useState<number>(() => {
    const saved = localStorage.getItem("stock_tracker_realized_pl");
    return saved ? parseFloat(saved) || 0 : 0;
  });

  // Load stop loss auto trade logs
  interface TradeLog {
    id: string;
    time: string;
    symbol: string;
    shares: number;
    triggerPrice: number;
    actualPrice: number;
    type: "stop_loss";
    gainLoss: number;
  }

  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>(() => {
    const saved = localStorage.getItem("stock_tracker_trade_logs");
    try {
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Save portfolio to localStorage
  useEffect(() => {
    localStorage.setItem("stock_tracker_portfolio", JSON.stringify(portfolio));
  }, [portfolio]);

  // Save trade logs to localStorage
  useEffect(() => {
    localStorage.setItem("stock_tracker_trade_logs", JSON.stringify(tradeLogs));
  }, [tradeLogs]);

  // Set default edit fields on stock or mode change
  useEffect(() => {
    setErrorMsg(null);
    const existing = portfolio.find(item => item.symbol === editSymbol);
    const stock = stocks.find(s => s.symbol === editSymbol);
    const livePrice = stock ? stock.price : 0;

    if (operationMode === "adjust") {
      if (existing) {
        setInputShares(existing.shares.toString());
        setInputCost(existing.avgCost.toString());
        setInputStopLoss(existing.stopLossPrice ? existing.stopLossPrice.toString() : "");
      } else {
        setInputShares("");
        setInputCost(livePrice > 0 ? livePrice.toFixed(2) : "");
        setInputStopLoss("");
      }
    } else {
      // For buy or sell, default the cost to the live price of the stock, shares to empty
      setInputShares("");
      setInputCost(livePrice > 0 ? livePrice.toFixed(2) : "");
      setInputStopLoss(existing?.stopLossPrice ? existing.stopLossPrice.toString() : "");
    }
  }, [editSymbol, operationMode, portfolio, stocks]);

  // Auto Stop Loss Monitor effect
  useEffect(() => {
    if (!stocks || stocks.length === 0 || portfolio.length === 0) return;

    let portfolioChanged = false;
    const updatedPortfolio = [...portfolio];
    const newLogs: TradeLog[] = [];
    let realizedPLGain = 0;

    for (let i = updatedPortfolio.length - 1; i >= 0; i--) {
      const item = updatedPortfolio[i];
      if (item.stopLossPrice && item.stopLossPrice > 0) {
        const stock = stocks.find(s => s.symbol === item.symbol);
        if (stock && stock.price <= item.stopLossPrice) {
          // Trigger stop-loss!
          const gain = item.shares * (stock.price - item.avgCost);
          realizedPLGain += gain;

          const log: TradeLog = {
            id: Math.random().toString(36).substring(2, 9),
            time: new Date().toLocaleString(),
            symbol: item.symbol,
            shares: item.shares,
            triggerPrice: item.stopLossPrice,
            actualPrice: stock.price,
            type: "stop_loss",
            gainLoss: gain
          };
          newLogs.push(log);
          
          // Remove from portfolio
          updatedPortfolio.splice(i, 1);
          portfolioChanged = true;
        }
      }
    }

    if (portfolioChanged) {
      setPortfolio(updatedPortfolio);
      if (realizedPLGain !== 0) {
        setRealizedPL(prev => {
          const newVal = prev + realizedPLGain;
          localStorage.setItem("stock_tracker_realized_pl", newVal.toString());
          return newVal;
        });
      }
      setTradeLogs(prev => [...newLogs, ...prev]);
    }
  }, [stocks, portfolio]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const sharesNum = parseFloat(inputShares);
    const costNum = parseFloat(inputCost);
    const stopLossNum = inputStopLoss ? parseFloat(inputStopLoss) : undefined;

    if (isNaN(sharesNum) || isNaN(costNum) || sharesNum <= 0 || costNum <= 0) {
      setErrorMsg("请输入大于 0 的有效股数和价格");
      return;
    }

    if (stopLossNum !== undefined && (isNaN(stopLossNum) || stopLossNum <= 0)) {
      setErrorMsg("请输入大于 0 的有效止损价格");
      return;
    }

    const existing = portfolio.find(item => item.symbol === editSymbol);

    if (operationMode === "adjust") {
      setPortfolio(prev => {
        const idx = prev.findIndex(item => item.symbol === editSymbol);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { 
            symbol: editSymbol, 
            shares: sharesNum, 
            avgCost: costNum,
            stopLossPrice: stopLossNum
          };
          return updated;
        } else {
          return [...prev, { 
            symbol: editSymbol, 
            shares: sharesNum, 
            avgCost: costNum,
            stopLossPrice: stopLossNum
          }];
        }
      });
      setInputShares("");
    } else if (operationMode === "buy") {
      setPortfolio(prev => {
        const idx = prev.findIndex(item => item.symbol === editSymbol);
        if (idx !== -1) {
          const updated = [...prev];
          const oldItem = updated[idx];
          const totalNewShares = oldItem.shares + sharesNum;
          const totalNewCost = (oldItem.shares * oldItem.avgCost + sharesNum * costNum) / totalNewShares;
          updated[idx] = { 
            symbol: editSymbol, 
            shares: parseFloat(totalNewShares.toFixed(4)), 
            avgCost: parseFloat(totalNewCost.toFixed(4)),
            stopLossPrice: stopLossNum !== undefined ? stopLossNum : oldItem.stopLossPrice
          };
          return updated;
        } else {
          return [...prev, { 
            symbol: editSymbol, 
            shares: sharesNum, 
            avgCost: costNum,
            stopLossPrice: stopLossNum
          }];
        }
      });
      setInputShares("");
    } else if (operationMode === "sell") {
      if (!existing) {
        setErrorMsg(`您当前未持有 ${editSymbol}`);
        return;
      }
      if (sharesNum > existing.shares) {
        setErrorMsg(`卖出股数超过持股上限 (当前持有: ${existing.shares} 股)`);
        return;
      }

      // Realized gain/loss: shares sold * (selling price - average buy cost)
      const gain = sharesNum * (costNum - existing.avgCost);
      setRealizedPL(prev => {
        const newVal = prev + gain;
        localStorage.setItem("stock_tracker_realized_pl", newVal.toString());
        return newVal;
      });

      setPortfolio(prev => {
        const idx = prev.findIndex(item => item.symbol === editSymbol);
        if (idx !== -1) {
          const updated = [...prev];
          const remainingShares = existing.shares - sharesNum;
          if (remainingShares <= 0.0001) {
            // Remove from portfolio if sold everything or near zero
            updated.splice(idx, 1);
          } else {
            updated[idx] = { 
              symbol: editSymbol, 
              shares: parseFloat(remainingShares.toFixed(4)), 
              avgCost: existing.avgCost,
              stopLossPrice: existing.stopLossPrice
            };
          }
          return updated;
        }
        return prev;
      });
      setInputShares("");
    }
  };

  const handleReset = (symbol: string) => {
    setPortfolio(prev => prev.filter(item => item.symbol !== symbol));
  };

  // Calculate portfolio totals
  let totalCost = 0;
  let totalCurrentValue = 0;
  let dailyChange = 0;

  const itemsWithValues = portfolio.map(item => {
    const stock = stocks.find(s => s.symbol === item.symbol);
    const livePrice = stock ? stock.price : item.avgCost;
    const stockChangePercent = stock ? stock.changePercent : 0;
    const stockChange = stock ? stock.change : 0;

    const value = item.shares * livePrice;
    const cost = item.shares * item.avgCost;
    const gainLoss = value - cost;
    const gainLossPercent = cost > 0 ? (gainLoss / cost) * 100 : 0;
    const todayChange = item.shares * stockChange;

    totalCost += cost;
    totalCurrentValue += value;
    dailyChange += todayChange;

    return {
      ...item,
      companyName: stock?.companyName || item.symbol,
      livePrice,
      value,
      cost,
      gainLoss,
      gainLossPercent,
      todayChange
    };
  });

  const overallGainLoss = totalCurrentValue - totalCost;
  const overallGainLossPercent = totalCost > 0 ? (overallGainLoss / totalCost) * 100 : 0;
  const dailyChangePercent = totalCurrentValue > 0 ? (dailyChange / (totalCurrentValue - dailyChange)) * 100 : 0;

  // Pie chart data
  const pieData = itemsWithValues
    .filter(item => item.value > 0)
    .map(item => ({
      name: item.symbol,
      value: parseFloat(item.value.toFixed(2))
    }));

  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

  return (
    <div id="portfolio-calculator-section" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Column 1: Portfolio Summary Stats */}
      <div className="flex flex-col justify-between space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-slate-700" />
            我的投资持仓组合
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            实时模拟与分析您的 {stocks.length > 0 ? stocks.map(s => s.symbol).join("、") : "UGI、LNG、DXCM、PTEN"} 股票持仓与模拟买卖表现。
          </p>
        </div>

        {/* Big Balance */}
        <div className="my-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">当前持仓总市值</span>
          <div className="text-4xl font-extrabold text-slate-900 font-sans tracking-tight mt-1">
            ${totalCurrentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-2 border-t border-slate-50">
            <div className={`flex items-center text-xs font-semibold ${overallGainLoss >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {overallGainLoss >= 0 ? <TrendingUp className="w-3.5 h-3.5 mr-1" /> : <TrendingDown className="w-3.5 h-3.5 mr-1" />}
              <span>账面浮盈: {overallGainLoss >= 0 ? "+" : ""}{overallGainLoss.toFixed(2)} ({overallGainLossPercent.toFixed(2)}%)</span>
            </div>
            <div className={`flex items-center text-xs font-semibold ${dailyChange >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              <span>今日盈亏: {dailyChange >= 0 ? "+" : ""}{dailyChange.toFixed(2)} ({dailyChangePercent.toFixed(2)}%)</span>
            </div>
            <div className={`flex items-center text-xs font-semibold ${realizedPL >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              <span>已实现盈亏: {realizedPL >= 0 ? "+" : ""}{realizedPL.toFixed(2)}</span>
              {realizedPL !== 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setRealizedPL(0);
                    localStorage.removeItem("stock_tracker_realized_pl");
                  }}
                  className="ml-1 text-[10px] text-slate-400 hover:text-rose-600 hover:underline cursor-pointer font-normal"
                  title="重置已实现盈亏"
                >
                  (清零)
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick Summary list */}
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <div className="flex justify-between text-xs font-medium text-slate-500">
            <span>当前持仓成本</span>
            <span className="font-mono text-slate-700">${totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-xs font-medium text-slate-500">
            <span>配置股票品种数</span>
            <span className="font-mono text-slate-700">{portfolio.length} / {stocks.length || 4}</span>
          </div>
        </div>
      </div>

      {/* Column 2: Allocation Chart & Holding Items */}
      <div className="flex flex-col justify-center border-t lg:border-t-0 lg:border-x border-slate-100 lg:px-6 py-4 lg:py-0">
        {pieData.length > 0 ? (
          <div className="h-56 flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => `$${value}`} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute flex flex-col items-center">
              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">资产配置</span>
              <span className="text-sm font-bold text-slate-800">分配比率</span>
            </div>
          </div>
        ) : (
          <div className="h-56 flex flex-col items-center justify-center text-slate-300">
            <Briefcase className="w-10 h-10 stroke-1 mb-2" />
            <span className="text-xs">暂无持仓模拟数据</span>
          </div>
        )}

        {/* Custom Legend */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2">
          {pieData.map((item, index) => {
            const pct = totalCurrentValue > 0 ? (item.value / totalCurrentValue) * 100 : 0;
            return (
              <div key={item.name} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                <span className="font-bold text-slate-700">{item.name}</span>
                <span className="text-slate-400 font-mono">({pct.toFixed(0)}%)</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Column 3: Edit holdings form & Details */}
      <div className="flex flex-col justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5">
            <Briefcase className="w-4 h-4 text-slate-500" />
            持仓与交易模拟
          </h3>

          {/* Segmented control for operationMode */}
          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold mb-3">
            <button
              type="button"
              onClick={() => setOperationMode("buy")}
              className={`py-1.5 px-2 rounded-lg transition-all cursor-pointer text-center ${
                operationMode === "buy"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              模拟买入
            </button>
            <button
              type="button"
              onClick={() => setOperationMode("sell")}
              className={`py-1.5 px-2 rounded-lg transition-all cursor-pointer text-center ${
                operationMode === "sell"
                  ? "bg-white text-rose-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              模拟卖出
            </button>
            <button
              type="button"
              onClick={() => setOperationMode("adjust")}
              className={`py-1.5 px-2 rounded-lg transition-all cursor-pointer text-center ${
                operationMode === "adjust"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              直接调整
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label htmlFor="select-asset" className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">选择股票代码</label>
              <select
                id="select-asset"
                value={editSymbol}
                onChange={(e) => setEditSymbol(e.target.value)}
                className="w-full text-xs font-semibold p-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 outline-none focus:border-slate-400 transition-colors"
              >
                {stocks.map(s => (
                  <option key={s.symbol} value={s.symbol}>{s.symbol} - {s.companyName}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="input-shares" className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    {operationMode === "buy" ? "买入股数" : operationMode === "sell" ? "卖出股数" : "持股数量"}
                  </label>
                  {operationMode === "sell" && (() => {
                    const existing = portfolio.find(item => item.symbol === editSymbol);
                    return existing && existing.shares > 0 ? (
                      <button
                        type="button"
                        onClick={() => setInputShares(existing.shares.toString())}
                        className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                      >
                        最大({existing.shares})
                      </button>
                    ) : null;
                  })()}
                </div>
                <input
                  id="input-shares"
                  type="number"
                  step="any"
                  placeholder="股数"
                  value={inputShares}
                  onChange={(e) => setInputShares(e.target.value)}
                  className="w-full text-xs p-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 outline-none focus:border-slate-400 transition-colors font-mono"
                />
              </div>
              <div>
                <label htmlFor="input-cost" className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  {operationMode === "buy" ? "买入价格 ($)" : operationMode === "sell" ? "卖出价格 ($)" : "均价/成本 ($)"}
                </label>
                <input
                  id="input-cost"
                  type="number"
                  step="any"
                  placeholder="价格"
                  value={inputCost}
                  onChange={(e) => setInputCost(e.target.value)}
                  className="w-full text-xs p-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 outline-none focus:border-slate-400 transition-colors font-mono"
                />
              </div>
            </div>

            {operationMode !== "sell" && (
              <div>
                <label htmlFor="input-stop-loss" className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  自动止损卖出价 ($) <span className="text-[10px] text-slate-400 font-normal">(可选，跌破此价自动全仓卖出)</span>
                </label>
                <div className="relative">
                  <input
                    id="input-stop-loss"
                    type="number"
                    step="any"
                    placeholder="不设置止损价格"
                    value={inputStopLoss}
                    onChange={(e) => setInputStopLoss(e.target.value)}
                    className="w-full text-xs p-2 pr-12 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 outline-none focus:border-slate-400 transition-colors font-mono"
                  />
                  {inputStopLoss && (
                    <button
                      type="button"
                      onClick={() => setInputStopLoss("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      清空
                    </button>
                  )}
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="p-2 text-[10px] font-bold bg-rose-50 border border-rose-100 text-rose-700 rounded-xl leading-snug">
                ⚠️ {errorMsg}
              </div>
            )}

            <button
              id="btn-save-portfolio"
              type="submit"
              className={`w-full mt-2 py-2 px-4 rounded-xl text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                operationMode === "buy"
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : operationMode === "sell"
                  ? "bg-rose-600 hover:bg-rose-500"
                  : "bg-slate-950 hover:bg-slate-800"
              }`}
            >
              <span>
                {operationMode === "buy"
                  ? "确认买入"
                  : operationMode === "sell"
                  ? "确认卖出"
                  : "更新持仓"}
              </span>
            </button>
          </form>
          
          <p className="text-[10px] text-slate-400 mt-2 leading-relaxed bg-slate-50/50 p-2 rounded-lg border border-slate-100/50">
            💡 {operationMode === "buy" && "加权成本: 买入将采用公式自动计算出您的最新加权买入均价成本。"}
            {operationMode === "sell" && "卖出损益: 卖出减少持股数量，且差额会计入您的「已实现盈亏」账户中。"}
            {operationMode === "adjust" && "直接覆盖: 此模式不记录交易变动，直接强行更新特定股票的总持有数据。"}
          </p>
        </div>

        {/* Existing portfolio items listing */}
        {portfolio.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              已保存的持仓列表 <span className="text-[9px] text-slate-400 font-normal normal-case">(点击行可快捷调整或配置止损)</span>
            </h4>
            <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
              {itemsWithValues.map(item => (
                <div 
                  key={item.symbol} 
                  onClick={() => {
                    setEditSymbol(item.symbol);
                    setOperationMode("adjust");
                  }}
                  className="flex items-center justify-between text-xs bg-slate-50 hover:bg-slate-100/80 p-2 rounded-xl border border-slate-100 transition-all cursor-pointer group"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-700 font-mono group-hover:text-blue-600 transition-colors">{item.symbol}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{item.shares} 股 @ ${item.avgCost.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      {item.stopLossPrice && item.stopLossPrice > 0 ? (
                        <span className="text-rose-600 font-semibold bg-rose-50 px-1 rounded flex items-center gap-0.5 border border-rose-100/50">
                          🛑 止损触发价: ${item.stopLossPrice.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-400 bg-slate-100/50 px-1 rounded flex items-center gap-0.5">
                          🔓 未设止损
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className={`font-mono font-bold ${item.gainLoss >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {item.gainLoss >= 0 ? "+" : ""}{item.gainLoss.toFixed(2)}
                    </span>
                    <button
                      id={`btn-delete-${item.symbol}`}
                      type="button"
                      onClick={() => handleReset(item.symbol)}
                      className="text-slate-400 hover:text-rose-600 p-0.5 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Auto Stop Loss Logs Section at the bottom */}
      {tradeLogs.length > 0 && (
        <div className="col-span-1 lg:col-span-3 border-t border-slate-100 pt-6 mt-2">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              自动止损触发日志
            </h4>
            <button
              type="button"
              onClick={() => {
                setTradeLogs([]);
                localStorage.removeItem("stock_tracker_trade_logs");
              }}
              className="text-[10px] text-slate-400 hover:text-rose-600 transition-colors hover:underline cursor-pointer"
            >
              清空日志
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-36 overflow-y-auto pr-1">
            {tradeLogs.map(log => (
              <div key={log.id} className="flex items-center justify-between p-2.5 bg-rose-50/50 hover:bg-rose-50 border border-rose-100/50 rounded-xl text-xs transition-colors">
                <div className="flex items-center gap-2">
                  <span className="bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded text-[10px] font-mono">自动止损</span>
                  <div>
                    <span className="font-bold text-slate-800 font-mono">{log.symbol}</span>
                    <span className="text-slate-500 text-[10px] ml-1.5">跌破止损价 ${log.triggerPrice.toFixed(2)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-slate-700 font-mono">以 ${log.actualPrice.toFixed(2)} 自动卖出 {log.shares} 股</div>
                  <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1.5">
                    <span>{log.time}</span>
                    <span className={`font-mono font-semibold ${log.gainLoss >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      (实现损益: {log.gainLoss >= 0 ? "+" : ""}{log.gainLoss.toFixed(2)})
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
