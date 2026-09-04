import type { GlobalMacroReference } from "../types.js";

export interface GlobalMacroResponse {
  data: GlobalMacroReference;
  requestId: string;
  refreshStatus: string | null;
}

let normalInFlight: Promise<GlobalMacroResponse> | null = null;
let manualInFlight: Promise<GlobalMacroResponse> | null = null;
let latestResponse: GlobalMacroResponse | null = null;

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `macro-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function requestGlobalMacro(manual: boolean): Promise<GlobalMacroResponse> {
  const requestId = createRequestId();
  const url = manual ? `/api/global/macro?refresh=1&t=${Date.now()}` : "/api/global/macro";
  const response = await fetch(url, {
    cache: manual ? "no-store" : "default",
    headers: {
      Accept: "application/json",
      "X-Macro-Request-Id": requestId,
      ...(manual ? { "Cache-Control": "no-cache" } : {})
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as GlobalMacroReference;
  const result: GlobalMacroResponse = { data, requestId, refreshStatus: response.headers.get("X-Macro-Refresh-Status") };
  latestResponse = result;
  return result;
}

/**
 * Shares an in-flight request across component mounts (including development StrictMode),
 * then retains the received payload for the current page lifetime. A manual result replaces it.
 */
export function loadSharedGlobalMacro(manual = false): Promise<GlobalMacroResponse> {
  if (!manual && latestResponse) return Promise.resolve(latestResponse);
  const existing = manual ? manualInFlight : normalInFlight;
  if (existing) return existing;
  const operation = requestGlobalMacro(manual).finally(() => {
    if (manual) manualInFlight = null;
    else normalInFlight = null;
  });
  if (manual) manualInFlight = operation;
  else normalInFlight = operation;
  return operation;
}
