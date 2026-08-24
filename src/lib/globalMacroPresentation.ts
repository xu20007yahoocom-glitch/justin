import type { GlobalMacroItem } from "../types.js";

export type MacroDataStatus = "complete" | "partial" | "unavailable";

export const UNAVAILABLE_TEXT = "暂无可靠资料";

export function isVerifiedMacroItem(item: GlobalMacroItem | null | undefined): item is GlobalMacroItem {
  return Boolean(item && item.available && item.value.trim() && item.dataTime && item.source);
}

export function getMacroDataStatus(items: readonly (GlobalMacroItem | null | undefined)[]): MacroDataStatus {
  const defined = items.filter((item): item is GlobalMacroItem => Boolean(item));
  const verifiedCount = defined.filter(isVerifiedMacroItem).length;
  if (verifiedCount === 0) return "unavailable";
  return verifiedCount === defined.length ? "complete" : "partial";
}

export function macroStatusLabel(status: MacroDataStatus): string {
  if (status === "complete") return "数据较完整";
  if (status === "partial") return "部分数据可用";
  return UNAVAILABLE_TEXT;
}

export function macroStatusClass(status: MacroDataStatus): string {
  if (status === "complete") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "partial") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

/** Formats display only. It never feeds the formatted text back into calculation or API state. */
export function formatMacroValue(item: GlobalMacroItem): string {
  if (!isVerifiedMacroItem(item)) return UNAVAILABLE_TEXT;
  const normalized = item.value.replace(/,/g, "").trim();
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return item.value;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(numeric);
}

export function frequencyLabel(item: GlobalMacroItem): string {
  const note = item.note ?? "";
  const normalized = note.toLowerCase();
  if (normalized.includes("monthly") || note.includes("月度")) return "月度";
  if (normalized.includes("annual") || note.includes("年度")) return "年度";
  if (normalized.includes("quarterly") || note.includes("季度")) return "季度";
  if (normalized.includes("weekly") || note.includes("周度")) return "周度";
  if (normalized.includes("daily") || note.includes("日度")) return "日度";
  return "频率以来源标记为准";
}

export function verifiedCount(items: readonly GlobalMacroItem[]): number {
  return items.filter(isVerifiedMacroItem).length;
}
