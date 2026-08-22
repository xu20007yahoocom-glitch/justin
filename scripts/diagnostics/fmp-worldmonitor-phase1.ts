type DiagnosticRecord = {
  provider: "fmp" | "worldmonitor";
  endpoint: string;
  attempted: boolean;
  status: number | null;
  ok: boolean;
  contentType: string | null;
  topLevelKeys: string[];
  itemCount: number | null;
  sampleItemKeys: string[];
  errorPreview: string | null;
};

function summariseBody(body: unknown): Pick<DiagnosticRecord, "topLevelKeys" | "itemCount" | "sampleItemKeys"> {
  if (Array.isArray(body)) {
    const first = body[0];
    return {
      topLevelKeys: [],
      itemCount: body.length,
      sampleItemKeys: first && typeof first === "object" ? Object.keys(first as Record<string, unknown>).sort() : [],
    };
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const firstArray = Object.values(record).find(Array.isArray);
    const firstItem = Array.isArray(firstArray) ? firstArray[0] : undefined;
    return {
      topLevelKeys: Object.keys(record).sort(),
      itemCount: Array.isArray(firstArray) ? firstArray.length : null,
      sampleItemKeys: firstItem && typeof firstItem === "object" ? Object.keys(firstItem as Record<string, unknown>).sort() : [],
    };
  }

  return { topLevelKeys: [], itemCount: null, sampleItemKeys: [] };
}

async function inspect(
  provider: DiagnosticRecord["provider"],
  endpoint: string,
  init: RequestInit,
  hasKey: boolean,
): Promise<DiagnosticRecord> {
  if (!hasKey) {
    return {
      provider,
      endpoint,
      attempted: false,
      status: null,
      ok: false,
      contentType: null,
      topLevelKeys: [],
      itemCount: null,
      sampleItemKeys: [],
      errorPreview: "missing API key in this runtime",
    };
  }

  try {
    const response = await fetch(endpoint, init);
    const contentType = response.headers.get("content-type");
    const raw = await response.text();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }

    return {
      provider,
      endpoint: endpoint.replace(/([?&]apikey=)[^&]+/, "$1REDACTED"),
      attempted: true,
      status: response.status,
      ok: response.ok,
      contentType,
      ...summariseBody(body),
      errorPreview: response.ok ? null : raw.slice(0, 500),
    };
  } catch (error) {
    return {
      provider,
      endpoint: endpoint.replace(/([?&]apikey=)[^&]+/, "$1REDACTED"),
      attempted: true,
      status: null,
      ok: false,
      contentType: null,
      topLevelKeys: [],
      itemCount: null,
      sampleItemKeys: [],
      errorPreview: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const fmpKey = process.env.FMP_API_KEY?.trim() ?? "";
  const worldMonitorKey = process.env.WORLDMONITOR_API_KEY?.trim() ?? "";
  const fmpUrl = new URL("https://financialmodelingprep.com/stable/company-screener");
  fmpUrl.searchParams.set("exchange", "NASDAQ");
  fmpUrl.searchParams.set("volumeMoreThan", "1000000");
  fmpUrl.searchParams.set("marketCapMoreThan", "1000000000");
  fmpUrl.searchParams.set("limit", "5");
  fmpUrl.searchParams.set("apikey", fmpKey);

  const wmBase = "https://api.worldmonitor.app";
  const wmHeaders = { "X-WorldMonitor-Key": worldMonitorKey };
  const report = {
    generatedAt: new Date().toISOString(),
    fmpApiKeyPresent: Boolean(fmpKey),
    worldMonitorApiKeyPresent: Boolean(worldMonitorKey),
    records: await Promise.all([
      inspect("fmp", fmpUrl.toString(), {}, Boolean(fmpKey)),
      inspect("worldmonitor", `${wmBase}/api/supply-chain/v1/get-critical-minerals`, { headers: wmHeaders }, Boolean(worldMonitorKey)),
      inspect("worldmonitor", `${wmBase}/api/economic/v1/get-energy-prices`, { headers: wmHeaders }, Boolean(worldMonitorKey)),
      inspect("worldmonitor", `${wmBase}/api/conflict/v1/list-acled-events?page_size=3`, { headers: wmHeaders }, Boolean(worldMonitorKey)),
      inspect("worldmonitor", `${wmBase}/api/news/v1/list-feed-digest?variant=commodity`, { headers: wmHeaders }, Boolean(worldMonitorKey)),
    ]),
  };

  console.log("FMP and World Monitor phase-one diagnostics:", JSON.stringify(report, null, 2));
}

void main();
