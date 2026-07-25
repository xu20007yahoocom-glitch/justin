export default async function handler(req: any, res: any) {
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
let ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { symbol } = req.body || {};

  if (!ai) {
    return res.status(200).json({ summary: "运行于模拟模式（未配置 GEMINI_API_KEY）" });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `分析股票 ${symbol}，用繁體中文返回简短总结 JSON 格式：{"summary": "..."}`
    });
    return res.status(200).json(JSON.parse(response.text || "{}"));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
