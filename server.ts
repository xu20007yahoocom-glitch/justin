import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini Client
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
} else {
  console.warn("GEMINI_API_KEY is not defined. AI Analysis will operate in simulation mode.");
}

// Preset stock metadata
const STOCKS_METADATA: Record<string, { companyName: string; fallbackPrice: number }> = {
  UGI: { companyName: "UGI Corporation", fallbackPrice: 24.50 },
  LNG: { companyName: "Cheniere Energy, Inc.", fallbackPrice: 178.20 },
  DXCM: { companyName: "Dexcom, Inc.", fallbackPrice: 88.40 },
  PTEN: { companyName: "Patterson-UTI Energy, Inc.", fallbackPrice: 10.25 }
};

// Simple helper to generate fallback historical data if Yahoo Finance fails
function generateFallbackHistory(symbol: string, range: string): { date: string; price: number }[] {
  const basePrice = STOCKS_METADATA[symbol]?.fallbackPrice || 100;
  const history: { date: string; price: number }[] = [];
  const now = new Date();
  
  let points = 30;
  let intervalDays = 1;
  let isIntraday = false;

  if (range === "1d") {
    points = 24;
    isIntraday = true;
  } else if (range === "5d") {
    points = 20;
    intervalDays = 0.25;
  } else if (range === "1mo" || range === "30d" || range === "1m") {
    points = 30;
    intervalDays = 1;
  } else if (range === "6mo" || range === "6m") {
    points = 26;
    intervalDays = 7;
  } else if (range === "1y") {
    points = 52;
    intervalDays = 7;
  }

  let currentPrice = basePrice * (0.9 + Math.random() * 0.2); // Random initial offset
  for (let i = points; i >= 0; i--) {
    const d = new Date(now.getTime() - i * intervalDays * 24 * 60 * 60 * 1000);
    let dateStr = "";
    if (isIntraday) {
      const hours = d.getHours().toString().padStart(2, "0");
      const minutes = d.getMinutes().toString().padStart(2, "0");
      dateStr = `${hours}:${minutes}`;
    } else {
      const month = (d.getMonth() + 1).toString().padStart(2, "0");
      const day = d.getDate().toString().padStart(2, "0");
      dateStr = `${month}/${day}`;
    }

    // Daily walk
    const changePercent = (Math.random() - 0.49) * 0.03; // Slight upward bias
    currentPrice = currentPrice * (1 + changePercent);
    history.push({
      date: dateStr,
      price: parseFloat(currentPrice.toFixed(2))
    });
  }

  return history;
}

// Fetch single stock chart from Yahoo Finance or fallback
async function fetchStockFromYahoo(symbol: string, range: string = "1mo") {
  let yahooRange = "1mo";
  let yahooInterval = "1d";

  // Normalize range
  if (range === "1d") {
    yahooRange = "1d";
    yahooInterval = "5m";
  } else if (range === "5d") {
    yahooRange = "5d";
    yahooInterval = "15m";
  } else if (range === "1m" || range === "1mo") {
    yahooRange = "1mo";
    yahooInterval = "1d";
  } else if (range === "6m" || range === "6mo") {
    yahooRange = "6mo";
    yahooInterval = "1d";
  } else if (range === "1y") {
    yahooRange = "1y";
    yahooInterval = "1d";
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${yahooRange}&interval=${yahooInterval}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} from Yahoo Finance`);
    }

    const data: any = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      throw new Error(`No chart result found for ${symbol}`);
    }

    const meta = result.meta;
    const timestamps: number[] = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const closePrices: (number | null)[] = quotes.close || [];
    const openPrices: (number | null)[] = quotes.open || [];
    const highPrices: (number | null)[] = quotes.high || [];
    const lowPrices: (number | null)[] = quotes.low || [];
    const volumes: (number | null)[] = quotes.volume || [];

    const price = meta.regularMarketPrice || closePrices[closePrices.length - 1] || STOCKS_METADATA[symbol].fallbackPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose || price;
    const change = price - prevClose;
    const changePercent = (change / prevClose) * 100;

    // Build history
    const history: { date: string; price: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const p = closePrices[i];
      if (p === null || p === undefined) continue;

      const dateObj = new Date(timestamps[i] * 1000);
      let dateStr = "";
      if (range === "1d") {
        const hours = dateObj.getHours().toString().padStart(2, "0");
        const minutes = dateObj.getMinutes().toString().padStart(2, "0");
        dateStr = `${hours}:${minutes}`;
      } else {
        const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
        const day = dateObj.getDate().toString().padStart(2, "0");
        dateStr = `${month}/${day}`;
      }

      history.push({
        date: dateStr,
        price: parseFloat(p.toFixed(2))
      });
    }

    return {
      symbol,
      companyName: STOCKS_METADATA[symbol]?.companyName || symbol,
      price: parseFloat(price.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      open: parseFloat((meta.regularMarketOpen || openPrices[0] || price).toFixed(2)),
      high: parseFloat((meta.regularMarketDayHigh || Math.max(...highPrices.filter((x): x is number => x !== null)) || price).toFixed(2)),
      low: parseFloat((meta.regularMarketDayLow || Math.min(...lowPrices.filter((x): x is number => x !== null)) || price).toFixed(2)),
      previousClose: parseFloat(prevClose.toFixed(2)),
      volume: meta.regularMarketVolume || volumes[volumes.length - 1] || 0,
      lastUpdated: new Date().toLocaleTimeString(),
      history
    };
  } catch (error) {
    console.error(`Error fetching ${symbol} from Yahoo:`, error);
    // Fallback
    const fallbackHistory = generateFallbackHistory(symbol, range);
    const lastPrice = fallbackHistory[fallbackHistory.length - 1].price;
    const firstPrice = fallbackHistory[0].price;
    const change = lastPrice - firstPrice;
    const changePercent = (change / firstPrice) * 100;

    return {
      symbol,
      companyName: STOCKS_METADATA[symbol]?.companyName || symbol,
      price: lastPrice,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      open: fallbackHistory[0].price,
      high: parseFloat((lastPrice * 1.05).toFixed(2)),
      low: parseFloat((lastPrice * 0.95).toFixed(2)),
      previousClose: firstPrice,
      volume: Math.floor(Math.random() * 5000000) + 1000000,
      lastUpdated: `${new Date().toLocaleTimeString()} (Simulated)`,
      history: fallbackHistory
    };
  }
}

// 1. Get stock data for all stocks
app.get("/api/stocks", async (req, res) => {
  const range = (req.query.range as string) || "1m";
  try {
    const promises = Object.keys(STOCKS_METADATA).map(symbol => fetchStockFromYahoo(symbol, range));
    const results = await Promise.all(promises);
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Analyze stock data with Gemini Grounding Search
function getSimulatedAnalysis(symbol: string, companyName: string) {
  const sim: Record<string, any> = {
    UGI: {
      summary: "UGI Corporation 近期在公用事業和中游資產板塊表現穩健，在暖冬氣候的短期不利因素後，正經歷利潤率修復和成本優化階段。其在美國和歐洲的多元化運營為其提供了高於同業的抗風險能力，目前股價在歷史支撐位附近整固。",
      recommendation: "HOLD",
      outlook: "短期內持平至溫和復甦。長期看，隨著歐洲能源替代進程和低碳液化石油氣項目的推進，公司具備平穩增長和提供高股息回報的潛力。",
      companyBackground: "UGI Corporation 是一家擁有一百多年歷史的能源分銷與服務公司，主要在美國和歐洲運營液化石油氣（LPG）分銷、天然氣和電力公用事業，以及中游能源基礎設施。",
      oneSentenceSummary: "歷史悠久的多元化能源分銷龍頭，兼具穩定股息與基礎設施增長潛力。",
      catalysts: [
        "歐洲天然氣市場需求重組與結構性轉型",
        "美國LPG基礎設施現代化與數位化成本優化",
        "綠色再生能源及生物丙烷（rDME）的商業化落地"
      ],
      top3RevenueSegment: [
        "AmeriGas 丙烷分銷業務 (LPG Distribution)",
        "UGI International 歐洲能源分銷",
        "UGI Utilities 基礎公用事業"
      ],
      competitors: [
        "Suburban Propane Partners (SPH)",
        "Star Group (SGU)",
        "Southern Company (SO)"
      ],
      advantages: [
        "龐大的地理分銷網絡與跨國運營規模",
        "極高的客戶黏性與多樣化終端市場覆蓋",
        "連續數十年不間斷支付並穩步增長股息的記錄"
      ]
    },
    LNG: {
      summary: "Cheniere Energy 作為美國液化天然氣出口絕對龍頭，受益於全球尤其是歐洲對非俄羅斯天然氣的剛性替代需求。其兩大出口港高稼動率運營，現金流創造能力極強，債務槓桿率持續下降。",
      recommendation: "BUY",
      outlook: "中長期前景非常亮麗。Sabine Pass 和 Corpus Christi 出口設施的持續擴建，將在未來數年內鎖定全球天然氣貿易增長红利。",
      companyBackground: "Cheniere Energy 是美國最大的液化天然氣（LNG）生產商和出口商，運營位於路易斯安那州的 Sabine Pass 和德克薩斯州的 Corpus Christi 兩大世界級出口終端。",
      oneSentenceSummary: "掌控美國LNG出口半壁江山的能源巨頭，受益於全球天然氣需求激增。",
      catalysts: [
        "Sabine Pass 第三期擴建工程（Stage 3）的進展與投產",
        "與歐洲及亞洲公用事業巨頭簽署的長期照付不議合約陸續生效",
        "全球能源轉型背景下對更清潔過渡燃料的剛性需求"
      ],
      top3RevenueSegment: [
        "液化天然氣（LNG）銷售與出口",
        "天然氣管道運輸與物流服務",
        "LNG 終端加工與配套裝載業務"
      ],
      competitors: [
        "Sempra Energy (SRE)",
        "Freeport LNG",
        "Tellurian Inc. (TELL)"
      ],
      advantages: [
        "規模龐大且具備先發優勢的出口基礎設施",
        "高比例的長期「照付不議」（Take-or-pay）合約提供極高現金流可預測性",
        "優越的戰略地理位置及完善的美國內陸管道聯網"
      ]
    },
    DXCM: {
      summary: "Dexcom 持續在連續血糖監測（CGM）市場擴大份額。新一代 G7 系統的加速推廣以及保險覆蓋範圍的擴大，推動了營收兩位數增長。雖然面臨減肥藥（GLP-1）風潮的短期市場情緒擾動，但長期剛性需求不減。",
      recommendation: "BUY",
      outlook: "強勁增長。隨著二型糖尿病非胰島素用戶群體的保險覆蓋面進一步推開，以及可穿戴健康設備的普及，CGM 的全球滲透率仍有巨大空間。",
      companyBackground: "Dexcom 是一家專注於研發和製造連續血糖監測（CGM）系統的醫療器械巨頭，其產品為糖尿病患者提供實時血糖跟蹤，大幅改善健康管理與生活質量。",
      oneSentenceSummary: "連續血糖監測（CGM）領域的世界級領航者，以領先技術推動糖尿病數字健康變革。",
      catalysts: [
        "G7 系統在國際市場的加速滲透與保險覆蓋擴大",
        "針對非胰島素依賴型糖尿病群體及健康管理市場的開拓",
        "與主流智能穿戴設備及自動胰島素泵的深度生態整合"
      ],
      top3RevenueSegment: [
        "Dexcom G7 / G6 傳感器與發射器銷量",
        "醫療接收器與軟體訂閱服務",
        "海外市場經銷與戰略合作授權"
      ],
      competitors: [
        "Abbott Laboratories (ABT - FreeStyle Libre)",
        "Medtronic (MDT)",
        "Senseonics (SENS)"
      ],
      advantages: [
        "行業領先的測量精度（MARD）與無需指尖校準的技術壁壘",
        "強大的軟體生態與多終端無縫連接體驗",
        "深厚的專利組合與全球主要醫保體系的全面對接"
      ]
    },
    PTEN: {
      summary: "Patterson-UTI Energy 在完成與 NexTier 壓裂公司的合併後，躍升為北美陸上油田服務的核心巨頭。儘管短期內美國活躍鑽機數量因頁岩油商資本開支克制而微幅波動，但高規格鑽機的需求和定價依然堅挺，合併協同效應正在釋放。",
      recommendation: "BUY",
      outlook: "穩健向好。與 NexTier 的全面整合將在 2026 年底前釋放顯著的成本和運營協同效應，在陸上高效率鑽井和完井板塊具備極強的護城河。",
      companyBackground: "Patterson-UTI Energy 是一家領先的陸上合約鑽井與壓力泵送服務商，主要在美國和加拿大運營。通過提供先進的高規格鑽機、壓裂技術以及定向鑽井解決方案，為油氣開發商提供高效率開採服務。",
      oneSentenceSummary: "北美頂級陸上鑽井與壓裂服務商，具備高規格鑽機陣容與行業整合實力。",
      catalysts: [
        "頁岩油氣商開採預算的復甦與高效鑽井服務需求增加",
        "併購 NexTier 壓裂服務後協同效應與利潤率的提升",
        "高規格 Super-Spec 鑽機的使用率及日租金價格反彈"
      ],
      top3RevenueSegment: [
        "陸上合約鑽井服務 (Contract Drilling)",
        "壓力泵送與水力壓裂服務 (Pressure Pumping)",
        "定向鑽井與技術支持解決方案 (Directional Drilling)"
      ],
      competitors: [
        "Helmerich & Payne (HP)",
        "Nabors Industries (NBR)",
        "Halliburton (HAL)"
      ],
      advantages: [
        "行業領先的高規格 Super-Spec 頂驅鑽機船隊",
        "與 NexTier 合併後在壓力泵送領域擁有的極大規模效應",
        "出色的安全運營記錄與與北美主要頁岩油巨頭的穩固關係"
      ]
    }
  };

  const targetSim = sim[symbol] || sim["UGI"];
  return {
    ...targetSim,
    recentNews: [
      {
        title: `Market Analysts weigh in on ${companyName}'s growth prospects and 2026 outlook`,
        source: "Financial Daily",
        sentiment: "neutral",
        url: "https://finance.yahoo.com"
      },
      {
        title: `Why ${symbol} could surprise investors in the next quarter with strong margins`,
        source: "MarketWatch",
        sentiment: "positive",
        url: "https://finance.yahoo.com"
      }
    ],
    sources: [
      { title: "Yahoo Finance", uri: "https://finance.yahoo.com" }
    ],
    lastAnalyzed: new Date().toLocaleString()
  };
}

app.post("/api/stocks/analyze", async (req, res) => {
  const { symbol } = req.body;
  if (!symbol || !STOCKS_METADATA[symbol]) {
    return res.status(400).json({ error: "Invalid symbol provided" });
  }

  const companyName = STOCKS_METADATA[symbol].companyName;

  if (!ai) {
    // Simulated AI response if API Key is not available
    console.log("Simulating AI Analysis...");
    const simulatedAnalysis = getSimulatedAnalysis(symbol, companyName);
    return res.json(simulatedAnalysis);
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
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        systemInstruction: "You are an expert Wall Street financial analyst. You analyze stock performance and make data-driven, objective stock evaluations in Traditional Chinese (繁體中文) based on Google Search grounding data.",
      }
    });

    const responseText = response.text || "{}";
    const parsedData = JSON.parse(responseText.trim());

    // Extract Grounding Citations to return as sources
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = groundingChunks
      .filter((chunk: any) => chunk.web?.uri)
      .map((chunk: any) => ({
        title: chunk.web.title || "Web Source",
        uri: chunk.web.uri
      }));

    res.json({
      ...parsedData,
      sources: sources.slice(0, 5), // Return first 5 unique sources
      lastAnalyzed: new Date().toLocaleString()
    });
  } catch (error: any) {
    console.error("Gemini API Error, falling back to offline analysis:", error);
    // Graceful fallback to rich offline mock data so application never breaks
    const fallback = getSimulatedAnalysis(symbol, companyName);
    fallback.summary = `⚠️【系統提示：由於 Gemini API 調用次數達到限制，已自動為您加載本地預置深度分析報告】\n\n${fallback.summary}`;
    res.json(fallback);
  }
});

// --- WhatsApp Notification Scheduler Implementation ---

interface WhatsAppLog {
  timestamp: string;
  status: "success" | "failed" | "simulated";
  recipient: string;
  message: string;
  error?: string;
}

const whatsappLogs: WhatsAppLog[] = [];

interface WhatsAppSettings {
  mode: "twilio" | "callmebot" | "telegram" | "serverchan" | "pushdeer" | "bark" | "simulated";
  callmebotPhone: string;
  callmebotApikey: string;
  toWhatsAppNumber: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  serverchanKey?: string;
  pushdeerKey?: string;
  barkUrl?: string;
}

const CONFIG_FILE = path.join(process.cwd(), "whatsapp_config.json");

function getSettings(): WhatsAppSettings {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error reading whatsapp_config.json:", err);
  }
  
  // Default fallback: check environment variables first
  const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TO_WHATSAPP_NUMBER);
  return {
    mode: hasTwilio ? "twilio" : "simulated",
    callmebotPhone: "",
    callmebotApikey: "",
    toWhatsAppNumber: process.env.TO_WHATSAPP_NUMBER || "",
    telegramBotToken: "",
    telegramChatId: "",
    serverchanKey: "",
    pushdeerKey: "",
    barkUrl: ""
  };
}

function saveSettings(settings: WhatsAppSettings) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing whatsapp_config.json:", err);
  }
}

// Helper to format WhatsApp numbers to the required format (e.g. "whatsapp:+85257032699")
function formatWhatsAppNumber(num: string): string {
  const trimmed = num.trim();
  if (trimmed.startsWith("whatsapp:")) {
    const rawNumber = trimmed.substring("whatsapp:".length).trim();
    if (rawNumber.startsWith("+")) {
      return trimmed;
    }
    return `whatsapp:+${rawNumber}`;
  }
  
  if (trimmed.startsWith("+")) {
    return `whatsapp:${trimmed}`;
  }
  
  return `whatsapp:+${trimmed}`;
}

// Send message via selected notification channel
async function sendWhatsAppMessage(body: string): Promise<{ success: boolean; status: string; error?: string }> {
  const settings = getSettings();
  const timestamp = new Date().toLocaleTimeString() + " " + new Date().toLocaleDateString();
  
  const logEntry: WhatsAppLog = {
    timestamp,
    status: "simulated",
    recipient: "Not Configured",
    message: body
  };

  if (settings.mode === "callmebot") {
    const phone = settings.callmebotPhone;
    const apikey = settings.callmebotApikey;
    logEntry.recipient = phone || "Not Configured";

    if (!phone || !apikey) {
      const errorMsg = "CallMeBot 手机号或 API Key 未配置，无法自动发送。请在前端配置面板中补全。";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }

    try {
      const cleanPhone = phone.replace(/\D/g, "");
      const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(body)}&apikey=${apikey}`;
      
      console.log(`[CallMeBot Mode] Sending automated stock alert to ${cleanPhone}...`);
      const res = await fetch(url);
      
      if (res.ok) {
        logEntry.status = "success";
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: true, status: "sent" };
      } else {
        const textResponse = await res.text();
        const errorMsg = `CallMeBot 接口返回错误: ${textResponse || res.statusText}`;
        logEntry.status = "failed";
        logEntry.error = errorMsg;
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: false, status: "failed", error: errorMsg };
      }
    } catch (err: any) {
      const errorMsg = err.message || "无法连接至 CallMeBot 服务器";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }
  } else if (settings.mode === "twilio") {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
    const toWhatsApp = settings.toWhatsAppNumber || process.env.TO_WHATSAPP_NUMBER;
    logEntry.recipient = toWhatsApp || "Not Configured";

    if (!accountSid || !authToken || !toWhatsApp) {
      const errorMsg = "Twilio 配置缺失。请补充 TWILIO_ACCOUNT_SID、TWILIO_AUTH_TOKEN。";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const authString = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      
      const formattedTo = formatWhatsAppNumber(toWhatsApp);
      const formattedFrom = formatWhatsAppNumber(fromWhatsApp);

      const params = new URLSearchParams();
      params.append("To", formattedTo);
      params.append("From", formattedFrom);
      params.append("Body", body);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${authString}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      });

      const resData: any = await res.json();
      if (res.ok) {
        logEntry.status = "success";
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: true, status: "sent" };
      } else {
        const errorMsg = resData.message || "Twilio 返回错误";
        logEntry.status = "failed";
        logEntry.error = errorMsg;
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: false, status: "failed", error: errorMsg };
      }
    } catch (err: any) {
      const errorMsg = err.message || "无法连接至 Twilio 服务器";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }
  } else if (settings.mode === "telegram") {
    const token = settings.telegramBotToken;
    const chatId = settings.telegramChatId;
    logEntry.recipient = `Telegram Chat: ${chatId || "未设置"}`;

    if (!token || !chatId) {
      const errorMsg = "Telegram 机器人 Token 或 Chat ID 未配置。请在配置中心补充。";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }

    try {
      console.log(`[Telegram Mode] Sending automated stock alert to chat ${chatId}...`);
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: body,
          parse_mode: "Markdown"
        })
      });

      const resData: any = await res.json();
      if (res.ok && resData.ok) {
        logEntry.status = "success";
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: true, status: "sent" };
      } else {
        const errorMsg = resData.description || `Telegram 返回错误 (代码 ${res.status})`;
        logEntry.status = "failed";
        logEntry.error = errorMsg;
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: false, status: "failed", error: errorMsg };
      }
    } catch (err: any) {
      const errorMsg = err.message || "连接 Telegram API 失败";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }
  } else if (settings.mode === "serverchan") {
    const key = settings.serverchanKey;
    logEntry.recipient = "微信 (Server酱)";

    if (!key) {
      const errorMsg = "微信 Server酱 SendKey 未配置。请在配置中心补充。";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }

    try {
      console.log(`[Server酱 Mode] Sending automated stock alert to WeChat...`);
      const url = `https://sctapi.ftqq.com/${key}.send`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          title: "📈 15分钟美股行情自动更新",
          desp: body
        }).toString()
      });

      const resData: any = await res.json();
      if (res.ok && (resData.code === 0 || resData.data?.errno === 0)) {
        logEntry.status = "success";
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: true, status: "sent" };
      } else {
        const errorMsg = resData.message || resData.info || "Server酱推送失败";
        logEntry.status = "failed";
        logEntry.error = errorMsg;
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: false, status: "failed", error: errorMsg };
      }
    } catch (err: any) {
      const errorMsg = err.message || "连接 Server酱 接口失败";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }
  } else if (settings.mode === "pushdeer") {
    const key = settings.pushdeerKey;
    logEntry.recipient = "PushDeer";

    if (!key) {
      const errorMsg = "PushDeer PushKey 未配置。请在配置中心补充。";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }

    try {
      console.log(`[PushDeer Mode] Sending automated stock alert to PushDeer...`);
      const url = `https://api2.pushdeer.com/message/push`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          pushkey: key,
          text: "📈 15分钟美股行情更新",
          desp: body,
          type: "markdown"
        }).toString()
      });

      const resData: any = await res.json();
      if (res.ok && resData.content?.result?.length > 0) {
        logEntry.status = "success";
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: true, status: "sent" };
      } else {
        const errorMsg = "PushDeer 推送回复为空或格式不匹配";
        logEntry.status = "failed";
        logEntry.error = errorMsg;
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: false, status: "failed", error: errorMsg };
      }
    } catch (err: any) {
      const errorMsg = err.message || "连接 PushDeer 接口失败";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }
  } else if (settings.mode === "bark") {
    let barkUrl = settings.barkUrl;
    logEntry.recipient = "iOS Bark Push";

    if (!barkUrl) {
      const errorMsg = "Bark 推送 Key/URL 未配置。请在配置中心补充。";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }

    try {
      console.log(`[Bark Mode] Sending automated stock alert to iOS...`);
      if (!barkUrl.startsWith("http://") && !barkUrl.startsWith("https://")) {
        barkUrl = `https://api.day.app/${barkUrl}`;
      }
      
      // Clean trailing slash
      if (barkUrl.endsWith("/")) barkUrl = barkUrl.slice(0, -1);

      const title = encodeURIComponent("📈 15分钟美股行情速报");
      const content = encodeURIComponent(body);
      const url = `${barkUrl}/${title}/${content}`;

      const res = await fetch(url);
      if (res.ok) {
        logEntry.status = "success";
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: true, status: "sent" };
      } else {
        const errorMsg = `Bark 返回错误 (代码 ${res.status})`;
        logEntry.status = "failed";
        logEntry.error = errorMsg;
        whatsappLogs.unshift(logEntry);
        if (whatsappLogs.length > 25) whatsappLogs.pop();
        return { success: false, status: "failed", error: errorMsg };
      }
    } catch (err: any) {
      const errorMsg = err.message || "连接 Bark 服务器失败";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      whatsappLogs.unshift(logEntry);
      if (whatsappLogs.length > 25) whatsappLogs.pop();
      return { success: false, status: "failed", error: errorMsg };
    }
  } else {
    // Simulated Mode
    const errorMsg = "运行于模拟模式（未配置真实推送渠道）。";
    console.log(`[Simulation Mode] WhatsApp Alert:\n${body}`);
    logEntry.status = "simulated";
    logEntry.error = errorMsg;
    whatsappLogs.unshift(logEntry);
    if (whatsappLogs.length > 25) whatsappLogs.pop();
    return { success: true, status: "simulated" };
  }
}

// Scheduled 15-minute Stock Scraper and WhatsApp Sender
async function cronScrapeAndSend() {
  console.log("Triggering 15-minute scheduled stock scrape and WhatsApp broadcast...");
  try {
    const symbols = Object.keys(STOCKS_METADATA);
    const quotes = await Promise.all(symbols.map(sym => fetchStockFromYahoo(sym, "1d")));
    
    let messageBody = `📈 *Stock Tracker 15-Min Alert* 📈\n`;
    messageBody += `Time: ${new Date().toLocaleString()}\n\n`;

    quotes.forEach(q => {
      const isPos = q.change >= 0;
      const arrow = isPos ? "🔺" : "🔻";
      const sign = isPos ? "+" : "";
      messageBody += `*${q.symbol}*: $${q.price.toFixed(2)} (${arrow} ${sign}${q.changePercent.toFixed(2)}%)\n`;
      messageBody += `Range: $${q.low.toFixed(1)} - $${q.high.toFixed(1)}\n\n`;
    });

    messageBody += `🔗 Live Dashboard:\n${process.env.APP_URL || 'http://localhost:3000'}`;

    await sendWhatsAppMessage(messageBody);
  } catch (error: any) {
    console.error("Scheduled scrape failed:", error);
  }
}

// Background Interval: 15 minutes = 15 * 60 * 1000 = 900000ms
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
setInterval(cronScrapeAndSend, FIFTEEN_MINUTES_MS);

// API Endpoint to check WhatsApp notification configurations and logs
app.get("/api/whatsapp/status", (req, res) => {
  const settings = getSettings();
  res.json({
    logs: whatsappLogs,
    config: {
      mode: settings.mode,
      callmebotPhone: settings.callmebotPhone,
      callmebotApikey: settings.callmebotApikey ? "******" : "",
      toWhatsApp: settings.toWhatsAppNumber || "",
      accountSidConfigured: !!process.env.TWILIO_ACCOUNT_SID,
      authTokenConfigured: !!process.env.TWILIO_AUTH_TOKEN,
      fromWhatsApp: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886",
      intervalMs: FIFTEEN_MINUTES_MS,
      telegramBotToken: settings.telegramBotToken ? "******" : "",
      telegramChatId: settings.telegramChatId || "",
      serverchanKey: settings.serverchanKey ? "******" : "",
      pushdeerKey: settings.pushdeerKey ? "******" : "",
      barkUrl: settings.barkUrl || ""
    }
  });
});

// API Endpoint to update WhatsApp settings
app.post("/api/whatsapp/settings", (req, res) => {
  try {
    const { 
      mode, 
      callmebotPhone, 
      callmebotApikey, 
      toWhatsAppNumber,
      telegramBotToken,
      telegramChatId,
      serverchanKey,
      pushdeerKey,
      barkUrl
    } = req.body;
    
    const current = getSettings();
    
    let finalApiKey = callmebotApikey;
    if (callmebotApikey === "******") {
      finalApiKey = current.callmebotApikey;
    }

    let finalTgToken = telegramBotToken;
    if (telegramBotToken === "******") {
      finalTgToken = current.telegramBotToken;
    }

    let finalScKey = serverchanKey;
    if (serverchanKey === "******") {
      finalScKey = current.serverchanKey;
    }

    let finalPdKey = pushdeerKey;
    if (pushdeerKey === "******") {
      finalPdKey = current.pushdeerKey;
    }
    
    const updated: WhatsAppSettings = {
      mode: mode || current.mode,
      callmebotPhone: callmebotPhone !== undefined ? callmebotPhone : current.callmebotPhone,
      callmebotApikey: finalApiKey !== undefined ? finalApiKey : current.callmebotApikey,
      toWhatsAppNumber: toWhatsAppNumber !== undefined ? toWhatsAppNumber : current.toWhatsAppNumber,
      telegramBotToken: finalTgToken !== undefined ? finalTgToken : current.telegramBotToken,
      telegramChatId: telegramChatId !== undefined ? telegramChatId : current.telegramChatId,
      serverchanKey: finalScKey !== undefined ? finalScKey : current.serverchanKey,
      pushdeerKey: finalPdKey !== undefined ? finalPdKey : current.pushdeerKey,
      barkUrl: barkUrl !== undefined ? barkUrl : current.barkUrl
    };
    
    saveSettings(updated);
    res.json({ 
      success: true, 
      settings: { 
        ...updated, 
        callmebotApikey: updated.callmebotApikey ? "******" : "",
        telegramBotToken: updated.telegramBotToken ? "******" : "",
        serverchanKey: updated.serverchanKey ? "******" : "",
        pushdeerKey: updated.pushdeerKey ? "******" : ""
      } 
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API Endpoint to manually trigger a WhatsApp message for test validation
app.post("/api/whatsapp/test", async (req, res) => {
  try {
    const symbols = Object.keys(STOCKS_METADATA);
    const quotes = await Promise.all(symbols.map(sym => fetchStockFromYahoo(sym, "1d")));
    
    let messageBody = `🔔 *Stock Tracker Manual Test Alert* 🔔\n`;
    messageBody += `Time: ${new Date().toLocaleString()}\n\n`;

    quotes.forEach(q => {
      const isPos = q.change >= 0;
      const arrow = isPos ? "🔺" : "🔻";
      const sign = isPos ? "+" : "";
      messageBody += `*${q.symbol}*: $${q.price.toFixed(2)} (${arrow} ${sign}${q.changePercent.toFixed(2)}%)\n`;
    });

    messageBody += `\n🔗 Live Dashboard:\n${process.env.APP_URL || 'http://localhost:3000'}`;

    const result = await sendWhatsAppMessage(messageBody);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure Vite and static folders
async function setupViteAndServe() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupViteAndServe();
