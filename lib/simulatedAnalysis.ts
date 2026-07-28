/**
 * Rich offline/simulated analysis content used when GEMINI_API_KEY is not
 * configured, or as a graceful fallback if the Gemini API call fails/hits
 * a rate limit. Shared by the Vercel serverless function (api/analyze.ts)
 * and the Cloud Run / AI Studio Express server (server.ts).
 */
export function getSimulatedAnalysis(symbol: string, companyName: string) {
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
