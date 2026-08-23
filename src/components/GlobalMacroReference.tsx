import { useEffect, useState } from "react";
import { AlertTriangle, Clock3, ExternalLink, Globe2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import type { CriticalMineralRecord, CriticalMineralsSection, GlobalMacroItem, GlobalMacroReference, GlobalMacroSection } from "../types.js";

const DATA_NATURE = "真实数据整理，非实时，定期更新" as const;
const UNAVAILABLE_TEXT = "暂无可靠资料";

function emptyItem(label: string): GlobalMacroItem {
  return {
    label,
    value: UNAVAILABLE_TEXT,
    unit: null,
    dataTime: null,
    source: null,
    note: "非实时，定期更新",
    available: false
  };
}

function emptySection(title: string, labels: string[]): GlobalMacroSection {
  return {
    title,
    summary: UNAVAILABLE_TEXT,
    updatedAt: null,
    items: labels.map(emptyItem),
    sources: []
  };
}

function emptyCriticalMinerals(): CriticalMineralsSection {
  return {
    title: "关键矿产",
    summary: "USGS 年度数据与 Mining.com RSS；非实时，定期更新",
    updatedAt: null,
    minerals: [],
    news: [emptyItem("近期矿产新闻")],
    sources: []
  };
}

function emptyMacro(reason: string): GlobalMacroReference {
  return {
    available: false,
    dataNature: DATA_NATURE,
    generatedAt: new Date().toISOString(),
    cachedAt: null,
    isStale: false,
    sources: [],
    criticalMinerals: emptyCriticalMinerals(),
    preciousMetals: emptySection("贵金属", ["黄金现货价"]),
    energyPrices: emptySection("能源价格", ["WTI 原油", "Brent 原油", "Henry Hub 天然气"]),
    countryEnergy: emptySection("各国储备／使用量", ["中国石油及其他液体消费", "美国石油及其他液体消费", "中国石油储备"]),
    centralBankRates: emptySection("央行利率", ["美国有效联邦基金利率", "美国联邦基金目标区间上限", "欧元区 ECB 存款便利利率"]),
    geopoliticalNews: emptySection("地缘政治／全球新闻", ["近期地缘政治与全球新闻"]),
    unavailableReason: reason
  };
}

function formatTime(value: string | null): string {
  if (!value) return "时间待确认";
  const gdelt = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const normalized = gdelt ? `${gdelt[1]}-${gdelt[2]}-${gdelt[3]}T${gdelt[4]}:${gdelt[5]}:${gdelt[6]}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function SourceLink({ source }: { source: GlobalMacroItem["source"] }) {
  if (!source) return null;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={source.url}
      className="mt-2 inline-flex max-w-full items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700 transition hover:bg-sky-100"
    >
      <span>{source.provider}</span>
      <span className="max-w-48 truncate">· {source.title}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

function MacroItemRow({ item }: { item: GlobalMacroItem }) {
  const displayValue = item.available ? item.value : UNAVAILABLE_TEXT;
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-extrabold text-slate-800">{item.label}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${item.available ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {item.available ? "已验证" : UNAVAILABLE_TEXT}
        </span>
      </div>
      <p className={`mt-2 break-words text-sm font-semibold ${item.available ? "text-slate-700" : "text-slate-500"}`}>
        {displayValue}{item.available && item.unit ? ` ${item.unit}` : ""}
      </p>
      <div className="mt-2 space-y-1 text-[11px] leading-5 text-slate-500">
        <p className="flex items-center gap-1.5"><Clock3 className="h-3 w-3 shrink-0" />数据时间：{formatTime(item.dataTime)}</p>
        <p>{item.note || "非实时，定期更新"}</p>
      </div>
      <SourceLink source={item.source} />
    </div>
  );
}

function MacroCard({ item }: { item: GlobalMacroSection }) {
  return (
    <article className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-800">{item.title}</h3>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{item.summary || UNAVAILABLE_TEXT}</p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold text-slate-400">更新：{formatTime(item.updatedAt)}</span>
      </div>
      <div className="mt-4 space-y-3">
        {item.items.length > 0 ? item.items.map((entry, index) => <MacroItemRow key={`${entry.label}-${index}`} item={entry} />) : <MacroItemRow item={emptyItem("数据项")} />}
      </div>
    </article>
  );
}

function MineralDetail({ mineral }: { mineral: CriticalMineralRecord }) {
  const production = mineral.available && mineral.globalProduction ? mineral.globalProduction : UNAVAILABLE_TEXT;
  const reserves = mineral.available && mineral.globalReserves ? mineral.globalReserves : UNAVAILABLE_TEXT;
  return (
    <details className="group rounded-xl border border-amber-100 bg-amber-50/40 p-3" open={mineral.id === "lithium"}>
      <summary className="cursor-pointer list-none text-xs font-extrabold text-slate-800 marker:hidden">
        <span className="flex items-center justify-between gap-3">
          <span>{mineral.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${mineral.available ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
            {mineral.available ? "USGS 已验证" : UNAVAILABLE_TEXT}
          </span>
        </span>
      </summary>
      <div className="mt-3 space-y-3 text-[11px] leading-5 text-slate-600">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-white bg-white/80 p-2">
            <p className="font-bold text-slate-700">全球产量（{mineral.productionYear ?? "年份待确认"}）</p>
            <p className="mt-1 font-extrabold text-slate-800">{production}</p>
            <p className="text-slate-500">单位：{mineral.productionUnit ?? UNAVAILABLE_TEXT}</p>
          </div>
          <div className="rounded-lg border border-white bg-white/80 p-2">
            <p className="font-bold text-slate-700">全球储量（{mineral.reserveYear ?? "年份待确认"}）</p>
            <p className="mt-1 font-extrabold text-slate-800">{reserves}</p>
            <p className="text-slate-500">单位：{mineral.reserveUnit ?? UNAVAILABLE_TEXT}</p>
          </div>
        </div>
        {mineral.countries.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-white bg-white/80">
            <table className="min-w-full text-left text-[10px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="px-2 py-1.5 font-bold">主要国家</th><th className="px-2 py-1.5 font-bold">产量</th><th className="px-2 py-1.5 font-bold">储量</th></tr>
              </thead>
              <tbody>
                {mineral.countries.map((country) => (
                  <tr key={country.country} className="border-t border-slate-100 text-slate-600">
                    <td className="px-2 py-1.5 font-semibold text-slate-700">{country.country}</td>
                    <td className="px-2 py-1.5">{country.production ?? UNAVAILABLE_TEXT}</td>
                    <td className="px-2 py-1.5">{country.reserves ?? UNAVAILABLE_TEXT}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="rounded-lg bg-white/80 p-2">国家级储量／产量：{UNAVAILABLE_TEXT}</p>}
        <p>{mineral.note || "年度数据，非实时"}</p>
        <a href={mineral.source.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700 transition hover:bg-sky-100">
          <span>{mineral.source.provider}</span><span className="max-w-64 truncate">· {mineral.source.title}</span><ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      </div>
    </details>
  );
}

function CriticalMineralsCard({ section }: { section: CriticalMineralsSection }) {
  return (
    <article className="xl:col-span-2 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-extrabold text-slate-800">{section.title}</h3>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{section.summary}</p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold text-slate-400">更新：{formatTime(section.updatedAt)}</span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-3">
          <h4 className="text-xs font-extrabold text-amber-900">储量／产量（USGS 年度数据）</h4>
          <p className="mt-1 text-[10px] leading-4 text-amber-800">每种矿产的产量单位与储量单位分别列示；不混用“公吨”“千公吨”“REO 当量”等口径。</p>
          <div className="mt-3 max-h-[46rem] space-y-2 overflow-y-auto pr-1">
            {section.minerals.length > 0 ? section.minerals.map((mineral) => <MineralDetail key={mineral.id} mineral={mineral} />) : <p className="rounded-lg bg-white p-3 text-xs text-slate-500">{UNAVAILABLE_TEXT}</p>}
          </div>
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50/30 p-3">
          <h4 className="text-xs font-extrabold text-sky-900">矿产新闻动态（RSS）</h4>
          <p className="mt-1 text-[10px] leading-4 text-sky-800">Mining.com 完整 RSS 经本地矿产关键词筛选；非实时，定期更新。</p>
          <div className="mt-3 space-y-3">
            {section.news.length > 0 ? section.news.map((article, index) => <MacroItemRow key={`${article.label}-${index}`} item={article} />) : <MacroItemRow item={emptyItem("近期矿产新闻")} />}
          </div>
        </div>
      </div>
    </article>
  );
}

export function GlobalMacroReferencePanel() {
  const [data, setData] = useState<GlobalMacroReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setRequestError(null);
    try {
      const response = await fetch("/api/global/macro");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json() as GlobalMacroReference;
      setData(value);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "未知错误";
      setRequestError(reason);
      setData(emptyMacro("全球宏观参考暂时不可用，请稍后再试"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const macro = data ?? emptyMacro("数据载入中");
  const sections = [macro.preciousMetals, macro.energyPrices, macro.countryEnergy, macro.centralBankRates, macro.geopoliticalNews];

  return (
    <section id="global-macro-reference" className="overflow-hidden rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-indigo-50 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-sky-100 bg-white/70 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-700 text-white shadow-sm"><Globe2 className="h-5 w-5" /></div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">全球宏观参考</h2>
            <p className="mt-1 text-xs font-semibold text-sky-800">{macro.dataNature}</p>
            <p className="mt-1 text-[11px] text-slate-500">面板生成：{formatTime(macro.generatedAt)}{macro.isStale ? " · 部分为服务端旧缓存" : ""}</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-800 shadow-sm transition hover:bg-sky-50 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}重新加载
        </button>
      </div>
      <div className="px-6 py-4">
        {loading && !data ? <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{[1, 2, 3, 4, 5].map((index) => <div key={index} className="h-48 animate-pulse rounded-2xl bg-sky-100/70" />)}</div> : (
          <>
            {!macro.available && <div className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900"><ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" /><div className="text-xs leading-5"><p className="font-bold">暂时没有可验证的宏观数据</p><p>{macro.unavailableReason || UNAVAILABLE_TEXT}</p></div></div>}
            {requestError && <div className="mb-4 flex gap-2 text-xs text-rose-700"><AlertTriangle className="h-4 w-4 shrink-0" />请求失败：{requestError}</div>}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <CriticalMineralsCard section={macro.criticalMinerals} />
              {sections.map((item) => <MacroCard key={item.title} item={item} />)}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
