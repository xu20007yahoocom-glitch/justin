import React, { useState, useEffect } from "react";
import { MessageSquare, Send, CheckCircle2, AlertTriangle, RefreshCw, HelpCircle, Lock, Save, Globe } from "lucide-react";
import { StockQuote } from "../types";

interface WhatsAppLog {
  timestamp: string;
  status: "success" | "failed" | "simulated";
  recipient: string;
  message: string;
  error?: string;
}

interface WhatsAppStatusResponse {
  logs: WhatsAppLog[];
  config: {
    mode: "telegram" | "simulated";
    telegramBotToken: string;
    telegramChatId: string;
    intervalMs: number;
  };
}

interface WhatsAppNotificationsProps {
  stocks?: StockQuote[];
}

export const WhatsAppNotifications: React.FC<WhatsAppNotificationsProps> = () => {
  const [status, setStatus] = useState<WhatsAppStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showFullLogs, setShowFullLogs] = useState<boolean>(false);

  const [telegramBotToken, setTelegramBotToken] = useState<string>("");
  const [telegramChatId, setTelegramChatId] = useState<string>("");

  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/whatsapp/status");
      if (response.ok) {
        const data: WhatsAppStatusResponse = await response.json();
        // ✅ 对返回结构兜底，防止残缺 JSON 崩溃
        if (data && data.config) {
          setStatus(data);
          if (data.config.telegramBotToken) setTelegramBotToken(data.config.telegramBotToken);
          if (data.config.telegramChatId) setTelegramChatId(data.config.telegramChatId);
        }
      }
      // ✅ 404 等非 ok：静默降级，status 保持 null，页面不崩
    } catch (error) {
      console.error("Error fetching WhatsApp status:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (mode: "telegram" | "simulated") => {
    setSavingSettings(true);
    setSaveSuccess(false);
    try {
      const response = await fetch("/api/whatsapp/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          telegramBotToken,
          telegramChatId,
        }),
      });
      if (response.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        await fetchStatus();
      }
    } catch (error) {
      console.error("Error saving settings:", error);
    } finally {
      setSavingSettings(false);
    }
  };

  const triggerTestMessage = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/whatsapp/test", { method: "POST" });
      // ✅ 先判断 ok 再解析 JSON，避免对 404 的 HTML 做 json() 抛错
      if (!response.ok) {
        setTestResult({
          success: false,
          message: `测试接口不可用 (HTTP ${response.status})。请确认后端 /api/whatsapp/test 已正确部署。`,
        });
        return;
      }
      const data = await response.json();
      if (data.success) {
        setTestResult({
          success: true,
          message:
            data.status === "sent"
              ? "【发送成功】已成功向您的 Telegram 发送一条实时行情测试消息！"
              : "【模拟成功】测试信息已在服务器控制台打印，请完成下方 Telegram 配置以启用真实推送。",
        });
        fetchStatus();
      } else {
        setTestResult({
          success: false,
          message: data.error || "触发测试通知失败，请检查 Telegram 凭证配置。",
        });
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error?.message || "请求发生网络错误。",
      });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-pulse space-y-4">
        <div className="h-5 bg-slate-200 rounded w-1/3" />
        <div className="h-10 bg-slate-100 rounded" />
        <div className="h-20 bg-slate-50 rounded" />
      </div>
    );
  }

  const activeMode = status?.config?.mode || "simulated";

  return (
    <div id="whatsapp-notifications-section" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 pb-5 gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-slate-900 text-white">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">美股 15 分钟行情 Telegram 自动推送提醒</h2>
            <p className="text-xs text-slate-400 mt-0.5">通过 Telegram 机器人，每 15 分钟自动将最新行情推送到您的账户、群组或频道</p>
          </div>
        </div>
      </div>

      {/* Status Banner */}
      <div className="p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border-slate-200">
        <div className="flex items-center gap-2.5">
          <div className={`w-2.5 h-2.5 rounded-full animate-pulse flex-shrink-0 ${activeMode === "simulated" ? "bg-amber-500" : "bg-emerald-500"}`} />
          <span className="font-semibold text-slate-700">
            后台 15 分钟定时推送状态：
            {activeMode === "simulated" ? "未激活 (仅本地日志打印)" : "Telegram 机器人推送已激活 🚀"}
          </span>
        </div>
        <button onClick={triggerTestMessage} disabled={testing} className="text-[11px] bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 self-start sm:self-auto">
          {testing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          立即测试单次发送
        </button>
      </div>

      {testResult && (
        <div className={`p-3 rounded-xl border text-[11px] font-semibold flex items-start gap-2 ${testResult.success ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-rose-50 border-rose-100 text-rose-800"}`}>
          {testResult.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-600" />}
          <div className="leading-snug">{testResult.message}</div>
        </div>
      )}

      {/* Telegram Config */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-blue-50/70 border border-blue-100 p-4 rounded-xl text-xs text-blue-800 leading-relaxed">
            <p className="font-bold mb-1">🤖 Telegram 机器人定时推送提醒</p>
            完全免费且无限量。配置您的 Telegram Bot，系统将在后台每 15 分钟自动将汇总股价推送至您的 Telegram 账户、群组或频道。
          </div>

          <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-blue-500" />
              配置 Telegram 凭证
            </h3>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Telegram Bot Token</label>
                <input
                  type="password"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  placeholder="例如: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-white text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">接收端 Chat ID (用户 ID 或群组 ID)</label>
                <input
                  type="text"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="例如: 987654321 或 @my_channel"
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-white text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => handleSaveSettings("telegram")}
                disabled={savingSettings}
                className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
              >
                {savingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>保存并激活 Telegram 15分钟自动定时推送</span>
              </button>
              {activeMode === "telegram" && (
                <button
                  onClick={() => handleSaveSettings("simulated")}
                  className="py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-bold text-slate-600 transition-all cursor-pointer"
                >
                  停用自动推送
                </button>
              )}
            </div>

            {saveSuccess && (
              <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-100 text-[11px] font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>自动推送配置保存成功！每15分钟将进行自动抓取与发送。</span>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-slate-50 border border-slate-100 p-5 rounded-2xl flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-blue-500" />
              Telegram 创建与配置指引：
            </h3>
            <ol className="space-y-4 text-xs text-slate-600 leading-relaxed">
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-[10px] font-bold flex items-center justify-center text-blue-600">1</span>
                <div>
                  <p className="font-semibold text-slate-800">获取 Bot Token</p>
                  <p className="text-slate-500 mt-0.5">
                    在 Telegram 中搜索并联系 <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline">@BotFather</a>，发送 <span className="font-mono font-bold bg-slate-200 px-1 rounded">/newbot</span> 并按引导创建机器人，即可获得 Token。
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-[10px] font-bold flex items-center justify-center text-blue-600">2</span>
                <div>
                  <p className="font-semibold text-slate-800">获取您自己的 Chat ID</p>
                  <p className="text-slate-500 mt-0.5">
                    联系 <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline">@userinfobot</a> 发送任意消息即可得到您的纯数字 Chat ID。别忘了先跟自己刚建的 Bot 发一条消息以解锁会话权限！
                  </p>
                </div>
              </li>
            </ol>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
            <span>🔒 本地加密存储</span>
            <span className="font-bold text-blue-600">极客专属 · 免费不限流</span>
          </div>
        </div>
      </div>

      {/* Logs */}
      <div className="border-t border-slate-100 pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">15分钟自动抓取与推送日志记录 (历史追踪)</h3>
            <span className="text-[10px] text-slate-400">(自动静默刷新)</span>
          </div>
          <button onClick={fetchStatus} className="text-slate-400 hover:text-slate-900 p-1 rounded transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-semibold" title="刷新日志">
            <RefreshCw className="w-3.5 h-3.5" /><span>手动刷新日志</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {status?.logs && status.logs.length > 0 ? (
            status.logs.slice(0, showFullLogs ? 16 : 4).map((log, index) => {
              const isSimulated = log.status === "simulated";
              const isSuccess = log.status === "success";
              return (
                <div key={index} className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 text-[11px] font-sans flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-400 font-medium">{log.timestamp}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase ${isSuccess ? "bg-emerald-100 text-emerald-800" : isSimulated ? "bg-indigo-50 border border-indigo-100 text-indigo-700" : "bg-rose-100 text-rose-800"}`}>
                      {isSuccess ? "发送成功" : isSimulated ? "本地控制台打印" : "发送失败"}
                    </span>
                  </div>
                  <div className="font-semibold text-slate-700 line-clamp-3 leading-relaxed">{log.message}</div>
                  {log.error && (
                    <p className="text-[10px] text-rose-600 font-medium leading-snug pt-1 border-t border-rose-100">⚠️ {log.error}</p>
                  )}
                </div>
              );
            })
          ) : (
            <div className="col-span-full py-10 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-100 rounded-2xl">
              <MessageSquare className="w-8 h-8 stroke-1 mb-1.5" />
              <span className="text-xs font-medium">当前暂无定时器后台静默发送日志记录</span>
            </div>
          )}
        </div>

        {status?.logs && status.logs.length > 4 && (
          <button onClick={() => setShowFullLogs(!showFullLogs)} className="w-full mt-2 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 border border-slate-200 bg-white hover:bg-slate-50 transition-all rounded-xl flex items-center justify-center gap-1 cursor-pointer">
            <span>{showFullLogs ? "收起日志" : `查看完整推送日志历史 (${status.logs.length}条记录)`}</span>
          </button>
        )}
      </div>
    </div>
  );
};
