import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { GlobalMacroReference, GlobalMacroSection, GlobalMacroSource } from "../../src/types.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MACRO_CACHE_TTL_MS = 30 * 60 * 1_000;
const MACRO_TIMEOUT_MS = 25_000;
const DATA_NATURE = "AI 聯網搜尋整理，非即時行情，僅供參考" as const;
const UNAVAILABLE_TEXT = "暫無可靠資料";

interface GeminiModelInfo {
  name?: string;
  supportedGenerationMethods?: string[];
  supportedActions?: string[];
}

interface GeminiModelsListResponse {
  models?: GeminiModelInfo[];
}

interface GeminiGroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiGroundingMetadata {
  groundingChunks?: GeminiGroundingChunk[];
  webSearchQueries?: string[];
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  groundingMetadata?: GeminiGroundingMetadata;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

interface MacroDraft {
  criticalMinerals?: string;
  energyCommodities?: string;
  preciousMetals?: string;
  geopolitics?: string;
  countryNews?: string;
}

interface CachedMacro {
  value: GlobalMacroReference;
  expiresAt: number;
}

let macroCache: CachedMacro | null = null;

function section(title: string, summary = UNAVAILABLE_TEXT, sources: GlobalMacroSource[] = []): GlobalMacroSection {
  return { title, summary, sources };
}

function unavailable(reason: string): GlobalMacroReference {
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

function text(value: unknown, limit = 1_200): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function unwrapJson(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function hasGenerateContentSupport(model: GeminiModelInfo): boolean {
  const methods = [
    ...(Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : []),
    ...(Array.isArray(model.supportedActions) ? model.supportedActions : [])
  ];
  return methods.includes("generateContent");
}

function normalizeModelName(name: string | undefined): string | null {
  if (!name) return null;
  const value = name.startsWith("models/") ? name.slice("models/".length) : name;
  return value.startsWith("gemini-") ? value : null;
}

function isSearchCapableFlash(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes("gemini")
    && lower.includes("flash")
    && !["image", "live", "tts", "audio", "robotics"].some((term) => lower.includes(term));
}

function modelVersion(model: string): [number, number, number] {
  const match = model.match(/gemini-(\d+)(?:\.(\d+))?(?:\.(\d+))?-flash/);
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : [0, 0, 0];
}

function selectMacroModel(models: GeminiModelInfo[]): string | null {
  const candidates = models
    .filter(hasGenerateContentSupport)
    .map((item) => normalizeModelName(item.name))
    .filter((model): model is string => Boolean(model && isSearchCapableFlash(model)))
    .sort((left, right) => {
      const [leftMajor, leftMinor, leftPatch] = modelVersion(left);
      const [rightMajor, rightMinor, rightPatch] = modelVersion(right);
      return rightMajor - leftMajor || rightMinor - leftMinor || rightPatch - leftPatch || left.localeCompare(right);
    });
  return candidates[0] ?? null;
}

function toSources(metadata: GeminiGroundingMetadata | undefined): GlobalMacroSource[] {
  const seen = new Set<string>();
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  return chunks.flatMap((chunk) => {
    const url = text(chunk.web?.uri, 2_000);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ title: text(chunk.web?.title, 200) || url, url }];
  });
}

async function resolveMacroModel(apiKey: string, signal: AbortSignal): Promise<string | null> {
  const modelsUrl = new URL(`${GEMINI_BASE_URL}/models`);
  modelsUrl.searchParams.set("key", apiKey);
  const response = await fetch(modelsUrl.toString(), { headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    console.warn("Macro models.list failed", { status: response.status, endpoint: modelsUrl.origin + modelsUrl.pathname });
    return null;
  }
  const body = await response.json() as GeminiModelsListResponse;
  return selectMacroModel(Array.isArray(body.models) ? body.models : []);
}

function systemInstruction(): string {
  return "你是全球宏觀參考整理器。必須使用 Google Search tool 取得近期公開資訊。所有輸出使用繁體中文，禁止捏造精確價格、報價、百分比、日期或事件。只在來源可支持時說明趨勢；否則寫『暫無可靠資料』。只輸出一個合法 JSON 物件，不使用 Markdown 或程式碼區塊。";
}

function prompt(): string {
  return `請搜尋並整理下列全球宏觀主題。每一項都只能提供定性趨勢與已搜尋到的公開資訊；不得創造精確價格或未支持的事實。輸出 JSON：
{
  "criticalMinerals": "鋰、鈷、稀土的近期供需／價格趨勢定性整理，或暫無可靠資料",
  "energyCommodities": "原油、天然氣的近期價格趨勢定性整理，或暫無可靠資料",
  "preciousMetals": "黃金與其他重要貴金屬的近期趨勢定性整理，或暫無可靠資料",
  "geopolitics": "重大地緣政治動態與世界格局的定性整理，或暫無可靠資料",
  "countryNews": "各國重大新聞摘要，或暫無可靠資料"
}`;
}

async function generateMacro(): Promise<GlobalMacroReference> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return unavailable("GEMINI_API_KEY 未設定，無法執行聯網搜尋");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MACRO_TIMEOUT_MS);
  try {
    const model = await resolveMacroModel(apiKey, controller.signal);
    if (!model) return unavailable("未找到可用的 Google Search Grounding Flash model");

    const endpointUrl = new URL(`${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`);
    endpointUrl.searchParams.set("key", apiKey);
    const response = await fetch(endpointUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction() }] },
        contents: [{ role: "user", parts: [{ text: prompt() }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });

    const endpoint = endpointUrl.origin + endpointUrl.pathname;
    if (!response.ok) {
      const responsePreview = (await response.text()).slice(0, 800);
      console.warn("Global macro Gemini grounding failed", { status: response.status, model, endpoint, responsePreview });
      return unavailable(`Google Search Grounding 暫時不可用（HTTP ${response.status}）`);
    }

    const body = await response.json() as GeminiResponse;
    const candidate = body.candidates?.[0];
    const rawText = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
    const metadata = candidate?.groundingMetadata;
    const sources = toSources(metadata);
    const queries = Array.isArray(metadata?.webSearchQueries) ? metadata.webSearchQueries.map((query) => text(query, 300)).filter(Boolean).slice(0, 12) : [];

    console.info("Global macro Gemini grounding response", {
      model,
      endpoint,
      rawTextSample: rawText.slice(0, 2_000),
      sourceCount: sources.length,
      searchQueries: queries
    });

    if (!rawText) return unavailable("Google Search Grounding 未回傳可用內容");
    if (sources.length === 0 && queries.length === 0) return unavailable("Google Search Grounding 未提供可驗證的搜尋來源");

    let draft: MacroDraft;
    try {
      draft = JSON.parse(unwrapJson(rawText)) as MacroDraft;
    } catch (error) {
      console.error("Global macro JSON parse failed", { model, reason: error instanceof Error ? error.message : String(error), rawText });
      return unavailable("Google Search Grounding 回應格式無法驗證");
    }

    const generatedAt = new Date().toISOString();
    const value: GlobalMacroReference = {
      available: true,
      dataNature: DATA_NATURE,
      generatedAt,
      cachedAt: generatedAt,
      isStale: false,
      model,
      searchQueries: queries,
      sources,
      criticalMinerals: section("關鍵礦產（鋰、鈷、稀土）", text(draft.criticalMinerals) || UNAVAILABLE_TEXT, sources),
      energyCommodities: section("能源商品（原油、天然氣）", text(draft.energyCommodities) || UNAVAILABLE_TEXT, sources),
      preciousMetals: section("黃金／貴金屬", text(draft.preciousMetals) || UNAVAILABLE_TEXT, sources),
      geopolitics: section("重大地緣政治動態與世界格局", text(draft.geopolitics) || UNAVAILABLE_TEXT, sources),
      countryNews: section("各國重大新聞摘要", text(draft.countryNews) || UNAVAILABLE_TEXT, sources),
      unavailableReason: null
    };
    macroCache = { value, expiresAt: Date.now() + MACRO_CACHE_TTL_MS };
    return value;
  } catch (error) {
    console.error("Global macro request failed; returning null-safe fallback", error instanceof Error ? error.message : String(error));
    return unavailable("全球宏觀搜尋暫時不可用，請稍後再試");
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (macroCache && macroCache.expiresAt > Date.now()) {
    const value = { ...macroCache.value, cachedAt: macroCache.value.generatedAt, isStale: false };
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(value);
    return;
  }

  const value = await generateMacro();
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  res.status(200).json(value);
}
