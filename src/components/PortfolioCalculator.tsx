import { StockQuote } from "../types";

interface PortfolioCalculatorProps {
  stocks: StockQuote[];
}

export function PortfolioCalculator({ stocks }: PortfolioCalculatorProps) {
  // 安全计算持仓或总价
  const totalValue = (stocks || []).reduce((acc, stock) => {
    const price = stock?.price ?? 0;
    return acc + price;
  }, 0);

  return (
    <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Portfolio Overview</h3>
      <div className="flex items-baseline justify-between">
        <span className="text-slate-600 text-sm font-medium">Tracked Assets Sum:</span>
        <span className="text-2xl font-extrabold text-slate-900">${totalValue.toFixed(2)}</span>
      </div>
    </div>
  );
}
