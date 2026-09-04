import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const macro = readFileSync(new URL("./api/global/macro.ts", import.meta.url), "utf8");
const component = readFileSync(new URL("./src/components/GlobalMacroReference.tsx", import.meta.url), "utf8");
const fred = readFileSync(new URL("./lib/providers/fred.ts", import.meta.url), "utf8");
const eia = readFileSync(new URL("./lib/providers/eia.ts", import.meta.url), "utf8");
const gdelt = readFileSync(new URL("./lib/providers/gdelt.ts", import.meta.url), "utf8");
const mining = readFileSync(new URL("./lib/providers/mineral-rss.ts", import.meta.url), "utf8");

const assertions = {
  frontend_refresh_url_has_nonce: component.includes('`/api/global/macro?refresh=1&_=${Date.now()}`'),
  frontend_bypasses_browser_cache: component.includes('cache: "no-store"') && component.includes('"Cache-Control": "no-cache"'),
  frontend_does_not_reload_document: !component.includes("location.reload"),
  frontend_prevents_double_click: component.includes("disabled={loading || refreshing}") && component.includes("if (refreshing || loading) return"),
  frontend_keeps_existing_data_after_manual_error: component.includes("if (!manual) setData(emptyMacro"),
  frontend_displays_refresh_progress: component.includes('refreshing ? "正在刷新…"') && component.includes("animate-spin"),
  frontend_feedback_auto_hides: component.includes("window.setTimeout(() => setRefreshFeedback(null), 4_000)"),
  frontend_exposes_news_cache_metadata: component.includes("缓存更新时间：{formatTime(item.cacheUpdatedAt)}") && component.includes("缓存状态：{cacheStatusLabel[item.cacheStatus]}"),
  backend_recognizes_refresh_parameter: macro.includes("function isRefreshRequest") && macro.includes('value === "1"'),
  backend_has_nine_second_limit: macro.includes("MANUAL_REFRESH_TIMEOUT_MS = 9_000"),
  backend_clears_wait_timer: macro.includes("clearTimeout(timer)"),
  backend_single_flight: macro.includes("let manualRefreshInFlight") && macro.includes("if (manualRefreshInFlight) return manualRefreshInFlight"),
  backend_manual_response_is_not_cached: macro.includes('res.setHeader("Cache-Control", "private, no-store")'),
  backend_merges_previous_sections: macro.includes("function mergeWithPrevious") && macro.includes("mergeItemsWithPrevious") && macro.includes("mergeNewsSectionWithPrevious"),
  backend_forces_each_provider_cache_path: macro.includes('getFredLatestObservation("DCOILWTICO", { forceRefresh })') && macro.includes('getEiaCountryEnergy(definition, { forceRefresh })') && macro.includes('getGdeltRecentArticles("geopolitical", { forceRefresh })') && macro.includes('getMiningComMineralNews({ forceRefresh })'),
  fred_force_refresh_preserves_lkg: fred.includes("export interface FredRefreshOptions") && fred.includes("fresh && options.forceRefresh ? { ...fresh, isStale: true }") && fred.includes("if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null)"),
  eia_force_refresh_preserves_lkg: eia.includes("export interface EiaRefreshOptions") && eia.includes("fresh && options.forceRefresh ? { ...fresh, isStale: true }") && eia.includes("if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null)"),
  gdelt_force_refresh_respects_cooldown: gdelt.includes("export interface GdeltRefreshOptions") && gdelt.includes("if (!inCooldown) startRefresh(key, category)") && gdelt.includes("const reusableEntry = stale ?? (options.forceRefresh ? cache.get(key) ?? null : null)"),
  mining_force_refresh_preserves_lkg: mining.includes("export interface MineralRssRefreshOptions") && mining.includes("const fallback = stale ?? (fresh && options.forceRefresh ? { ...fresh, isStale: true } : null)"),
};

for (const [name, passed] of Object.entries(assertions)) assert.equal(passed, true, name);
console.log(JSON.stringify({ passed: true, assertionCount: Object.keys(assertions).length, assertions }, null, 2));
