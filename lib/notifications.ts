/**
 * Telegram push-notification settings + logs, shared by the Vercel
 * serverless functions (api/whatsapp/*, api/cron.ts).
 *
 * IMPORTANT — Vercel serverless persistence caveat:
 * Vercel Functions are stateless and ephemeral. There is no writable,
 * shared filesystem across invocations/regions. We persist settings/logs
 * to /tmp on a best-effort basis (works while the same function instance
 * stays warm, e.g. during a testing session) so the existing "Save
 * settings" UI keeps working without requiring a database. For a
 * production deployment where settings must survive cold starts and
 * redeploys, either:
 *   1) Set TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID as Vercel Environment
 *      Variables (always used as the source of truth if /tmp has no
 *      saved override), or
 *   2) Wire this up to a real store (Vercel KV / Upstash Redis / Postgres).
 */
import fs from "fs";
import path from "path";

export interface WhatsAppLog {
  timestamp: string;
  status: "success" | "failed" | "simulated";
  recipient: string;
  message: string;
  error?: string;
}

export interface WhatsAppSettings {
  mode: "telegram" | "simulated";
  telegramBotToken: string;
  telegramChatId: string;
}

const CONFIG_FILE = path.join("/tmp", "whatsapp_config.json");
const LOGS_FILE = path.join("/tmp", "whatsapp_logs.json");
const MAX_LOGS = 25;
export const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Resolve the public dashboard URL used in the "🔗 Live Dashboard:" footer
 * of outgoing Telegram alerts. Centralized here so every caller (scheduled
 * cron alert, manual test alert, etc.) is guaranteed to produce an
 * identical, always-populated link instead of each duplicating
 * `process.env.APP_URL || ""` independently (which silently produced an
 * empty link whenever APP_URL wasn't set for that particular deployment).
 *
 * Resolution order:
 *   1. APP_URL    — explicit override, works on both Vercel and Cloud Run.
 *                   Set this to your canonical public domain (e.g. Cloud
 *                   Run's https://ais-dev-xxx.run.app, or your Vercel
 *                   production domain).
 *   2. VERCEL_URL — auto-injected by Vercel on every deployment (preview +
 *                   production) as a bare host, e.g. "my-app.vercel.app"
 *                   (no protocol). Used as a same-deployment fallback so
 *                   the link is never blank even if APP_URL was never
 *                   configured on Vercel.
 *   3. ""         — last resort if neither is available (e.g. local dev
 *                   without .env set).
 */
export function getDashboardUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

export function getSettings(): WhatsAppSettings {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error reading whatsapp_config.json:", err);
  }

  const hasTelegramEnv = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  return {
    mode: hasTelegramEnv ? "telegram" : "simulated",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || ""
  };
}

export function saveSettings(settings: WhatsAppSettings) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing whatsapp_config.json (non-fatal on serverless):", err);
  }
}

export function getLogs(): WhatsAppLog[] {
  try {
    if (fs.existsSync(LOGS_FILE)) {
      return JSON.parse(fs.readFileSync(LOGS_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Error reading whatsapp_logs.json:", err);
  }
  return [];
}

function pushLog(entry: WhatsAppLog) {
  const logs = getLogs();
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing whatsapp_logs.json (non-fatal on serverless):", err);
  }
}

export async function sendWhatsAppMessage(body: string): Promise<{ success: boolean; status: string; error?: string }> {
  const settings = getSettings();
  const timestamp = new Date().toLocaleTimeString() + " " + new Date().toLocaleDateString();

  const logEntry: WhatsAppLog = {
    timestamp,
    status: "simulated",
    recipient: "Not Configured",
    message: body
  };

  if (settings.mode === "telegram") {
    const token = settings.telegramBotToken;
    const chatId = settings.telegramChatId;
    logEntry.recipient = `Telegram Chat: ${chatId || "未设置"}`;

    if (!token || !chatId) {
      const errorMsg = "Telegram 机器人 Token 或 Chat ID 未配置。请在配置中心补充。";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      pushLog(logEntry);
      return { success: false, status: "failed", error: errorMsg };
    }

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: "Markdown" })
      });

      const resData: any = await res.json();
      if (res.ok && resData.ok) {
        logEntry.status = "success";
        pushLog(logEntry);
        return { success: true, status: "sent" };
      } else {
        const errorMsg = resData.description || `Telegram 返回错误 (代码 ${res.status})`;
        logEntry.status = "failed";
        logEntry.error = errorMsg;
        pushLog(logEntry);
        return { success: false, status: "failed", error: errorMsg };
      }
    } catch (err: any) {
      const errorMsg = err.message || "连接 Telegram API 失败";
      logEntry.status = "failed";
      logEntry.error = errorMsg;
      pushLog(logEntry);
      return { success: false, status: "failed", error: errorMsg };
    }
  }

  // Simulated Mode
  const errorMsg = "运行于模拟模式（未配置真实推送渠道）。";
  console.log(`[Simulation Mode] Telegram Alert:\n${body}`);
  logEntry.status = "simulated";
  logEntry.error = errorMsg;
  pushLog(logEntry);
  return { success: true, status: "simulated" };
}
