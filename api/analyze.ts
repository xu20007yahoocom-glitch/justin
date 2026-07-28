import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";
import { STOCKS_METADATA } from "../lib/stocksData";
import { getSimulatedAnalysis } from "../lib/simulatedAnalysis";

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

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

  if (!ai) {
    console.log("GEMINI_API_KEY not configured. Simulating AI Analysis...");
    return res.status(200).json(getSimulatedAnalysis(symbol, companyName));
  }

  try {
    console.log(`Analyzing ${symbol} with Gemini...`);
    const prompt = `Perform a comprehensive, professional investment analysis for the stock ${symbol} (${companyName}) using the latest real-time information.
All text descriptions must be written in Traditional Chinese (繁體中文).
Provide:
1. "summary": A concise overview of recent financial performance and trend summary (2-3 sentences).
2. "recommendation": A direct investment recommendation: BUY, HOLD, SELL, or NEUTRAL.
3. "outlook": A short-term and long-term outlook (2-3 sentences).
4. "companyBackground": 公司背景, a paragraph detailing what the company does, its history, and sector position.
5. "oneSentenceSummary": 一句總結, a punchy, insightful one-sentence investment thesis summarizing the stock.
6. "catalysts": 催化劑, an array of 2 to 3 key near-to-mid term catalysts or drivers.
7. "top3RevenueSegment": Top3營收業務, an array of the top 3 revenue-generating business divisions/segments.
8. "competitors": 競爭對手, up to 3 main competitors in the market.
9. "advantages": 競爭優勢, 2 to 3 core competitive advantages or economic moats.
10. List 2-3 recent news articles or developments with their title, source, sentiment (positive, negative, or neutral), and reference URL.

Format the output STRICTLY as a JSON object matching this schema:
{
  "summary": "String",
  "recommendation": "BUY" | "HOLD" | "SELL" | "NEUTRAL",
  "outlook": "String",
  "companyBackground": "String",
  "oneSentenceSummary": "String",
  "catalysts": ["String 1", "String 2"],
  "top3RevenueSegment": ["String 1", "String 2", "String 3"],
  "competitors": ["String 1", "String 2", "String 3"],
  "advantages": ["String 1", "String 2"],
  "recentNews": [
    {
      "title": "String",
      "source": "String",
      "sentiment": "positive" | "negative" | "neutral",
      "url": "String"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        systemInstruction: "You are an expert Wall Street financial analyst. You analyze stock performance and make data-driven, objective stock evaluations in Traditional Chinese (繁體中文) based on Google Search grounding data."
      }
    });

    const responseText = response.text || "{}";
    const parsedData = JSON.parse(responseText.trim());

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = groundingChunks
      .filter((chunk: any) => chunk.web?.uri)
      .map((chunk: any) => ({
        title: chunk.web.title || "Web Source",
        uri: chunk.web.uri
      }));

    return res.status(200).json({
      ...parsedData,
      sources: sources.slice(0, 5),
      lastAnalyzed: new Date().toLocaleString()
    });
  } catch (error: any) {
    console.error("Gemini API Error, falling back to offline analysis:", error);
    const fallback = getSimulatedAnalysis(symbol, companyName);
    fallback.summary = `⚠️【系統提示：由於 Gemini API 調用次數達到限制，已自動為您加載本地預置深度分析報告】\n\n${fallback.summary}`;
    return res.status(200).json(fallback);
  }
}
