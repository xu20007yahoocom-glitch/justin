import React from "react";
import {
  BadgeInfo,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Landmark,
  ShieldCheck,
  Sparkles,
  Target,
  Users2,
  Zap
} from "lucide-react";
import type { AIAnalysisResult, SourcedField } from "../types.js";

interface AIAnalystPanelProps {
  symbol: string;
  companyName: string;
  analysis: AIAnalysisResult | null;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

function displayValue(value: string | number | null, fallback = "需查證"): string {
  if (value === null || value === "") return fallback;
  return typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value;
}

function SourceBadge({ field }: { field: SourcedField<unknown> }) {
  const isApi = field.dataConfidence === "API 實測" && field.value !== null;
  const source = field.source === "Finnhub Revenue Breakdown"
    ? "來源：Finnhub"
    : field.source === "Finnhub Profile2" || field.source === "Finnhub Metric" || field.source === "Finnhub Financials Reported"
      ? `來源：${field.source.replace("Finnhub ", "Finnhub ")}`
      : isApi
        ? `來源：${field.source}`
        : "AI 綜合判斷，非即時財報數據";

  return (
    <span
      title={field.unavailableReason ?? source}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${
        isApi
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {isApi ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <BadgeInfo className="h-3 w-3 shrink-0" />}
      <span className="truncate">{source}</span>
    </span>
  );
}

function SourcedText({ field, className = "" }: { field: SourcedField<string>; className?: string }) {
  return (
    <div className={className}>
      <p className="text-sm leading-relaxed text-slate-700">{displayValue(field.value)}</p>
      <div className="mt-1.5"><SourceBadge field={field} /></div>
    </div>
  );
}

function MetricCard({ label, field, suffix = "" }: { label: string; field: SourcedField<number>; suffix?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-800">{displayValue(field.value)}{field.value !== null ? suffix : ""}</p>
      <div className="mt-1.5"><SourceBadge field={field} /></div>
    </div>
  );
}

function BackgroundFact({ label, field }: { label: string; field: SourcedField<string | number> }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold text-slate-700">{displayValue(field.value)}</p>
      <div className="mt-1"><SourceBadge field={field} /></div>
    </div>
  );
}

export const AIAnalystPanel: React.FC<AIAnalystPanelProps> = ({
  symbol,
  companyName,
  analysis,
  onAnalyze,
  isAnalyzing
}) => {
  const [loaderMessage, setLoaderMessage] = React.useState("正在組合真實行情與基本面資料…");

  React.useEffect(() => {
    if (!isAnalyzing) return;
    const messages = [
      "正在讀取 Yahoo 即時行情與歷史價格…",
      "正在檢查 Finnhub 美股基本面資料…",
      "正在對齊財報期間與營收拆分…",
      "正在套用反捏造規則產生結構化分析…",
      "正在標記每個欄位的資料來源與信心…"
    ];
    let index = 0;
    const interval = window.setInterval(() => {
      index = (index + 1) % messages.length;
      setLoaderMessage(messages[index]);
    }, 2200);
    return () => window.clearInterval(interval);
  }, [isAnalyzing]);

  return (
    <section id="ai-analyst-section" className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-slate-900 p-1.5 text-white"><BrainCircuit className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">AI 分析面板</h2>
            <p className="mt-0.5 text-xs text-slate-400">API 事實優先；AI 僅補足無資料內容並標示信心</p>
          </div>
        </div>
        {analysis && (
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${
            analysis.marketScope === "US" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700"
          }`}>
            {analysis.marketScope === "US" ? "US 基本面路由" : "非即時財報研究路由"}
          </span>
        )}
      </header>

      {isAnalyzing ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-20 text-center">
          <div className="relative mb-5 flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-100 border-t-slate-900" />
            <BrainCircuit className="absolute h-5 w-5 animate-pulse text-slate-800" />
          </div>
          <p className="text-sm font-bold text-slate-800">{loaderMessage}</p>
          <p className="mt-1.5 max-w-xs text-xs text-slate-400">資料缺漏不會以推測數字補足；面板將直接顯示需查證或佔比未知。</p>
        </div>
      ) : analysis ? (
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Recommendation</span>
              <span className="mt-1 text-2xl font-black text-slate-800">{analysis.recommendation}</span>
              <span className="mt-2 text-[10px] font-semibold text-slate-500">整體信心：{analysis.confidenceLevel}</span>
            </div>
            <div className="md:col-span-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">分析摘要</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{analysis.summary || "需查證"}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{analysis.outlook || "需查證"}</p>
            </div>
          </div>

          <div className="border-l-4 border-indigo-500 bg-indigo-50/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">一句總結</p>
            <div className="mt-1"><SourcedText field={analysis.oneLineSummary} className="font-semibold" /></div>
          </div>

          <section className="rounded-xl border border-slate-100 p-4">
            <div className="flex items-center gap-1.5"><Building2 className="h-4 w-4 text-slate-600" /><h3 className="text-sm font-bold text-slate-800">公司背景</h3></div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <BackgroundFact label="公司" field={analysis.companyBackground.companyName} />
              <BackgroundFact label="產業" field={analysis.companyBackground.industry} />
              <BackgroundFact label="交易所" field={analysis.companyBackground.exchange} />
              <BackgroundFact label="上市日" field={analysis.companyBackground.ipoDate} />
              <BackgroundFact label="市值" field={analysis.companyBackground.marketCapitalization} />
              <BackgroundFact label="市值幣別" field={analysis.companyBackground.marketCapitalizationCurrency} />
              <BackgroundFact label="總部國家" field={analysis.companyBackground.country} />
              <BackgroundFact label="資料市場" field={{
                value: analysis.marketScope,
                dataConfidence: "AI 綜合判斷，非即時財報數據",
                source: "Unavailable",
                endpoint: null,
                sourceField: "symbol market suffix",
                fetchedAt: null,
                periodEnd: null,
                isStale: false,
                unavailableReason: null
              }} />
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">公司定位補述</p>
              <SourcedText field={analysis.companyBackground.positioning} className="mt-1" />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-1.5"><Landmark className="h-4 w-4 text-emerald-600" /><h3 className="text-sm font-bold text-slate-800">估值與獲利實測欄位</h3></div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <MetricCard label="P/E" field={analysis.financialMetrics.pe} />
              <MetricCard label="P/B" field={analysis.financialMetrics.pb} />
              <MetricCard label="EPS" field={analysis.financialMetrics.eps} />
              <MetricCard label="ROE" field={analysis.financialMetrics.roe} suffix="%" />
              <MetricCard label="毛利率" field={analysis.financialMetrics.grossMargin} suffix="%" />
              <MetricCard label="52 週高" field={analysis.financialMetrics.week52High} />
              <MetricCard label="52 週低" field={analysis.financialMetrics.week52Low} />
              <MetricCard label="營收" field={analysis.financialMetrics.revenue} />
              <MetricCard label="淨利" field={analysis.financialMetrics.netIncome} />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-100 p-4">
              <div className="flex items-center gap-1.5"><BriefcaseBusiness className="h-4 w-4 text-blue-600" /><h3 className="text-sm font-bold text-slate-800">主要營收業務</h3></div>
              <p className="mt-1 text-[11px] text-slate-400">只有 Finnhub 實測資料才顯示數字佔比；其他情況一律顯示「佔比未知」。</p>
              <div className="mt-3 space-y-3">
                {analysis.topRevenueBusinesses.length > 0 ? analysis.topRevenueBusinesses.map((business, index) => (
                  <div key={`${business.name.value ?? "unknown"}-${index}`} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><p className="text-xs font-bold text-slate-700">{displayValue(business.name.value)}</p><p className="mt-1 text-xs leading-relaxed text-slate-500">{displayValue(business.description.value)}</p></div>
                      <span className="shrink-0 rounded bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700">
                        {business.revenueSharePercent.value === null ? "佔比未知" : `${business.revenueSharePercent.value.toFixed(2)}%`}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5"><SourceBadge field={business.name} /><SourceBadge field={business.revenueSharePercent} /></div>
                  </div>
                )) : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">未取得可驗證的業務營收拆分；佔比未知。</p>}
              </div>
            </section>

            <section className="rounded-xl border border-slate-100 p-4">
              <div className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-amber-500" /><h3 className="text-sm font-bold text-slate-800">催化劑</h3></div>
              <div className="mt-3 space-y-3">
                {analysis.catalysts.length > 0 ? analysis.catalysts.map((catalyst, index) => (
                  <div key={`${catalyst.title.value ?? "unknown"}-${index}`} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center gap-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${catalyst.direction.value === "正面" ? "bg-emerald-100 text-emerald-700" : catalyst.direction.value === "負面" ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-600"}`}>{displayValue(catalyst.direction.value)}</span><p className="text-xs font-bold text-slate-700">{displayValue(catalyst.title.value)}</p></div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{displayValue(catalyst.rationale.value)}</p>
                    <div className="mt-2"><SourceBadge field={catalyst.title} /></div>
                  </div>
                )) : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">暫無可驗證或可安全描述的催化劑。</p>}
              </div>
            </section>

            <section className="rounded-xl border border-slate-100 p-4">
              <div className="flex items-center gap-1.5"><Users2 className="h-4 w-4 text-indigo-600" /><h3 className="text-sm font-bold text-slate-800">主要同業</h3></div>
              <div className="mt-3 space-y-2">
                {analysis.competitors.length > 0 ? analysis.competitors.map((competitor, index) => (
                  <div key={`${competitor.name.value ?? "unknown"}-${index}`} className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold text-slate-700">{displayValue(competitor.name.value)}</p><p className="mt-1 text-xs text-slate-500">{displayValue(competitor.comparison.value)}</p><div className="mt-2"><SourceBadge field={competitor.name} /></div></div>
                )) : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">主要同業需查證。</p>}
              </div>
            </section>

            <section className="rounded-xl border border-slate-100 p-4">
              <div className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" /><h3 className="text-sm font-bold text-slate-800">競爭優勢／護城河</h3></div>
              <SourcedText field={analysis.competitiveAdvantage.summary} className="mt-3" />
              <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">限制與需查證</p><SourcedText field={analysis.competitiveAdvantage.limitations} className="mt-1" /></div>
            </section>
          </div>

          <section className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
            <div className="flex items-center gap-1.5"><Target className="h-4 w-4 text-slate-600" /><h3 className="text-sm font-bold text-slate-800">技術面與風險提醒</h3></div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">{analysis.technicalSummary.summary || "需查證"}</p>
            <p className="mt-2 text-xs text-slate-500">{analysis.valuation.reasoning || "估值資料不足。"}</p>
            {analysis.risks.length > 0 && <ul className="mt-3 space-y-1.5">{analysis.risks.map((risk, index) => <li key={`${risk}-${index}`} className="flex gap-2 text-xs text-slate-600"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />{risk}</li>)}</ul>}
          </section>

          {analysis.dataLimitations.length > 0 && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-800">資料限制</p><ul className="mt-1.5 space-y-1">{analysis.dataLimitations.map((item, index) => <li key={`${item}-${index}`} className="flex gap-1.5 text-xs text-amber-700"><ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />{item}</li>)}</ul></div>
          )}
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 px-4 py-20 text-center">
          <Sparkles className="mb-2 h-8 w-8 animate-pulse text-slate-300" />
          <span className="text-sm font-bold text-slate-700">尚未為 {symbol} 產生分析</span>
          <p className="mt-1 max-w-xs text-xs text-slate-400">系統會優先顯示可用 API 實測資料，缺漏內容才以明確標示的 AI 研究補足。</p>
          <button id={`btn-initiate-analysis-${symbol}`} onClick={onAnalyze} className="mt-4 flex items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"><BrainCircuit className="h-4 w-4" />產生分析</button>
        </div>
      )}

      {analysis && !isAnalyzing && (
        <footer className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-[10px] text-slate-400"><span>分析時間：{analysis.lastAnalyzed}</span><button id={`btn-reanalyze-${symbol}`} onClick={onAnalyze} className="flex items-center gap-1 font-semibold text-slate-500 transition-colors hover:text-slate-950"><Sparkles className="h-3 w-3 text-indigo-500" />重新分析</button></footer>
      )}
    </section>
  );
};
