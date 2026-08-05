import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";
import { STOCKS_METADATA, fetchStockFromYahoo } from "../lib/stocksData.js";
import { getSimulatedAnalysis } from "../lib/simulatedAnalysis.js";
import { computeTechnicalIndicators, deriveConfidence, buildDataLimitations } from "../lib/technicalIndicators.js";
import type { AnalysisContext, AnalysisResult, ConfidenceLevel } from "../src/types.js";

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

/**
 * Build the "analysis material package" passed to Gemini. Today only
 * `quote` (real Yahoo Finance data) and `technicals` (real numbers
 * computed by lib/technicalIndicators.ts) are populated. `fundamentals`
 * and `analystRatings` are reserved extension points — always null right
 * now — so that wiring in a real financial-statement/analyst-consensus
 * data source later only requires filling these two fields, without
 * touching the prompt-assembly or response-shaping logic below.
 */
async function buildAnalysisContext(symbol: string, locale: string): Promise<AnalysisContext> {
  const quote = await fetchStockFromYahoo(symbol);
  const technicals = computeTechnicalIndicators(quote);

  return {
    quote,
    technicals,
    fundamentals: null, // reserved: no financial-statement data source wired up yet
    analystRatings: null, // reserved: no analyst-consensus data source wired up yet
    locale
  };
}

function localeToLanguageInstruction(locale: string): string {
  const normalized = (locale || "").toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk") || normalized === "zh-hant") {
    return "繁體中文（台灣用語）";
  }
  if (normalized.startsWith("zh")) {
    return "繁體中文";
  }
  if (normalized.startsWith("ja")) return "日本語";
  if (normalized.startsWith("ko")) return "한국어";
  if (normalized.startsWith("en")) return "English";
  // Default: Traditional Chinese, matching this app's existing baseline UI language.
  return "繁體中文";
}

/**
 * Build the Gemini prompt. All quantitative technical figures come from
 * `context.technicals` (real computed numbers) and are injected verbatim
 * into the prompt as ground truth that Gemini must narrate, not invent.
 * Gemini is explicitly forbidden from fabricating any other precise
 * numeric figures (EPS, revenue, PE ratio, etc.) it does not actually
 * have grounded data for.
 */
function buildPrompt(context: AnalysisContext, dataLimitations: string[]): string {
  const { quote, technicals } = context;
  const language = localeToLanguageInstruction(context.locale);

  const technicalFacts = `
- 目前股價: ${quote.price} (變動: ${quote.change} / ${quote.changePercent}%)
- 當日高/低: ${quote.high} / ${quote.low}，前收盤: ${quote.previousClose}
- 當日成交量: ${quote.volume}
- 短期均線 (SMA, ${technicals.smaShortPeriod ?? "N/A"} 期): ${technicals.smaShort ?? "資料不足"}
- 長期均線 (SMA, ${technicals.smaLongPeriod ?? "N/A"} 期): ${technicals.smaLong ?? "資料不足"}
- 趨勢判定 (由均線關係計算): ${technicals.trend}
- 動能 (Rate of Change, %): ${technicals.momentumPercent ?? "資料不足"}
- 波動率 (價格變動標準差, %): ${technicals.volatilityPercent ?? "資料不足"}
- 支撐位估計: ${technicals.supportLevel ?? "資料不足"}
- 壓力位估計: ${technicals.resistanceLevel ?? "資料不足"}
- 目前價格於支撐-壓力區間位置 (0=支撐, 1=壓力): ${technicals.pricePositionInRange ?? "資料不足"}
- 成交量說明: ${technicals.volumeNote}
- 歷史資料點數: ${technicals.historyPoints}
- 技術資料充足度: ${technicals.dataSufficiency}`;

  return `你是一位專業的股票分析師。請針對股票 ${context.quote.symbol}（${context.quote.companyName}）撰寫一份結構化的投資分析報告。

## 你可以使用的「真實數據」（以下數字皆為系統實際計算/取得的真實數據，你必須完全依據這些數字進行技術面與估值判斷，不可自行更改或重新[...]
${technicalFacts}

## 已知的資料限制（你必須在分析中誠實反映這些限制，不可假裝擁有這些資料）：
${dataLimitations.map((l) => `- ${l}`).join("\n")}

## 硬性規則（違反視為分析失敗）：
1. 任何具體數值型的技術指標（均線、動能、支撐/壓力、波動率）**只能使用上方「真實數據」提供的數字**，禁止自行編造或臆測其他數值型技術��[...]
2. 基本面數據（EPS、營收、毛利率、ROE、本益比、股利率等精確數值）**你沒有可靠的即時財報數據來源**。如果你不確定，必須明確使用「估計」「[...]
3. 「valuation」（估值判斷）只能依據上方「目前價格於支撐-壓力區間位置」等真實數據，以及你對該公司的一般性產業認知做「相對評價」（偏貴/��[...]
4. 你可以使用你的知識與（若可用）即時搜尋能力，補充該公司近期新聞、產業地位、催化劑等「質化」資訊，但這些內容必須清楚是敘述性描述，�[...]
5. 所有文字輸出請使用「${language}」撰寫。
6. 「confidenceLevel」欄位請你依據資料完整度誠實給出 "high" | "medium" | "low"（系統會在你的回答之後再做一次強制校正，若資料不足你給了 "high" 系統會[...]
7. 「dataLimitations」欄位請直接原樣輸出上方列出的「已知的資料限制」清單（可用你的語言重新表述，但語意必須一致，不可省略）。

## 請以下列 JSON 結構輸出（欄位名稱與型別必須完全符合，不可增減欄位名稱）：
{
  "recommendation": "BUY" | "HOLD" | "SELL" | "NEUTRAL",
  "recommendationReason": "一句話說明推薦理由",
  "confidenceLevel": "high" | "medium" | "low",
  "dataLimitations": ["字串陣列，說明本次分析的資料限制"],
  "technicalSummary": {
    "trend": "UP" | "DOWN" | "SIDEWAYS",
    "movingAverageNote": "對均線關係的文字解讀（依據上方真實均線數字）",
    "momentumNote": "對動能數字的文字解讀",
    "volumePriceNote": "承接成交量說明，補充解讀但不可新增未提供的假設",
    "supportLevel": ${technicals.supportLevel ?? "null"},
    "resistanceLevel": ${technicals.resistanceLevel ?? "null"},
    "summary": "技術面總結段落（2-3句）"
  },
  "valuation": {
    "assessment": "UNDERVALUED" | "FAIR" | "OVERVALUED" | "INSUFFICIENT_DATA",
    "reasoning": "說明依據，禁止捏造 PE/PB 等具體比率數字"
  },
  "catalysts": [
    { "type": "bullish" | "bearish", "description": "字串" }
  ],
  "risks": ["風險提示字串陣列，2-4項"],
  "summary": "整體摘要（2-3句）",
  "outlook": "短中長期展望（2-3句）",
  "oneSentenceSummary": "一句話總結的投資論點",
  "companyBackground": "公司背景段落",
  "top3RevenueSegment": ["前三大營收業務"],
  "competitors": ["最多3個主要競爭對手"],
  "advantages": ["2-3項核心競爭優勢/護城河（質化描述，不做星級評分）"],
  "recentNews": [
    { "title": "字串", "source": "字串", "sentiment": "positive" | "negative" | "neutral", "url": "字串" }
  ]
}

僅輸出符合上述結構的合法 JSON，不要加入任何 JSON 以外的文字或 Markdown 標記。`;
}

/** Normalize/repair whatever Gemini returns into a guaranteed-complete
 *  AnalysisResult, filling any missing/malformed fields with safe
 *  defaults rather than letting a partial LLM response reach the
 *  frontend. The server-computed confidenceLevel cap is enforced here,
 *  not merely requested via prompt wording. */
function shapeAnalysisResult(
  raw: any,
  context: AnalysisContext,
  dataLimitations: string[],
  sources: { title: string; uri: string }[]
): AnalysisResult {
  const technicals = context.technicals;

  const llmConfidence: ConfidenceLevel =
    raw?.confidenceLevel === "high" || raw?.confidenceLevel === "medium" || raw?.confidenceLevel === "low"
      ? raw.confidenceLevel
      : "low";

  // Enforce the confidence cap server-side: never trust the LLM alone to
  // self-limit when fundamentals/analystRatings are missing.
  const cappedConfidence = deriveConfidence(
    technicals.dataSufficiency,
    Boolean(context.fundamentals),
    Boolean(context.analystRatings)
  );
  const confidenceRank: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1 };
  const confidenceLevel: ConfidenceLevel =
    confidenceRank[llmConfidence] <= confidenceRank[cappedConfidence] ? llmConfidence : cappedConfidence;

  const recommendation = ["BUY", "HOLD", "SELL", "NEUTRAL"].includes(raw?.recommendation)
    ? raw.recommendation
    : "NEUTRAL";

  const catalysts = Array.isArray(raw?.catalysts)
    ? raw.catalysts
        .filter((c: any) => c && typeof c.description === "string")
        .map((c: any) => ({
          type: c.type === "bearish" ? "bearish" : "bullish",
          description: c.description
        }))
    : [];

  const risks = Array.isArray(raw?.risks) ? raw.risks.filter((r: any) => typeof r === "string") : [];

  const assessment = ["UNDERVALUED", "FAIR", "OVERVALUED", "INSUFFICIENT_DATA"].includes(raw?.valuation?.assessment)
    ? raw.valuation.assessment
    : "INSUFFICIENT_DATA";

  return {
    symbol: context.quote.symbol,
    companyName: context.quote.companyName,
    lastAnalyzed: new Date().toLocaleString(),

    recommendation,
    recommendationReason: typeof raw?.recommendationReason === "string" ? raw.recommendationReason : "",
    confidenceLevel,
    dataLimitations:
      Array.isArray(raw?.dataLimitations) && raw.dataLimitations.length > 0
        ? raw.dataLimitations.filter((d: any) => typeof d === "string")
        : dataLimitations,

    technicalSummary: {
      trend: technicals.trend, // always the server-computed real trend, never the LLM's
      movingAverageNote: typeof raw?.technicalSummary?.movingAverageNote === "string" ? raw.technicalSummary.movingAverageNote : "",
      momentumNote: typeof raw?.technicalSummary?.momentumNote === "string" ? raw.technicalSummary.momentumNote : "",
      volumePriceNote: typeof raw?.technicalSummary?.volumePriceNote === "string" ? raw.technicalSummary.volumePriceNote : technicals.volumeNote,
      supportLevel: technicals.supportLevel,
      resistanceLevel: technicals.resistanceLevel,
      summary: typeof raw?.technicalSummary?.summary === "string" ? raw.technicalSummary.summary : ""
    },

    valuation: {
      assessment,
      reasoning: typeof raw?.valuation?.reasoning === "string" ? raw.valuation.reasoning : ""
    },

    catalysts,
    risks,

    summary: typeof raw?.summary === "string" ? raw.summary : "",
    outlook: typeof raw?.outlook === "string" ? raw.outlook : "",
    oneSentenceSummary: typeof raw?.oneSentenceSummary === "string" ? raw.oneSentenceSummary : "",
    companyBackground: typeof raw?.companyBackground === "string" ? raw.companyBackground : "",
    top3RevenueSegment: Array.isArray(raw?.top3RevenueSegment) ? raw.top3RevenueSegment.filter((s: any) => typeof s === "string") : [],
    competitors: Array.isArray(raw?.competitors) ? raw.competitors.filter((s: any) => typeof s === "string") : [],
    advantages: Array.isArray(raw?.advantages) ? raw.advantages.filter((s: any) => typeof s === "string") : [],

    recentNews: Array.isArray(raw?.recentNews)
      ? raw.recentNews
          .filter((n: any) => n && typeof n.title === "string")
          .map((n: any) => ({
            title: n.title,
            source: typeof n.source === "string" ? n.source : "",
            sentiment: n.sentiment === "positive" || n.sentiment === "negative" ? n.sentiment : "neutral",
            url: typeof n.url === "string" ? n.url : undefined
          }))
      : [],
    sources: sources.slice(0, 5)
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body: any = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const symbol = body?.symbol;
  if (!symbol || !STOCKS_METADATA[symbol]) {
    return res.status(400).json({ error: "Invalid symbol provided" });
  }

  const companyName = STOCKS_METADATA[symbol].companyName;
  const locale = typeof body?.locale === "string" && body.locale ? body.locale : "zh-TW";

  if (!ai) {
    console.log("GEMINI_API_KEY not configured. Simulating AI Analysis...");
    return res.status(200).json(await getSimulatedAnalysis(symbol, companyName));
  }

  let context: AnalysisContext;
  try {
    context = await buildAnalysisContext(symbol, locale);
  } catch (error) {
    console.error(`Failed to build analysis context for ${symbol}, falling back to offline analysis:`, error);
    return res.status(200).json(await getSimulatedAnalysis(symbol, companyName));
  }

  const dataLimitations = buildDataLimitations(context);

  try {
    console.log(`Analyzing ${symbol} with Gemini using real technical data...`);
    const prompt = buildPrompt(context, dataLimitations);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        systemInstruction:
          "You are an expert Wall Street financial analyst. You produce structured, professional stock analysis strictly grounded in the real numeric data supplied to you. You never fabricate pre[...]"
      }
    });

    // Robust: log raw response and try multiple extraction paths before parsing JSON
    console.log("Gemini raw response:", JSON.stringify(response, null, 2));
    let responseText = "{}";
    try {
      if (typeof (response as any)?.text === "string" && (response as any).text.trim()) {
        responseText = (response as any).text;
      } else if (typeof (response as any)?.outputText === "string" && (response as any).outputText.trim()) {
        responseText = (response as any).outputText;
      } else if (Array.isArray((response as any)?.candidates) && (response as any).candidates[0]?.content) {
        const c = (response as any).candidates[0].content;
        if (typeof c === "string") {
          responseText = c;
        } else if (Array.isArray(c)) {
          responseText = c.map((p: any) => (p?.text ? p.text : "")).join("");
        } else {
          responseText = JSON.stringify(c);
        }
      } else {
        responseText = JSON.stringify(response);
      }

      let parsedData: any;
      try {
        parsedData = JSON.parse(responseText.trim());
      } catch (parseErr) {
        console.error("Failed to JSON.parse Gemini responseText:", responseText);
        throw parseErr;
      }

      const groundingChunks = (response as any).candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = groundingChunks
        .filter((chunk: any) => chunk.web?.uri)
        .map((chunk: any) => ({
          title: chunk.web.title || "Web Source",
          uri: chunk.web.uri
        }));

      const result = shapeAnalysisResult(parsedData, context, dataLimitations, sources);
      return res.status(200).json(result);
    } catch (err) {
      console.error("Gemini parse/extract error:", err);
      throw err; // outer catch will handle fallback
    }
  } catch (error: any) {
    console.error("Gemini API Error, falling back to offline analysis:", error);
    const fallback = await getSimulatedAnalysis(symbol, companyName);
    fallback.summary = `⚠️【系統提示：由於 Gemini API 調用次數達到限制，已自動為您加載本地預置深度分析報告】\n\n${fallback.summary}`;
    return res.status(200).json(fallback);
  }
}
