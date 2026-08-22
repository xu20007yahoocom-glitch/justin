import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Globe2, Loader2, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import type { GlobalMacroReference, GlobalMacroSection } from "../types.js";

const DATA_NATURE = "AI 聯網搜尋整理，非即時行情，僅供參考" as const;

function emptyMacro(reason: string): GlobalMacroReference {
  const section = (title: string): GlobalMacroSection => ({ title, summary: "暫無可靠資料", sources: [] });
  return {
    available: false,
    dataNature: DATA_NATURE,
    generatedAt: new Date().toISOString(),
    cachedAt: null,
    isStale: false,
    model: null,
    searchQueries: [],
    sources: [],
    criticalMinerals: section("關鍵礦產（鋰、鈷、稀土）"),
    energyCommodities: section("能源商品（原油、天然氣）"),
    preciousMetals: section("黃金／貴金屬"),
    geopolitics: section("重大地緣政治動態與世界格局"),
    countryNews: section("各國重大新聞摘要"),
    unavailableReason: reason
  };
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "時間待確認" : date.toLocaleString("zh-TW", { hour12: false });
}

function MacroCard({ item }: { item: GlobalMacroSection }) {
  return (
    <article className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-extrabold text-slate-800">{item.title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 whitespace-pre-line">{item.summary || "暫無可靠資料"}</p>
      {item.sources.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">搜尋來源</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.sources.slice(0, 4).map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
                title={source.url}
              >
                <span className="truncate max-w-40">{source.title}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}
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
      const reason = error instanceof Error ? error.message : "未知錯誤";
      setRequestError(reason);
      setData(emptyMacro("全球宏觀參考暫時不可用，請稍後再試"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const macro = data ?? emptyMacro("資料載入中");
  const sections = [
    macro.criticalMinerals,
    macro.energyCommodities,
    macro.preciousMetals,
    macro.geopolitics,
    macro.countryNews
  ];

  return (
    <section id="global-macro-reference" className="overflow-hidden rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-indigo-50 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-sky-100 bg-white/70 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-700 text-white shadow-sm">
            <Globe2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
              全球宏觀參考 <Sparkles className="h-4 w-4 text-sky-600" />
            </h2>
            <p className="mt-1 text-xs font-semibold text-sky-800">{macro.dataNature}</p>
            <p className="mt-1 text-[11px] text-slate-500">更新時間：{formatTime(macro.generatedAt)}{macro.model ? ` · ${macro.model}` : ""}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-800 shadow-sm transition hover:bg-sky-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          重新載入
        </button>
      </div>

      <div className="px-6 py-4">
        {loading && !data ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4].map((index) => <div key={index} className="h-40 animate-pulse rounded-2xl bg-sky-100/70" />)}
          </div>
        ) : (
          <>
            {!macro.available && (
              <div className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
                <div className="text-xs leading-5">
                  <p className="font-bold">暫無可驗證的聯網搜尋資料</p>
                  <p>{macro.unavailableReason || "暫無可靠資料"}</p>
                </div>
              </div>
            )}
            {requestError && (
              <div className="mb-4 flex gap-2 text-xs text-rose-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                請求失敗：{requestError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {sections.map((item) => <MacroCard key={item.title} item={item} />)}
            </div>
            {macro.searchQueries.length > 0 && (
              <p className="mt-4 text-[11px] text-slate-400">已使用搜尋主題：{macro.searchQueries.join(" · ")}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
