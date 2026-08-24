import { useEffect, useState } from "react";
import { Activity, AlertTriangle, BookOpen, ChevronDown, Clock3, ExternalLink, Globe2, Layers3, ListChecks, Loader2, RefreshCw, ShieldAlert, Target } from "lucide-react";
import type { CriticalMineralRecord, CriticalMineralsSection, GlobalMacroCountryGroup, GlobalMacroItem, GlobalMacroReference, GlobalMacroSection } from "../types.js";
import {
  CORE_JUDGMENT_NOTICE,
  CORE_PRIORITIES,
  CORE_WATCHLIST_RANKS,
  ENERGY_METRIC_FRAMEWORK,
  MONITORING_SEQUENCE,
  THEME_FRAMEWORKS,
  USAGE_NOTICE,
  WATCHLIST_DATA_NOTICE,
  WATCHLIST_DISCLAIMER,
  WATCHLIST_PRIORITY_NOTICE,
  WATCHLIST_PURPOSE,
  WATCHLIST_STATUS_NOTICE,
  WATCHLIST_SUBTITLE,
  type ThemeFramework,
  type WatchlistPriority
} from "../config/globalMacroWatchlist.js";
import {
  UNAVAILABLE_TEXT,
  formatMacroValue,
  frequencyLabel,
  getMacroDataStatus,
  isVerifiedMacroItem,
  macroStatusClass,
  macroStatusLabel,
  verifiedCount,
  type MacroDataStatus
} from "../lib/globalMacroPresentation.js";

const DATA_NATURE = "真实数据整理，非实时，定期更新" as const;
const RATE_COUNTRIES = ["美国", "欧元区", "英国", "日本", "中国", "加拿大", "澳洲", "瑞士", "印度", "韩国", "巴西", "墨西哥"];
const ENERGY_COUNTRIES = ["美国", "中国", "俄罗斯", "印度", "日本", "德国", "沙特", "韩国", "加拿大", "巴西", "伊朗", "法国"];
const RATE_LABELS = ["政策基准利率", "10 年期公债收益率"];
const ENERGY_LABELS = ["石油消费", "石油产量", "天然气消费", "天然气产量", "电力消费"];

function emptyItem(label: string): GlobalMacroItem {
  return { label, value: UNAVAILABLE_TEXT, unit: null, dataTime: null, source: null, note: "非实时，定期更新", available: false };
}

function emptySection(title: string, labels: string[]): GlobalMacroSection {
  return { title, summary: UNAVAILABLE_TEXT, updatedAt: null, items: labels.map(emptyItem), sources: [] };
}

function emptyCountrySection(title: string, countries: string[], labels: string[], summary: string): GlobalMacroSection {
  const groups: GlobalMacroCountryGroup[] = countries.map((country) => ({ country, updatedAt: null, items: labels.map(emptyItem), available: false }));
  return { title, summary, updatedAt: null, items: groups.flatMap((group) => group.items), countries: groups, sources: [] };
}

function emptyCriticalMinerals(): CriticalMineralsSection {
  return { title: "关键矿产", summary: "USGS 年度数据与 Mining.com RSS；非实时，定期更新", updatedAt: null, minerals: [], news: [emptyItem("近期矿产新闻")], sources: [] };
}

function emptyMacro(reason: string): GlobalMacroReference {
  return {
    available: false, dataNature: DATA_NATURE, generatedAt: new Date().toISOString(), cachedAt: null, isStale: false, sources: [],
    criticalMinerals: emptyCriticalMinerals(), preciousMetals: emptySection("贵金属", ["黄金现货价"]),
    energyPrices: emptySection("能源价格", ["WTI 原油", "Brent 原油", "Henry Hub 天然气"]),
    countryEnergy: emptyCountrySection("各国能源使用量", ENERGY_COUNTRIES, ENERGY_LABELS, "EIA International 数据；非实时，定期更新"),
    centralBankRates: emptyCountrySection("央行利率", RATE_COUNTRIES, RATE_LABELS, "FRED 数据；非实时，定期更新"),
    geopoliticalNews: emptySection("地缘政治／全球新闻", ["地缘政治与经济相关新闻"]), unavailableReason: reason
  };
}

function formatTime(value: string | null): string {
  if (!value) return "时间待确认";
  const gdelt = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const normalized = gdelt ? `${gdelt[1]}-${gdelt[2]}-${gdelt[3]}T${gdelt[4]}:${gdelt[5]}:${gdelt[6]}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function PriorityStars({ priority, compact = false }: { priority: WatchlistPriority; compact?: boolean }) {
  return <span title={WATCHLIST_PRIORITY_NOTICE} aria-label={`${priority} 星；${WATCHLIST_PRIORITY_NOTICE}`} className="whitespace-nowrap text-amber-500">{"★".repeat(priority)}<span className="text-slate-300">{"☆".repeat(5 - priority)}</span>{!compact && <span className="ml-1.5 text-[10px] font-semibold text-slate-500">观察优先级</span>}</span>;
}

function StatusBadge({ status }: { status: MacroDataStatus }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${macroStatusClass(status)}`}>{macroStatusLabel(status)}</span>;
}

function SourceLink({ source }: { source: GlobalMacroItem["source"] }) {
  if (!source) return null;
  return <a href={source.url} target="_blank" rel="noreferrer" title={source.url} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700 transition hover:bg-sky-100"><span>来源：{source.provider}</span><span className="max-w-52 truncate">· {source.title}</span><ExternalLink className="h-3 w-3 shrink-0" /></a>;
}

function MetricCard({ item, framework }: { item: GlobalMacroItem; framework?: { drivers: string; impactedMarkets: string; focus: string; priority: WatchlistPriority } }) {
  const status = getMacroDataStatus([item]);
  const verified = isVerifiedMacroItem(item);
  return <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><p className="text-xs font-extrabold text-slate-800">{item.label}</p><StatusBadge status={status} /></div><p className={`mt-3 break-words text-xl font-extrabold ${verified ? "text-slate-900" : "text-slate-500"}`}>{formatMacroValue(item)}{verified && item.unit ? <span className="ml-1.5 text-xs font-semibold text-slate-500">{item.unit}</span> : null}</p><div className="mt-3 grid grid-cols-1 gap-1.5 text-[11px] leading-5 text-slate-600"><p><Clock3 className="mr-1 inline h-3 w-3" />数据时间：{formatTime(item.dataTime)}</p><p>频率：{frequencyLabel(item)}</p>{item.source ? <p className="truncate">数据标识：{item.source.title}</p> : null}{item.note ? <p className="text-slate-500">说明：{item.note}</p> : null}</div>{framework ? <div className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-5 text-slate-600"><p><span className="font-bold text-slate-700">关键驱动：</span>{framework.drivers}</p><p><span className="font-bold text-slate-700">影响市场：</span>{framework.impactedMarkets}</p><p><span className="font-bold text-slate-700">观察重点：</span>{framework.focus}</p><p className="mt-1"><PriorityStars priority={framework.priority} /></p></div> : null}<div className="mt-3"><SourceLink source={item.source} /></div></article>;
}

function ThemeFrame({ framework, status, children }: { framework: ThemeFramework; status: MacroDataStatus; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4 sm:p-6"><div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-sky-700">Watchlist {framework.code}</p><h3 className="mt-1 text-base font-extrabold text-slate-900">{framework.title}</h3><p className="mt-1 text-xs leading-5 text-slate-600">静态观察框架：关键驱动为{framework.keyDrivers}；主要影响市场为{framework.impactedMarkets}；观察重点为{framework.focus}。</p></div><div className="flex shrink-0 items-center gap-2"><PriorityStars priority={framework.priority} compact /><StatusBadge status={status} /></div></div><div className="pt-4">{children}</div></section>;
}

function CountryWatchlist({ section, defaultOpenCountry }: { section: GlobalMacroSection; defaultOpenCountry: string }) {
  const groups = section.countries ?? [];
  return <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{groups.map((group) => <CountryCard key={group.country} group={group} defaultOpen={group.country === defaultOpenCountry} />)}</div>;
}

function CountryCard({ group, defaultOpen }: { group: GlobalMacroCountryGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const status = getMacroDataStatus(group.items);
  const count = verifiedCount(group.items);
  return <article className="rounded-2xl border border-indigo-100 bg-white p-3 shadow-sm"><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-sky-500"><span><span className="block text-sm font-extrabold text-slate-800">{group.country}</span><span className="mt-1 block text-[11px] text-slate-500">可用指标：{count}/{group.items.length} · 最新有效数据：{formatTime(group.updatedAt)}</span></span><span className="flex items-center gap-2"><StatusBadge status={status} /><ChevronDown className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`} /></span></button>{open ? <div className="mt-3 grid grid-cols-1 gap-2">{group.items.map((item) => <MetricCard key={`${group.country}-${item.label}`} item={item} />)}</div> : null}</article>;
}

function WatchlistOverview({ macro }: { macro: GlobalMacroReference }) {
  const themes = [
    { framework: THEME_FRAMEWORKS[0], items: [...macro.energyPrices.items, ...macro.preciousMetals.items] },
    { framework: THEME_FRAMEWORKS[1], items: (macro.centralBankRates.countries ?? []).flatMap((group) => group.items) },
    { framework: THEME_FRAMEWORKS[2], items: (macro.countryEnergy.countries ?? []).flatMap((group) => group.items) },
    { framework: THEME_FRAMEWORKS[3], items: macro.geopoliticalNews.items }
  ];
  return <section aria-labelledby="macro-watchlist-overview" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-sky-700">Theme overview</p><h3 id="macro-watchlist-overview" className="mt-1 text-base font-extrabold text-slate-900">宏观主题 Watchlist 总览</h3></div><p className="text-[11px] text-slate-500">{WATCHLIST_STATUS_NOTICE}</p></div><div className="mt-4 hidden overflow-x-auto md:block"><table className="min-w-full text-left text-xs"><thead className="border-y border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th scope="col" className="px-3 py-2 font-bold">主题</th><th scope="col" className="px-3 py-2 font-bold">核心指标</th><th scope="col" className="px-3 py-2 font-bold">主要影响市场</th><th scope="col" className="px-3 py-2 font-bold">观察重点</th><th scope="col" className="px-3 py-2 font-bold">观察优先级</th><th scope="col" className="px-3 py-2 font-bold">当前数据状态</th></tr></thead><tbody>{themes.map(({ framework, items }) => { const status = getMacroDataStatus(items); return <tr key={framework.id} className="border-b border-slate-100 align-top text-slate-600"><td className="px-3 py-3 font-bold text-slate-800">{framework.overviewTitle}</td><td className="px-3 py-3">{framework.coreIndicators}</td><td className="px-3 py-3">{framework.impactedMarkets}</td><td className="px-3 py-3">{framework.focus}</td><td className="px-3 py-3"><PriorityStars priority={framework.priority} compact /></td><td className="px-3 py-3"><StatusBadge status={status} /></td></tr>; })}</tbody></table></div><div className="mt-4 grid grid-cols-1 gap-3 md:hidden">{themes.map(({ framework, items }) => <article key={framework.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><h4 className="text-xs font-extrabold text-slate-800">{framework.overviewTitle}</h4><StatusBadge status={getMacroDataStatus(items)} /></div><p className="mt-2 text-[11px] leading-5 text-slate-600"><span className="font-bold">核心指标：</span>{framework.coreIndicators}</p><p className="text-[11px] leading-5 text-slate-600"><span className="font-bold">影响市场：</span>{framework.impactedMarkets}</p><p className="text-[11px] leading-5 text-slate-600"><span className="font-bold">观察重点：</span>{framework.focus}</p><p className="mt-1"><PriorityStars priority={framework.priority} /></p></article>)}</div></section>;
}

function CriticalMineralsPanel({ section }: { section: CriticalMineralsSection }) {
  return <section className="rounded-3xl border border-amber-200 bg-amber-50/30 p-4 sm:p-6"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-amber-800">Supplementary annual data</p><h3 className="mt-1 text-base font-extrabold text-slate-900">关键矿产补充资料</h3><p className="mt-1 text-xs leading-5 text-slate-600">{section.summary}</p></div><span className="text-[11px] text-slate-500">更新：{formatTime(section.updatedAt)}</span></div><div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2"><div className="space-y-2">{section.minerals.length ? section.minerals.map((mineral) => <MineralCard key={mineral.id} mineral={mineral} />) : <MetricCard item={emptyItem("USGS 年度矿产数据")} />}</div><div><h4 className="text-xs font-extrabold text-slate-800">矿产新闻动态（RSS）</h4><div className="mt-3 space-y-2">{section.news.map((item, index) => <MetricCard key={`${item.label}-${index}`} item={item} />)}</div></div></div></section>;
}

function MineralCard({ mineral }: { mineral: CriticalMineralRecord }) {
  const [open, setOpen] = useState(mineral.id === "lithium");
  return <article className="rounded-2xl border border-amber-100 bg-white p-3"><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left focus:outline-none focus:ring-2 focus:ring-amber-500"><span><span className="block text-xs font-extrabold text-slate-800">{mineral.name}</span><span className="mt-1 block text-[10px] text-slate-500">USGS 年度数据；产量与储量单位分别保留</span></span><ChevronDown className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`} /></button>{open ? <div className="mt-3"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><div className="rounded-xl bg-amber-50 p-2"><p className="text-[10px] font-bold text-slate-600">全球产量（{mineral.productionYear ?? "年份待确认"}）</p><p className="mt-1 text-sm font-extrabold text-slate-800">{mineral.available && mineral.globalProduction ? mineral.globalProduction : UNAVAILABLE_TEXT}</p><p className="text-[10px] text-slate-500">单位：{mineral.productionUnit ?? UNAVAILABLE_TEXT}</p></div><div className="rounded-xl bg-amber-50 p-2"><p className="text-[10px] font-bold text-slate-600">全球储量（{mineral.reserveYear ?? "年份待确认"}）</p><p className="mt-1 text-sm font-extrabold text-slate-800">{mineral.available && mineral.globalReserves ? mineral.globalReserves : UNAVAILABLE_TEXT}</p><p className="text-[10px] text-slate-500">单位：{mineral.reserveUnit ?? UNAVAILABLE_TEXT}</p></div></div>{mineral.countries.length ? <div className="mt-3 overflow-x-auto rounded-xl border border-amber-100"><table className="min-w-full text-left text-[11px]"><thead className="bg-amber-50 text-slate-600"><tr><th scope="col" className="px-2 py-2">主要国家</th><th scope="col" className="px-2 py-2">产量</th><th scope="col" className="px-2 py-2">储量</th></tr></thead><tbody>{mineral.countries.map((country) => <tr key={country.country} className="border-t border-amber-100"><td className="px-2 py-2 font-semibold text-slate-700">{country.country}</td><td className="px-2 py-2">{country.production ?? UNAVAILABLE_TEXT}</td><td className="px-2 py-2">{country.reserves ?? UNAVAILABLE_TEXT}</td></tr>)}</tbody></table></div> : null}<p className="mt-2 text-[10px] leading-4 text-slate-500">{mineral.note}</p><div className="mt-2"><SourceLink source={mineral.source} /></div></div> : null}</article>;
}

function CoreRankTable({ macro }: { macro: GlobalMacroReference }) {
  const rateCountries = macro.centralBankRates.countries ?? [];
  const energyCountries = macro.countryEnergy.countries ?? [];
  const usRates = rateCountries.find((group) => group.country === "美国")?.items ?? [];
  const usChinaEnergy = energyCountries.filter((group) => group.country === "美国" || group.country === "中国").flatMap((group) => group.items);
  const allPolicyRates = rateCountries.flatMap((group) => group.items.filter((item) => item.label === "政策基准利率"));
  const rankItems: Readonly<Record<string, GlobalMacroItem[]>> = {
    "us-rates": usRates,
    "wti-brent": macro.energyPrices.items.filter((item) => item.label === "WTI 原油" || item.label === "Brent 原油"),
    "global-policy": allPolicyRates,
    "us-china-energy": usChinaEnergy,
    "henry-hub": macro.energyPrices.items.filter((item) => item.label === "Henry Hub 天然气"),
    "macro-news": macro.geopoliticalNews.items
  };
  return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-sky-700">First-layer focus</p><h3 className="mt-1 text-base font-extrabold text-slate-900">第一层核心宏观 Watchlist</h3><p className="mt-1 text-xs leading-5 text-slate-600">排名为长期观察优先级，不代表当前市场强弱或交易机会。</p></div><div className="mt-4 hidden overflow-x-auto md:block"><table className="min-w-full text-left text-xs"><thead className="border-y border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th scope="col" className="px-3 py-2">Rank</th><th scope="col" className="px-3 py-2">核心观察项</th><th scope="col" className="px-3 py-2">主要主题</th><th scope="col" className="px-3 py-2">优先追踪原因</th><th scope="col" className="px-3 py-2">当前数据状态</th></tr></thead><tbody>{CORE_WATCHLIST_RANKS.map((entry) => <tr key={entry.key} className="border-b border-slate-100 align-top"><td className="px-3 py-3 font-extrabold text-sky-800">{entry.rank}</td><td className="px-3 py-3 font-bold text-slate-800">{entry.item}</td><td className="px-3 py-3 text-slate-600">{entry.theme}</td><td className="px-3 py-3 text-slate-600">{entry.reason}</td><td className="px-3 py-3"><StatusBadge status={getMacroDataStatus(rankItems[entry.key] ?? [])} /></td></tr>)}</tbody></table></div><div className="mt-4 grid grid-cols-1 gap-3 md:hidden">{CORE_WATCHLIST_RANKS.map((entry) => <article key={entry.key} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><p className="text-xs font-extrabold text-slate-800">{entry.rank}. {entry.item}</p><StatusBadge status={getMacroDataStatus(rankItems[entry.key] ?? [])} /></div><p className="mt-1 text-[11px] text-sky-800">{entry.theme}</p><p className="mt-2 text-[11px] leading-5 text-slate-600">{entry.reason}</p></article>)}</div></section>;
}

export function GlobalMacroReferencePanel() {
  const [data, setData] = useState<GlobalMacroReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setRequestError(null);
    try { const response = await fetch("/api/global/macro"); if (!response.ok) throw new Error(`HTTP ${response.status}`); setData(await response.json() as GlobalMacroReference); }
    catch (error) { const reason = error instanceof Error ? error.message : "未知错误"; setRequestError(reason); setData(emptyMacro("全球宏观主题 Watchlist 暂时不可用，请稍后再试")); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const macro = data ?? emptyMacro("数据载入中");
  const energyItems = [...macro.energyPrices.items, ...macro.preciousMetals.items];
  const rateItems = (macro.centralBankRates.countries ?? []).flatMap((group) => group.items);
  const supplyItems = (macro.countryEnergy.countries ?? []).flatMap((group) => group.items);
  const newsItems = macro.geopoliticalNews.items;
  const themeStatus = {
    energy: getMacroDataStatus(energyItems), rates: getMacroDataStatus(rateItems), supply: getMacroDataStatus(supplyItems), news: getMacroDataStatus(newsItems)
  };
  return <section id="global-macro-reference" className="overflow-hidden rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-indigo-50 shadow-sm"><header className="border-b border-sky-100 bg-white/80 px-4 py-5 sm:px-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-700 text-white shadow-sm"><Globe2 className="h-5 w-5" /></div><div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-sky-700">Global macro reference</p><h2 className="mt-1 text-lg font-extrabold text-slate-900">全球宏观主题 Watchlist</h2><p className="mt-1 text-xs font-semibold text-sky-800">{WATCHLIST_SUBTITLE}</p><p className="mt-2 text-[11px] leading-5 text-slate-600">{macro.dataNature} · 面板生成：{formatTime(macro.generatedAt)}{macro.isStale ? " · 部分为服务端旧缓存" : ""}</p></div></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-800 shadow-sm transition hover:bg-sky-50 disabled:opacity-50">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}重新加载</button></div></header><div className="space-y-6 px-4 py-5 sm:px-6">{loading && !data ? <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{[1, 2, 3, 4].map((index) => <div key={index} className="h-56 animate-pulse rounded-2xl bg-sky-100/70" />)}</div> : <>{!macro.available ? <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900"><ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" /><div className="text-xs leading-5"><p className="font-bold">暂时没有可验证的宏观数据</p><p>{macro.unavailableReason || UNAVAILABLE_TEXT}</p></div></div> : null}{requestError ? <div className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><AlertTriangle className="h-4 w-4 shrink-0" />请求失败：{requestError}</div> : null}<section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]"><article className="rounded-3xl border border-sky-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-sky-800"><BookOpen className="h-4 w-4" /><h3 className="text-sm font-extrabold">用途</h3></div><p className="mt-2 text-xs leading-6 text-slate-600">{WATCHLIST_PURPOSE}</p></article><article className="rounded-3xl border border-indigo-200 bg-indigo-50/40 p-4"><div className="flex items-center gap-2 text-indigo-800"><Target className="h-4 w-4" /><h3 className="text-sm font-extrabold">核心观察优先级</h3></div><div className="mt-3 flex flex-wrap gap-2">{CORE_PRIORITIES.map((priority) => <span key={priority} className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-800">{priority}</span>)}</div></article></section><p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">{WATCHLIST_DATA_NOTICE}</p><WatchlistOverview macro={macro} /><ThemeFrame framework={THEME_FRAMEWORKS[0]} status={themeStatus.energy}><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{energyItems.map((item) => <MetricCard key={item.label} item={item} framework={ENERGY_METRIC_FRAMEWORK[item.label]} />)}</div></ThemeFrame><ThemeFrame framework={THEME_FRAMEWORKS[1]} status={themeStatus.rates}><CountryWatchlist section={macro.centralBankRates} defaultOpenCountry="美国" /></ThemeFrame><ThemeFrame framework={THEME_FRAMEWORKS[2]} status={themeStatus.supply}><CountryWatchlist section={macro.countryEnergy} defaultOpenCountry="美国" /></ThemeFrame><ThemeFrame framework={THEME_FRAMEWORKS[3]} status={themeStatus.news}><div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{newsItems.map((item, index) => <MetricCard key={`${item.label}-${index}`} item={item} />)}</div></ThemeFrame><CriticalMineralsPanel section={macro.criticalMinerals} /><CoreRankTable macro={macro} /><section className="grid grid-cols-1 gap-4 lg:grid-cols-2"><article className="rounded-3xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-slate-800"><Activity className="h-4 w-4" /><h3 className="text-sm font-extrabold">核心判断区域</h3></div><p className="mt-2 text-xs leading-6 text-slate-600">{CORE_JUDGMENT_NOTICE}</p></article><article className="rounded-3xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-slate-800"><Layers3 className="h-4 w-4" /><h3 className="text-sm font-extrabold">使用方式</h3></div><p className="mt-2 text-xs leading-6 text-slate-600">{USAGE_NOTICE}</p><div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="flex items-center gap-1.5 text-[11px] font-extrabold text-slate-700"><ListChecks className="h-3.5 w-3.5" />监测顺序</p><ol className="mt-2 space-y-1 text-[11px] leading-5 text-slate-600">{MONITORING_SEQUENCE.map((step, index) => <li key={step}>{index + 1}. {step}</li>)}</ol></div></article></section><footer className="rounded-2xl border border-slate-200 bg-slate-900 px-4 py-3 text-xs leading-5 text-slate-200"><span className="font-extrabold text-white">免责声明：</span>{WATCHLIST_DISCLAIMER}<span className="block pt-1 text-slate-400">{WATCHLIST_PRIORITY_NOTICE}</span></footer></>}</div></section>;
}
