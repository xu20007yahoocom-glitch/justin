import type { VercelRequest, VercelResponse } from "@vercel/node";
import { STOCKS_METADATA, fetchStockFromYahoo } from "../lib/stocksData.js";
import { buildAnalysisContext } from "../lib/analysisData.js";
import { getSimulatedAnalysis } from "../lib/simulatedAnalysis.js";
import { buildDataLimitations, computeTechnicalIndicators, deriveConfidence } from "../lib/technicalIndicators.js";
import type {
  AnalysisContext,
  AnalysisResult,
  Catalyst,
  CatalystDirection,
  CompetitiveAdvantage,
  Competitor,
  RevenueBusiness,
  SourcedField
} from "../src/types.js";

// Gemini 2.5 Flash is the stable default. An explicit environment override is useful
// when a Google project exposes a different current model set.
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_TIMEOUT_MS = 15_000;
const AI_CONFIDENCE = "AI 綜合判斷，非即時財報數據" as const;

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

interface GeminiModelInfo {
  name?: string;
  supportedGenerationMethods?: string[];
  supportedActions?: string[];
}

interface GeminiModelsListResponse {
  models?: GeminiModelInfo[];
}

interface GeminiAnalysisDraft {
  recommendation?: "BUY" | "HOLD" | "SELL" | "NEUTRAL";
  recommendationReason?: string;
  confidenceLevel?: "high" | "medium" | "low";
  summary?: string;
  outlook?: string;
  risks?: unknown[];
  technicalSummary?: {
    movingAverageNote?: string;
    momentumNote?: string;
    volumePriceNote?: string;
    summary?: string;
  };
  valuation?: {
    assessment?: "UNDERVALUED" | "FAIR" | "OVERVALUED" | "INSUFFICIENT_DATA";
    reasoning?: string;
  };
  oneLineSummary?: string;
  companyPositioning?: string;
  catalysts?: Array<{
    title?: string;
    direction?: CatalystDirection;
    rationale?: string;
    evidence?: string;
  }>;
  topRevenueBusinesses?: Array<{ name?: string; description?: string }>;
  competitors?: Array<{ name?: string; comparison?: string }>;
  competitiveAdvantage?: { summary?: string; limitations?: string };
}

function localeToLanguageInstruction(locale: string): string {
  const normalized = (locale || "").toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk") || normalized === "zh-hant") {
    return "繁體中文（台灣用語）";
  }
  if (normalized.startsWith("zh")) return "繁體中文";
  if (normalized.startsWith("ja")) return "日本語";
  if (normalized.startsWith("ko")) return "한국어";
  if (normalized.startsWith("en")) return "English";
  return "繁體中文";
}

function text(value: unknown, limit = 800): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function aiField(value: string): SourcedField<string> {
  return {
    value: value || null,
    dataConfidence: AI_CONFIDENCE,
    source: "Gemini 推理",
    endpoint: null,
    sourceField: null,
    fetchedAt: null,
    periodEnd: null,
    isStale: false,
    unavailableReason: value ? null : "尚無可用資料"
  };
}

function blankRevenueBusiness(name: string, description: string): RevenueBusiness {
  const unavailable = <T>(): SourcedField<T> => ({
    value: null,
    dataConfidence: AI_CONFIDENCE,
    source: "Gemini 推理",
    endpoint: null,
    sourceField: null,
    fetchedAt: null,
    periodEnd: null,
    isStale: false,
    unavailableReason: "公司未揭露業務營收拆分"
  });

  return {
    name: aiField(name),
    description: aiField(description),
    revenueSharePercent: unavailable<number>(),
    revenueAmount: unavailable<number>(),
    revenueUnit: unavailable<string>(),
    axis: unavailable<string>()
  };
}

function toCatalysts(input: GeminiAnalysisDraft["catalysts"]): Catalyst[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const direction: CatalystDirection =
        item?.direction === "正面" || item?.direction === "負面" || item?.direction === "中性"
          ? item.direction
          : "待驗證";
      return {
        title: aiField(text(item?.title, 180)),
        direction: {
          ...aiField(direction),
          value: direction,
          sourceField: null
        },
        rationale: aiField(text(item?.rationale)),
        evidence: aiField(text(item?.evidence))
      };
    })
    .filter((item) => Boolean(item.title.value))
    .slice(0, 5);
}

function toCompetitors(input: GeminiAnalysisDraft["competitors"]): Competitor[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      name: aiField(text(item?.name, 160)),
      comparison: aiField(text(item?.comparison))
    }))
    .filter((item) => Boolean(item.name.value))
    .slice(0, 5);
}

function toCompetitiveAdvantage(input: GeminiAnalysisDraft["competitiveAdvantage"]): CompetitiveAdvantage {
  return {
    summary: aiField(text(input?.summary)),
    limitations: aiField(text(input?.limitations))
  };
}

function mergeRevenueBusinesses(
  apiBusinesses: RevenueBusiness[],
  generatedBusinesses: GeminiAnalysisDraft["topRevenueBusinesses"]
): RevenueBusiness[] {
  const generatedByName = new Map(
    (Array.isArray(generatedBusinesses) ? generatedBusinesses : [])
      .map((item) => [text(item?.name, 160).toLowerCase(), text(item?.description)] as const)
      .filter(([name]) => Boolean(name))
  );

  if (apiBusinesses.length > 0) {
    return apiBusinesses.map((business) => {
      const key = (business.name.value ?? "").toLowerCase();
      const generatedDescription = generatedByName.get(key) ?? "";
      return {
        ...business,
        description: generatedDescription ? aiField(generatedDescription) : business.description
      };
    });
  }

  // The model may provide qualitative business descriptions when the issuer did not disclose a
  // reliable breakdown. Explicitly keep every numerical revenue field null.
  return (Array.isArray(generatedBusinesses) ? generatedBusinesses : [])
    .map((item) => blankRevenueBusiness(text(item?.name, 160), text(item?.description)))
    .filter((item) => Boolean(item.name.value))
    .slice(0, 5);
}

function buildSystemInstruction(language: string): string {
  return `你是股票研究的文字分析器。所有輸出一律使用 ${language}。

資料來源分層（必須遵守）：
1. payload 的 SourcedField 中 value 非 null 且 dataConfidence 為「API 實測」時，是已取得的真實資料。不得修改、重新計算、推斷成另一個數字，或聲稱這些資料來自你自己搜尋。
2. payload 未提供、value 為 null、或 unavailable 陣列列出的欄位，才可由你給出定性、研究型的文字補述；每一個這類補述都會由伺服器標記為「AI 綜合判斷，非即時財報數據」。
3. 你絕不可產生 payload 中不存在的精確 P/E、P/B、EPS、ROE、毛利率、營收、淨利、市值、52 週價格、業務營收金額或佔比。缺資料時用「需查證」或保持定性敘述。
4. topRevenueBusinesses 的 revenueSharePercent 與 revenueAmount 完全由伺服器控制。你只能寫 description，不可補數字或百分比；如果 API 沒資料，伺服器會顯示「佔比未知」。
5. 對港股與 A 股（marketScope 為 HK 或 CN，或 finnhubSupported=false），不得暗示使用了即時 Finnhub 財報；所有研究性敘述都是「AI 綜合判斷，非即時財報數據」。
6. catalysts、competitors、competitiveAdvantage 是定性研究，不能編造近期公告、事件、財務數字、市占或精確時間點。若無充分背景，輸出空陣列或「需查證」。
7. 僅輸出合法 JSON；不要包覆 Markdown、不要輸出資料來源以外的前言。`;
}

function buildPrompt(context: AnalysisContext, dataLimitations: string[]): string {
  const payload = { symbol: context.quote.symbol, companyName: context.quote.companyName, marketScope: context.marketScope, finnhubSupported: context.finnhubSupported, quote: context.quote, technicals: context.technicals, companyBackground: context.companyBackgroundBase, financialMetrics: context.financialMetrics, topRevenueBusinesses: context.revenueBusinesses, unavailable: context.unavailable, dataLimitations };
  return "你是股票研究的文字分析器。只使用 payload 中已有的精確數字；缺漏資料只能定性說明，不得捏造營收、淨利、市值、估值倍率、毛利率、52 週價格或業務佔比。只輸出合法 JSON。\n\nPAYLOAD:\n" + JSON.stringify(payload) + "\n\n輸出 JSON 欄位：recommendation、recommendationReason、confidenceLevel、summary、outlook、risks、technicalSummary、valuation、oneLineSummary、companyPositioning、catalysts、competitors、competitiveAdvantage。";
}

class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly model: string,
    readonly endpoint: string,
    readonly responsePreview: string
  ) {
    super("Gemini HTTP " + status + " for model " + model + ": " + responsePreview);
    this.name = "GeminiHttpError";
  }
}

function isGeminiModelCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    character === "-" ||
    character === "." ||
    character === "_"
  );
}

function extractSuggestedModel(responseText: string): string | null {
  const marker = "models/";
  const start = responseText.indexOf(marker);
  if (start < 0) return null;
  let end = start + marker.length;
  while (end < responseText.length && isGeminiModelCharacter(responseText[end])) end += 1;
  const model = responseText.slice(start + marker.length, end);
  return model.startsWith("gemini-") ? model : null;
}

function isUnavailableModel404(error: GeminiHttpError): boolean {
  if (error.status !== 404) return false;
  const text = error.responsePreview.toLowerCase();
  return text.includes("model") && (
    text.includes("not available") ||
    text.includes("not found") ||
    text.includes("shut down") ||
    text.includes("closed") ||
    text.includes("unavailable")
  );
}

async function callGemini(
  model: string,
  prompt: string,
  systemInstruction: string,
  apiKey: string,
  signal: AbortSignal
): Promise<GeminiAnalysisDraft> {
  const geminiUrl = new URL(
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent"
  );
  geminiUrl.searchParams.set("key", apiKey);
  const endpoint = geminiUrl.origin + geminiUrl.pathname;
  console.info("Gemini generateContent endpoint", endpoint);

  const response = await fetch(geminiUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
    }),
    signal
  });

  if (!response.ok) {
    const responsePreview = (await response.text()).slice(0, 600);
    console.warn("Gemini generateContent failed", { status: response.status, model, endpoint, responsePreview });
    throw new GeminiHttpError(response.status, model, endpoint, responsePreview);
  }

  const body = (await response.json()) as GeminiResponse;
  const responseText = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!responseText) throw new Error("Gemini response contained no text");
  return JSON.parse(responseText) as GeminiAnalysisDraft;
}

async function requestGemini(prompt: string, systemInstruction: string): Promise<GeminiAnalysisDraft> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY_MISSING");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    try {
      return await callGemini(GEMINI_MODEL, prompt, systemInstruction, apiKey, controller.signal);
    } catch (error) {
      if (!(error instanceof GeminiHttpError) || !isUnavailableModel404(error)) throw error;
      const suggestedModel = extractSuggestedModel(error.responsePreview);
      if (!suggestedModel || suggestedModel === GEMINI_MODEL) throw error;
      console.info("Retrying Gemini once with Google-suggested model", { previousModel: GEMINI_MODEL, suggestedModel });
      return await callGemini(suggestedModel, prompt, systemInstruction, apiKey, controller.signal);
    }
  } finally {
    clearTimeout(timeout);
  }
}
function shapeAnalysisResult(raw: GeminiAnalysisDraft, context: AnalysisContext, dataLimitations: string[]): AnalysisResult {
  const technicals = context.technicals;
  const requestedConfidence = raw.confidenceLevel ?? "low";
  const cappedConfidence = deriveConfidence(technicals.dataSufficiency, Boolean(context.fundamentals), false);
  const rank = { high: 3, medium: 2, low: 1 } as const;
  const confidenceLevel = rank[requestedConfidence] <= rank[cappedConfidence] ? requestedConfidence : cappedConfidence;
  const recommendation = raw.recommendation === "BUY" || raw.recommendation === "HOLD" || raw.recommendation === "SELL"
    ? raw.recommendation
    : "NEUTRAL";
  const assessment = raw.valuation?.assessment === "UNDERVALUED" || raw.valuation?.assessment === "FAIR" || raw.valuation?.assessment === "OVERVALUED"
    ? raw.valuation.assessment
    : "INSUFFICIENT_DATA";

  return {
    schemaVersion: "1.0",
    symbol: context.quote.symbol,
    finnhubSymbol: context.finnhubSymbol,
    marketScope: context.marketScope,
    generatedAt: new Date().toISOString(),
    companyName: context.companyBackgroundBase.companyName.value ?? context.quote.companyName,
    lastAnalyzed: new Date().toISOString(),
    companyBackground: {
      ...context.companyBackgroundBase,
      positioning: aiField(text(raw.companyPositioning))
    },
    oneLineSummary: aiField(text(raw.oneLineSummary, 300)),
    catalysts: toCatalysts(raw.catalysts),
    topRevenueBusinesses: mergeRevenueBusinesses(context.revenueBusinesses, raw.topRevenueBusinesses),
    competitors: toCompetitors(raw.competitors),
    competitiveAdvantage: toCompetitiveAdvantage(raw.competitiveAdvantage),
    financialMetrics: context.financialMetrics,
    recommendation,
    recommendationReason: text(raw.recommendationReason),
    confidenceLevel,
    dataLimitations,
    technicalSummary: {
      trend: technicals.trend,
      movingAverageNote: text(raw.technicalSummary?.movingAverageNote),
      momentumNote: text(raw.technicalSummary?.momentumNote),
      volumePriceNote: text(raw.technicalSummary?.volumePriceNote) || technicals.volumeNote,
      supportLevel: technicals.supportLevel,
      resistanceLevel: technicals.resistanceLevel,
      summary: text(raw.technicalSummary?.summary)
    },
    valuation: { assessment, reasoning: text(raw.valuation?.reasoning) },
    risks: Array.isArray(raw.risks) ? raw.risks.map((risk) => text(risk, 300)).filter(Boolean).slice(0, 5) : [],
    summary: text(raw.summary),
    outlook: text(raw.outlook),
    recentNews: [],
    sources: []
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body: unknown = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const request = body as { symbol?: unknown; locale?: unknown };
  const symbol = typeof request.symbol === "string" ? request.symbol.trim().toUpperCase() : "";
  // Permit supported market suffixes so a non-US ticker can reach its safe no-Finnhub fallback.
  // Reject only malformed input; ticker metadata remains an optional display enhancement.
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(symbol)) {
    res.status(400).json({ error: "Invalid symbol provided" });
    return;
  }

  const companyName = STOCKS_METADATA[symbol]?.companyName ?? symbol;
  const locale = typeof request.locale === "string" && request.locale ? request.locale : "zh-TW";

  let context: AnalysisContext;
  try {
    const quote = await fetchStockFromYahoo(symbol);
    context = await buildAnalysisContext(quote, locale);
    context.technicals = computeTechnicalIndicators(quote);
  } catch (error) {
    console.error("Analysis context unavailable; returning null-safe fallback", error);
    res.status(200).json(await getSimulatedAnalysis(symbol, companyName));
    return;
  }

  const dataLimitations = buildDataLimitations(context);
  if (!process.env.GEMINI_API_KEY) {
    res.status(200).json(await getSimulatedAnalysis(symbol, companyName, context));
    return;
  }

  try {
    const raw = await requestGemini(buildPrompt(context, dataLimitations), buildSystemInstruction(localeToLanguageInstruction(locale)));
    res.status(200).json(shapeAnalysisResult(raw, context, dataLimitations));
  } catch (error) {
    console.error("Gemini analysis failed; returning null-safe fallback", error);
    res.status(200).json(await getSimulatedAnalysis(symbol, companyName, context));
  }
}
