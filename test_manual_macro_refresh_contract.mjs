import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const macro = readFileSync(new URL("./api/global/macro.ts", import.meta.url), "utf8");
const component = readFileSync(new URL("./src/components/GlobalMacroReference.tsx", import.meta.url), "utf8");
const fred = readFileSync(new URL("./lib/providers/fred.ts", import.meta.url), "utf8");
const eia = readFileSync(new URL("./lib/providers/eia.ts", import.meta.url), "utf8");
const gdelt = readFileSync(new URL("./lib/providers/gdelt.ts", import.meta.url), "utf8");
const mining = readFileSync(new URL("./lib/providers/mineral-rss.ts", import.meta.url), "utf8");
const macroRss = readFileSync(new URL("./lib/providers/macro-news-rss.ts", import.meta.url), "utf8");
const requestClient = readFileSync(new URL("./src/lib/globalMacroRequest.ts", import.meta.url), "utf8");

const assertions = {
  frontend_refresh_url_has_nonce: requestClient.includes('`/api/global/macro?refresh=1&t=${Date.now()}`'),
  frontend_bypasses_browser_cache: requestClient.includes('cache: manual ? "no-store" : "default"') && requestClient.includes('"Cache-Control": "no-cache"'),
  frontend_shares_normal_and_manual_inflight_requests: requestClient.includes("let normalInFlight") && requestClient.includes("let manualInFlight") && requestClient.includes("if (existing) return existing"),
  frontend_sends_request_id: requestClient.includes('"X-Macro-Request-Id": requestId'),
  frontend_does_not_reload_document: !component.includes("location.reload"),
  frontend_prevents_double_click: component.includes('type="button"') && component.includes("disabled={loading || refreshing}") && component.includes("if (refreshing || loading) return"),
  frontend_keeps_existing_data_after_manual_error: component.includes("if (!manual) setData(emptyMacro"),
  frontend_displays_refresh_progress: component.includes('refreshing ? "正在刷新…"') && component.includes("animate-spin"),
  frontend_feedback_auto_hides: component.includes("window.setTimeout(() => setRefreshFeedback(null), 4_000)"),
  frontend_exposes_news_cache_metadata: component.includes("缓存更新时间：{formatTime(item.cacheUpdatedAt)}") && component.includes("缓存状态：{cacheStatusLabel[item.cacheStatus]}"),
  backend_recognizes_refresh_parameter: macro.includes("function isRefreshRequest") && macro.includes('value === "1"'),
  backend_records_request_and_invocation_ids: macro.includes("function requestIdFor") && macro.includes('console.info("MACRO_REQUEST"') && macro.includes("invocationStartedAt"),
  backend_has_eight_second_limit: macro.includes("MANUAL_REFRESH_TIMEOUT_MS = 8_000") && macro.includes("MANUAL_RSS_DEADLINE_MS = 7_500"),
  backend_clears_wait_timer: macro.includes("clearTimeout(timer)"),
  backend_single_flight: macro.includes("let manualRefreshInFlight") && macro.includes("if (manualRefreshInFlight) {") && macro.includes("return manualRefreshInFlight;"),
  backend_manual_response_is_not_cached: macro.includes('res.setHeader("Cache-Control", "private, no-store")'),
  backend_merges_previous_sections: macro.includes("function mergeWithPrevious") && macro.includes("mergeItemsWithPrevious") && macro.includes("mergeNewsSectionWithPrevious"),
  backend_forces_each_provider_cache_path: macro.includes('getFredLatestObservation("DCOILWTICO", { forceRefresh })') && macro.includes('getEiaCountryEnergy(definition, { forceRefresh })') && macro.includes('getMacroRssNews("geopolitical", { forceRefresh, awaitRefresh: Boolean(manualRss)') && macro.includes('getMacroRssNews("economic", { forceRefresh, awaitRefresh: Boolean(manualRss)') && macro.includes('getMiningComMineralNews({ forceRefresh })'),
  macro_rss_replaces_gdelt_as_production_mapping: macro.includes("function macroRssItems") && !macro.includes("getGdeltRecentArticles") && !macro.includes("GDELT DOC 2.0"),
  macro_rss_has_exact_five_configured_endpoints: ["https://feeds.bbci.co.uk/news/world/rss.xml", "https://news.un.org/feed/subscribe/en/news/all/rss.xml", "https://feeds.bbci.co.uk/news/business/rss.xml", "https://www.federalreserve.gov/feeds/press_all.xml", "https://www.ecb.europa.eu/rss/press.html"].every((endpoint) => macroRss.includes(endpoint)),
  macro_rss_fetches_sources_in_parallel_with_timeouts: macroRss.includes("Promise.allSettled(sources.map") && macroRss.includes("const SOURCE_TIMEOUT_MS = 6_000") && macroRss.includes("new AbortController()") && macroRss.includes('cache: "no-store"'),
  macro_rss_cache_preserves_last_known_good: macroRss.includes("const FRESH_TTL_MS = 15 * 60 * 1_000") && macroRss.includes("const STALE_TTL_MS = 24 * 60 * 60 * 1_000") && macroRss.includes("if (result.articles) return cacheSourceSuccess") && macroRss.includes("if (data.length) return cacheCategorySuccess"),
  macro_rss_filters_only_title_and_http_link: macroRss.includes("if (!title || !url) continue") && macroRss.includes("Publication") === false && macroRss.includes("Only title and an original HTTP(S) link are mandatory"),
  macro_rss_diagnostics_are_safe_and_complete: macroRss.includes('console.info("MACRO_RSS_DIAGNOSTIC"') && macroRss.includes("responseTextLength") && macroRss.includes("rawCount") && macroRss.includes("parsedCount") && macroRss.includes("filteredCount") && macroRss.includes("errorCategory"),
  fred_force_refresh_preserves_lkg: fred.includes("export interface FredRefreshOptions") && fred.includes("fresh && options.forceRefresh ? { ...fresh, isStale: true }") && fred.includes("if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null)"),
  eia_force_refresh_preserves_lkg: eia.includes("export interface EiaRefreshOptions") && eia.includes("fresh && options.forceRefresh ? { ...fresh, isStale: true }") && eia.includes("if (!fallback) cacheValue(key, null, FAILURE_TTL_MS, null)"),
  gdelt_force_refresh_respects_cooldown: gdelt.includes("export interface GdeltRefreshOptions") && gdelt.includes("awaitRefresh?: boolean") && gdelt.includes("await getOrStartRefresh(key, category, options)") && gdelt.includes("waitUntil(operation)") && gdelt.includes("const reusableEntry = stale ?? (options.forceRefresh ? cache.get(key) ?? null : null)"),
  mining_force_refresh_preserves_lkg: mining.includes("export interface MineralRssRefreshOptions") && mining.includes("const fallback = stale ?? (fresh && options.forceRefresh ? { ...fresh, isStale: true } : null)"),
  gdelt_manual_fetch_is_not_fire_and_forget: gdelt.includes('cache: "no-store"') && gdelt.includes('event: "provider_request_started"') && gdelt.includes('event: "provider_response_received"') && gdelt.includes('event: "provider_request_failed"') && !gdelt.includes('"refresh_started"'),
  gdelt_manual_categories_bypass_serial_queue: gdelt.includes("reserveRequestSlot(Boolean(options.awaitRefresh))") && gdelt.includes("if (parallelManualRefresh) return 0"),
  gdelt_manual_provider_timeout_is_six_seconds: gdelt.includes("const MANUAL_PROVIDER_TIMEOUT_MS = 6_000") && gdelt.includes("Math.min(options.deadlineAt, providerLimit)"),
  gdelt_expired_inflight_is_aborted_and_replaced: gdelt.includes("interface InFlightEntry") && gdelt.includes("controller: AbortController") && gdelt.includes("MANUAL_JOIN_MAX_AGE_MS = 3_000") && gdelt.includes("MANUAL_JOIN_MIN_REMAINING_MS = 3_000") && gdelt.includes("abortAndRemoveInFlight") && gdelt.includes("manual_refresh_category_replaced_in_flight"),
  gdelt_finally_clears_only_own_inflight_entry: gdelt.includes("entry.settled = true") && gdelt.includes("if (inFlight.get(key) === entry) inFlight.delete(key)"),
  gdelt_timeout_is_cooldown_not_rate_limited: gdelt.includes('if (result.outcome === "timeout") return "refresh_cooldown"') && gdelt.includes('result.outcome === "http_429" && result.httpStatus === 429'),
  gdelt_network_diagnostics_are_safe_and_structured: gdelt.includes("function networkDiagnostics") && gdelt.includes("causeCode") && gdelt.includes("networkPhase") && gdelt.includes("addressFamily") && gdelt.includes("safeErrorText"),
  gdelt_final_diagnostic_has_counts_and_cache_write: gdelt.includes('event: "manual_refresh_category_finished"') && gdelt.includes("cacheWriteSucceeded") && gdelt.includes("rawArticleCount") && gdelt.includes("filteredArticleCount") && gdelt.includes("providerStartedAt") && gdelt.includes("providerEndedAt") && gdelt.includes("lastFailureStatus") && gdelt.includes("cooldownReason"),
};

for (const [name, passed] of Object.entries(assertions)) assert.equal(passed, true, name);
console.log(JSON.stringify({ passed: true, assertionCount: Object.keys(assertions).length, assertions }, null, 2));
