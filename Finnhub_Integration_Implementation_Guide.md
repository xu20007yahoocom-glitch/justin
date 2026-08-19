# Finnhub 結構化分析整合：實作與部署指南

**作者：Manus AI**  
**日期：2026-08-19（GMT+8）**

## 實作摘要

本次交付將 Finnhub 整合為美股基本面與申報財報的優先資料來源，並把 AI 分析改為可在欄位層級追溯來源的 `StockAnalysis` 契約。程式不使用 Finnhub SDK、Gemini SDK、WebSocket 或 CLI；全部外部服務請求皆使用原生 `fetch` 的 HTTP REST。所有相對 ESM import 均使用 `.js` 副檔名。

Finnhub Free 方案每分鐘 60 次 API 呼叫，且免費基本面資料覆蓋 US。因此 `AAPL`／`AAPL.US` 會走 Finnhub，`700.HK`、`.SH`、`.SZ` 則在發出網路請求前直接 short-circuit 為 `null` 資料層，交由 AI 作**明確標示的非即時財報研究補述**。[1]

> **安全結果：** 缺少 `FINNHUB_API_KEY`、HTTP 403／429、權限不足、網路逾時、空回應、資料欄位差異、Gemini 故障與 Yahoo 故障，均會返回結構化 fallback；分析端點不以這些情況回傳 HTTP 500。

## 套用檔案與目標路徑

上傳的檔案名稱與實際原始路徑不一致。下表列出應採用的**目標路徑**與本次對應交付檔，請以內容覆寫原始專案內的同名目標檔案。

| 目標路徑 | 交付檔 | 內容 |
| --- | --- | --- |
| `src/types.ts` | `updated_src_types.ts` | 新增 `StockAnalysis`、欄位級 `SourcedField<T>`、來源／信心、舊面板相容的 `AnalysisResult`。 |
| `lib/providers/finnhub.ts` | `updated_lib_providers_finnhub.ts` | Profile2、Metric、Financials Reported、Revenue Breakdown 的 REST provider、快取、in-flight 去重、timeout、null fallback。 |
| `lib/analysisData.ts` | `updated_lib_analysisData.ts` | 依市場組裝 `AnalysisContext`、原始 schema 驗證、欄位對應、業務營收去重。 |
| `api/stocks/analyze.ts` | `updated_api_stocks_analyze.ts` | 原上傳檔 `cron.ts` 實際內容所對應的分析端點；改為 Gemini HTTP REST、反捏造 prompt、200 fallback。 |
| `lib/simulatedAnalysis.ts` | `updated_lib_simulatedAnalysis.ts` | 回傳同一 `AnalysisResult`／`StockAnalysis` 結構的安全 fallback。 |
| `lib/technicalIndicators.ts` | `updated_lib_technicalIndicators.ts` | 技術指標不變；更新資料限制以反映 Finnhub 與非美股邊界。 |
| `src/components/AIAnalystPanel.tsx` | `updated_src_components_AIAnalystPanel.tsx` | 六個結構化區塊、API／AI 信心標籤、營收占比未知提示、財務指標卡。 |
| `.env.example` | `updated_env.example` | 新增 `FINNHUB_API_KEY` 並保留 Gemini 與既有設定。 |

## 後端資料流

| 輸入市場 | Finnhub symbol | REST 呼叫 | 產出與資料標記 |
| --- | --- | --- | --- |
| 無後綴美股，例如 `AAPL` | `AAPL` | Profile2、Metric、Financials Reported；Revenue Breakdown best-effort | 真實欄位為 **API 實測**；AI 只補充定性研究。 |
| `.US`，例如 `AAPL.US` | `AAPL` | 同上 | 同上。 |
| 港股，例如 `700.HK` | `null` | **零 Finnhub 呼叫** | API 基本面為 unavailable；研究欄位為 **AI 綜合判斷，非即時財報數據**。 |
| A 股，例如 `600519.SH`、`000001.SZ` | `null` | **零 Finnhub 呼叫** | 同港股。 |

`/stock/profile2` 提供公司名稱、產業、市值、交易所、上市日與 logo。`/stock/metric?metric=all` 的 `metric` map 只會取實際存在、有限數值的 P/E、P/B、EPS、ROE、毛利率及 52 週高低。`/stock/financials-reported` 僅取最新有效 10-K／10-Q 中存在的收入與淨利欄位，並隨欄位保留 `periodEnd`。`/stock/revenue-breakdown` 僅在可識別同一互斥 axis、百分比合計接近 100%、且沒有重複 member 時呈現佔比，從而避免把父項與子項（例如 Products 與 iPhone）重複加總。[2] [3]

## 快取、額度與安全降級

| 資料 | TTL | 失敗處理 | 設計目的 |
| --- | --- | --- | --- |
| Profile2 | 1 小時 | 回傳可用 stale 值，否則 null | 公司基本資訊低頻變動。 |
| Metric | 1 小時 | 回傳可用 stale 值，否則 null | 降低重複面板重繪對額度的影響。 |
| Financials Reported | 6 小時 | 回傳可用 stale 值，否則 null | 申報財報屬低頻資料。 |
| Revenue Breakdown | 6 小時 | 回傳可用 stale 值，否則 null | 端點權限和公司揭露不保證。 |
| 403 | 15 分鐘負快取 | null，不 retry | 避免重複打未授權端點。 |
| 429 | 60 秒負快取 | null，不 retry | 避免持續撞 Free plan 每分鐘 60 次限制。 |
| 其他錯誤 | 30 秒負快取 | stale 或 null | 網路／schema 故障不成為 500。 |

> Vercel module-scoped `Map` 只在同一 warm function instance 有效。這能處理常見重複請求與 in-flight 去重，但不是跨 instance 的全域 rate limiter。若未命中快取的不同美股分析量超過約每分鐘 15 次，應使用共享 KV／Redis rate limiter 或提高 Finnhub 方案，而不能假裝 in-memory Map 能跨 instance 強制控管 60/min。

## Vercel 與本機環境變數

在 Vercel 專案的 **Settings → Environment Variables** 新增下列 server-only 變數，並在 Preview、Production（及需要時 Development）套用。不要把任何 key 命名為 `VITE_*`，否則會被打包進瀏覽器。

| 變數 | 必要性 | 用途 |
| --- | --- | --- |
| `FINNHUB_API_KEY` | 本次新增；美股基本面實測時必須 | Finnhub REST 認證。缺少時正常 fallback，不報 500。 |
| `GEMINI_API_KEY` | 既有 | Gemini REST 定性分析。缺少或失敗時使用 `simulatedAnalysis`。 |
| `CRON_SECRET`、`APP_URL`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID` | 既有且依原專案功能選用 | 與本次 Finnhub 整合無直接相依。 |

在本機請從 `updated_env.example` 建立 `.env.local`，然後由既有 Vercel／Vite 開發流程載入。憑證不得提交至 Git。

## 未執行的 curl 驗證範例

依使用者的「不呼叫 CLI」限制，本次**沒有執行**下列指令；它們僅是部署後由維護者在本機驗證用的範例。範例不含任何真實 API key。

```bash
# 驗證 Finnhub Profile2（僅美股）
curl --fail-with-body \
  "https://finnhub.io/api/v1/stock/profile2?symbol=AAPL&token=${FINNHUB_API_KEY}"

# 驗證 Finnhub Basic Financials（僅美股）
curl --fail-with-body \
  "https://finnhub.io/api/v1/stock/metric?symbol=AAPL&metric=all&token=${FINNHUB_API_KEY}"

# 驗證申報原貌財報（僅美股）
curl --fail-with-body \
  "https://finnhub.io/api/v1/stock/financials-reported?symbol=AAPL&freq=annual&token=${FINNHUB_API_KEY}"

# 驗證本 app 的結構化分析端點；預期 HTTP 200。
curl --silent --show-error --fail-with-body \
  --request POST "http://localhost:3000/api/stocks/analyze" \
  --header "Content-Type: application/json" \
  --data '{"symbol":"AAPL","locale":"zh-TW"}'

# 驗證非美股安全 fallback；預期 HTTP 200、marketScope=HK、finnhubSymbol=null。
curl --silent --show-error --fail-with-body \
  --request POST "http://localhost:3000/api/stocks/analyze" \
  --header "Content-Type: application/json" \
  --data '{"symbol":"700.HK","locale":"zh-TW"}'
```

## AAPL 與 700.HK 驗證結果

| 情境 | 已完成的靜態驗證 | 期望執行時行為 | 實測狀態 |
| --- | --- | --- | --- |
| `AAPL` | `isFinnhubSupportedMarket("AAPL")` 為 true；symbol 正規化為 `AAPL`；四個 provider 以 `Promise.allSettled` 隔離執行；每一端點各自 try/catch。 | Profile2、Metric、Financials Reported 成功時填入 `API 實測`；Revenue Breakdown 若權限／揭露不足，業務佔比為 `null`／「佔比未知」。 | **未執行 live call**：本工作階段沒有提供可供測試的 `FINNHUB_API_KEY`，且依限制沒有執行 CLI／curl。 |
| `700.HK` | market routing 在任何 Finnhub `fetch` 前回傳 false；`normalizeFinnhubSymbol` 回傳 null；分析端點已移除「必須在美股 metadata」的攔截。 | 不呼叫 Finnhub；回傳 HTTP 200，`marketScope: "HK"`、`finnhubSymbol: null`；所有研究型欄位標 AI，精確財務欄位 unavailable。 | **邏輯路徑已完成檢查**；未以 CLI 啟動原專案或呼叫外部 API。 |

因此，本次能誠實報告的是**靜態路由與失敗處理驗證已完成**，但不是帶真實 key 的 live API 驗證。部署後設定 `FINNHUB_API_KEY` 並執行上述兩個 app endpoint 測試，即可完成真實資料驗收；AAPL 回應中的 API 欄位會依當時 provider 真實回傳而變動，絕不能事先捏造數值。

## 前端新增／替換的呈現區塊

| 區塊 | 呈現方式 | 必顯示的來源行為 |
| --- | --- | --- |
| 公司背景 | 名稱、產業、交易所、上市日、市值、幣別、國家與定位補述的 facts grid | 每個事實個別標 `Finnhub Profile2`／Yahoo；定位補述標 AI。 |
| 一句總結 | 頂端引言樣式區塊 | 固定標「AI 綜合判斷，非即時財報數據」。 |
| 催化劑 | 正面／負面／中性 badge 與理由卡片 | 每筆催化劑顯示 AI 標籤；沒有足夠資料就顯示空狀態。 |
| 主要營收業務 | 業務名稱、描述與佔比 badge | 只有 Finnhub `percentage` 實測才顯示百分比並標「來源：Finnhub」；否則清楚顯示「佔比未知」。 |
| 主要同業 | 同業名稱與定性比較 | 每筆標 AI，不呈現虛構市占或數字。 |
| 競爭優勢／護城河 | 優勢摘要加上「限制與需查證」子卡 | 兩者都標 AI，避免被誤解為 API 事實。 |
| 估值與獲利實測欄位 | P/E、P/B、EPS、ROE、毛利率、52 週高低、營收與淨利小卡 | 每張卡各自顯示 API／AI badge；null 顯示「需查證」。 |

## Gemini HTTP REST 變更

原程式使用 `@google/genai`。本次的更新版分析端點改以原生 `fetch` 呼叫 Gemini 的 `models.generateContent` REST endpoint，並傳送 `systemInstruction`、`contents` 和 `generationConfig.responseMimeType: "application/json"`。這符合「不用 SDK」限制，同時保留 JSON 結構輸出與由後端 shape／source wrapper 強制審核的模式。[4]

## 上線前檢查表

| 項目 | 驗收條件 |
| --- | --- |
| 組建 | 依既有專案的 TypeScript／Vercel 流程完成型別檢查與 build。 |
| 憑證 | 在 Vercel 設定 `FINNHUB_API_KEY`、`GEMINI_API_KEY`，不提交 `.env.local`。 |
| AAPL | 回應 HTTP 200；至少在 key 有效時取得 Profile2／Metric 可用欄位；失敗時仍是 200 fallback。 |
| 700.HK | 回應 HTTP 200；不對 Finnhub 發請求；`finnhubSymbol` 為 null；不顯示捏造財務數字。 |
| 429 | 連續測試後不出現 500；確認負快取生效並回傳 unavailable 或 stale 標記。 |
| Revenue Breakdown | 沒權限、資料未揭露、axis 重複或百分比不互斥時，必須顯示「佔比未知」。 |
| 前端 | 六個指定區塊都顯示來源／信心標記；不存在 API 數值時不顯示 placeholder 數字。 |

## 參考資料

[1]: https://finnhub.io/pricing "Finnhub Pricing — Free plan 60 API calls/minute、US fundamental-data coverage"
[2]: https://finnhub.io/docs/api/company-profile2 "Finnhub Company Profile 2"
[3]: https://finnhub.io/docs/api/company-basic-financials "Finnhub Basic Financials"
[4]: https://finnhub.io/docs/api/financials-reported "Finnhub Financials As Reported and Revenue Breakdown"
[5]: https://ai.google.dev/api/generate-content "Gemini API — models.generateContent REST reference"
