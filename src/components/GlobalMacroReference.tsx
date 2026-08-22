import { useEffect, useState } from "react";
import { AlertTriangle, Clock3, ExternalLink, Globe2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import type { GlobalMacroItem, GlobalMacroReference, GlobalMacroSection } from "../types.js";

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

function emptyMacro(reason: string): GlobalMacroReference {
  return {
    available: false,
    dataNature: DATA_NATURE,
    generatedAt: new Date().toISOString(),
    cachedAt: null,
    isStale: false,
    sources: [],
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
      {item.source && (
        <a
          href={item.source.url}
          target="_blank"
          rel="noreferrer"
          title={item.source.url}
          className="mt-2 inline-flex max-w-full items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700 transition hover:bg-sky-100"
        >
          <span>{item.source.provider}</span>
          <span className="max-w-48 truncate">· {item.source.title}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      )}
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

  useEffect(() => {
    void load();
  }, []);

  const macro = data ?? emptyMacro("数据载入中");
  const sections = [
    macro.preciousMetals,
    macro.energyPrices,
    macro.countryEnergy,
    macro.centralBankRates,
    macro.geopoliticalNews
  ];

  return (
    <section id="global-macro-reference" className="overflow-hidden rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-indigo-50 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-sky-100 bg-white/70 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-700 text-white shadow-sm">
            <Globe2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">全球宏观参考</h2>
            <p className="mt-1 text-xs font-semibold text-sky-800">{macro.dataNature}</p>
            <p className="mt-1 text-[11px] text-slate-500">面板生成：{formatTime(macro.generatedAt)}{macro.isStale ? " · 部分为服务端旧缓存" : ""}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-800 shadow-sm transition hover:bg-sky-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          重新加载
        </button>
      </div>

      <div className="px-6 py-4">
        {loading && !data ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {[1, 2, 3, 4, 5].map((index) => <div key={index} className="h-48 animate-pulse rounded-2xl bg-sky-100/70" />)}
          </div>
        ) : (
          <>
            {!macro.available && (
              <div className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
                <div className="text-xs leading-5">
                  <p className="font-bold">暂时没有可验证的宏观数据</p>
                  <p>{macro.unavailableReason || UNAVAILABLE_TEXT}</p>
                </div>
              </div>
            )}
            {requestError && (
              <div className="mb-4 flex gap-2 text-xs text-rose-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                请求失败：{requestError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {sections.map((item) => <MacroCard key={item.title} item={item} />)}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
