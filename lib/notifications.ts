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
 * Normalize the canonical server-side dashboard URL. Recipient-facing
 * Telegram links must never use a preview request host or VERCEL_URL.
 */
function normalizeDashboardUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let candidate = trimmed.replace(/^(?:https?:\/\/){2,}/i, "https://");
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname || parsed.username || parsed.password) {
      return null;
    }
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/g, "") || "/";
    const normalized = parsed.toString().replace(/\/+$/g, "");
    return `${normalized}/`;
  } catch {
    return null;
  }
}

/**
 * Canonical recipient-facing dashboard URL. Resolution order is intentionally
 * restricted to a configured production URL; APP_URL, VERCEL_URL and request
 * hosts are never used because they may identify a preview deployment.
 */
export function getDashboardUrl(): string | null {
  return normalizeDashboardUrl(process.env.DASHBOARD_PUBLIC_URL)
    ?? normalizeDashboardUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);
}

/** Safe Telegram Markdown footer, or an empty string when no canonical URL is configured. */
export function getLiveDashboardFooter(): string {
  const url = getDashboardUrl();
  // URL() has normalized and encoded the value above; this fixed label is Markdown-safe.
  return url ? `\n\n🔗 [Live Dashboard](${url})` : "";
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
