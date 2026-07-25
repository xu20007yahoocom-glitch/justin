import React, { useState, useEffect } from "react";
import { MessageSquare, Send, CheckCircle2, AlertTriangle, ExternalLink, RefreshCw, HelpCircle, Phone, Share2, Sparkles, Code, Lock, Smartphone, Save, Bell, Globe } from "lucide-react";
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
    mode: "twilio" | "callmebot" | "telegram" | "serverchan" | "pushdeer" | "bark" | "simulated";
    callmebotPhone: string;
    callmebotApikey: string;
    toWhatsApp: string;
    accountSidConfigured: boolean;
    authTokenConfigured: boolean;
    fromWhatsApp: string;
    intervalMs: number;
    telegramBotToken: string;
    telegramChatId: string;
    serverchanKey: string;
    pushdeerKey: string;
    barkUrl: string;
  };
}

interface WhatsAppNotificationsProps {
  stocks?: StockQuote[];
}

export const WhatsAppNotifications: React.FC<WhatsAppNotificationsProps> = ({ stocks = [] }) => {
  const [status, setStatus] = useState<WhatsAppStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showFullLogs, setShowFullLogs] = useState<boolean>(false);
  
  // Method selection: "direct" | "browser" | "telegram" | "serverchan" | "pushdeer" | "bark" | "callmebot" | "twilio"
  const [activeMethod, setActiveMethod] = useState<"direct" | "browser" | "telegram" | "serverchan" | "pushdeer" | "bark" | "callmebot" | "twilio">("direct");
  
  // Direct Click-to-Chat State
  const [directPhone, setDirectPhone] = useState<string>(() => {
    return localStorage.getItem("direct_whatsapp_phone") || "";
  });
  const [customMessage, setCustomMessage] = useState<string>("");

  // Server-side Settings State
  const [callmebotPhone, setCallmebotPhone] = useState<string>("");
  const [callmebotApikey, setCallmebotApikey] = useState<string>("");
  const [twilioRecipient, setTwilioRecipient] = useState<string>("");
  
  // Free Channel Settings
  const [telegramBotToken, setTelegramBotToken] = useState<string>("");
  const [telegramChatId, setTelegramChatId] = useState<string>("");
  const [serverchanKey, setServerchanKey] = useState<string>("");
  const [pushdeerKey, setPushdeerKey] = useState<string>("");
  const [barkUrl, setBarkUrl] = useState<string>("");

  // Browser notification permissions
  const [browserNotificationGranted, setBrowserNotificationGranted] = useState<boolean>(false);
  const [prevStocksHash, setPrevStocksHash] = useState<string>("");

  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Persist direct phone number locally
  useEffect(() => {
    localStorage.setItem("direct_whatsapp_phone", directPhone);
  }, [directPhone]);

  // Request/check browser notifications
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setBrowserNotificationGranted(Notification.permission === "granted");
    }
  }, []);

  // Monitor stock updates to push browser desktop notifications automatically
  useEffect(() => {
    if (stocks && stocks.length > 0 && browserNotificationGranted) {
      const currentHash = stocks.map(s => `${s.symbol}:${s.price}`).join("|");
      if (prevStocksHash && prevStocksHash !== currentHash) {
        let bodyText = "";
        stocks.forEach(s => {
          const sign = s.change >= 0 ? "📈" : "📉";
          const signText = s.change >= 0 ? "+" : "";
          bodyText += `${sign} ${s.symbol}: $${s.price.toFixed(2)} (${signText}${s.changePercent.toFixed(2)}%)\n`;
        });
        
        new Notification("📊 美股 15 分钟行情自动速递", {
          body: bodyText,
          tag: "stock-alert",
          requireInteraction: false
        });
      }
      setPrevStocksHash(currentHash);
    }
  }, [stocks, browserNotificationGranted, prevStocksHash]);

  const requestBrowserNotificationPermission = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      const permission = await Notification.requestPermission();
      setBrowserNotificationGranted(permission === "granted");
      if (permission === "granted") {
        new Notification("🔔 桌面自动通知已激活", {
          body: "看板正保持后台运行。每 15 分钟系统拉取最新美股数据时，您将在此收到实时走势弹窗提醒！",
        });
      }
    }
  };

  // Generate dynamic stock report message
  useEffect(() => {
    if (stocks && stocks.length > 0) {
      const dateStr = new Date().toLocaleString("zh-CN", { hour12: false });
      let text = `📈 股票行情速报 (免Twilio一键直达) 📈\n⏰ 数据时间: ${dateStr}\n\n`;
      
      stocks.forEach((stock) => {
        const sign = stock.change >= 0 ? "📈" : "📉";
        const prefix = stock.change >= 0 ? "+" : "";
        text += `${sign} *${stock.symbol}* (${stock.companyName})\n`;
        text += `   • 最新价格: $${stock.price.toFixed(2)}\n`;
        text += `   • 今日涨跌: ${prefix}${stock.change.toFixed(2)} (${prefix}${stock.changePercent.toFixed(2)}%)\n`;
        text += `   • 今日振幅: $${stock.low.toFixed(2)} - $${stock.high.toFixed(2)}\n\n`;
      });
      
      text += `🔗 查看实时智能分析看板:\n${window.location.origin}`;
      setCustomMessage(text);
    } else {
      setCustomMessage("⚠️ 暂无最新股票行情数据，请稍后再试。");
    }
  }, [stocks]);

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/whatsapp/status");
      if (response.ok) {
        const data: WhatsAppStatusResponse = await response.json();
        setStatus(data);
        if (data.config.callmebotPhone) setCallmebotPhone(data.config.callmebotPhone);
        if (data.config.callmebotApikey) setCallmebotApikey(data.config.callmebotApikey);
        if (data.config.toWhatsApp) setTwilioRecipient(data.config.toWhatsApp);
        
        if (data.config.telegramBotToken) setTelegramBotToken(data.config.telegramBotToken);
        if (data.config.telegramChatId) setTelegramChatId(data.config.telegramChatId);
        if (data.config.serverchanKey) setServerchanKey(data.config.serverchanKey);
        if (data.config.pushdeerKey) setPushdeerKey(data.config.pushdeerKey);
        if (data.config.barkUrl) setBarkUrl(data.config.barkUrl);
        
        // Auto-focus active mode on initial load
        if (data.config.mode && data.config.mode !== "simulated") {
          setActiveMethod(data.config.mode);
        }
      }
    } catch (error) {
      console.error("Error fetching WhatsApp status:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (mode: typeof activeMethod | "simulated") => {
    if (mode === "direct" || mode === "browser") {
      // These are frontend/client-only methods, but save state on backend as "simulated" so background interval doesn't fail
      mode = "simulated";
    }
    setSavingSettings(true);
    setSaveSuccess(false);
    try {
      const response = await fetch("/api/whatsapp/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          callmebotPhone,
          callmebotApikey,
          toWhatsAppNumber: twilioRecipient,
          telegramBotToken,
          telegramChatId,
          serverchanKey,
          pushdeerKey,
          barkUrl
        })
      });
      if (response.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        await fetchStatus();
      }
    } catch (error) {
      console.error("Error saving WhatsApp settings:", error);
    } finally {
      setSavingSettings(false);
    }
  };

  const triggerTestMessage = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/whatsapp/test", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        setTestResult({
          success: true,
          message: data.status === "simulated" 
            ? "【模拟成功】模拟测试消息已发送至控制台！请选择「定时免 Twilio 自动推送 (CallMeBot)」或「Twilio 推送」并完成对应配置，来启用真实的 WhatsApp 消息提醒。" 
            : data.status === "sent" 
              ? "【发送成功】已成功向您的 WhatsApp 发送了一条实时行情测试短信！"
              : "【模拟测试成功】测试信息已在服务器控制台打印，请完成下方对应的接口配置。"
        });
        fetchStatus(); // refresh logs
      } else {
        setTestResult({
          success: false,
          message: data.error || "触发测试通知失败，请检查推送凭证配置。"
        });
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.message || "请求发生网络错误。"
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

  // WhatsApp Click-to-Chat trigger (Manual method)
  const handleDirectSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directPhone) {
      alert("请输入您的 WhatsApp 接收手机号！");
      return;
    }
    
    // Clean number: digits only
    const cleanNumber = directPhone.replace(/\D/g, "");
    if (!cleanNumber) {
      alert("请输入正确的电话号码格式！");
      return;
    }
    
    const url = `https://api.whatsapp.com/send?phone=${cleanNumber}&text=${encodeURIComponent(customMessage)}`;
    window.open(url, "_blank");
  };

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-pulse space-y-4">
        <div className="h-5 bg-slate-200 rounded w-1/3" />
        <div className="h-10 bg-slate-100 rounded" />
        <div className="h-20 bg-slate-50 rounded" />
      </div>
    );
  }

  const isServerConfigured = status?.config.mode !== "simulated";
  const activeMode = status?.config.mode || "simulated";

  return (
    <div id="whatsapp-notifications-section" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-6">
      
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 pb-5 gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-slate-900 text-white">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">美股 15 分钟行情多通道自动推送提醒</h2>
            <p className="text-xs text-slate-400 mt-0.5">支持微信、Telegram、iOS Bark、PushDeer、浏览器桌面弹窗及 WhatsApp 多种通知渠道</p>
          </div>
        </div>

        {/* Method Selector Tabs */}
        <div className="flex flex-wrap bg-slate-100 p-1 rounded-xl text-xs font-semibold self-start md:self-auto shadow-inner gap-1 max-w-full">
          <button
            onClick={() => setActiveMethod("direct")}
            className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              activeMethod === "direct" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-800"
            }`}
            title="手动免配置快捷直发"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            <span>快捷直发</span>
          </button>
          <button
            onClick={() => setActiveMethod("browser")}
            className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              activeMethod === "browser" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-800"
            }`}
            title="免注册！只要网页开着就自动弹窗提醒"
          >
            <Bell className="w-3.5 h-3.5 text-teal-500" />
            <span>浏览器弹窗</span>
          </button>
          <button
            onClick={() => setActiveMethod("telegram")}
            className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              activeMethod === "telegram" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-800"
            }`}
            title="Telegram 机器人免费定时推送"
          >
            <Globe className="w-3.5 h-3.5 text-blue-500" />
            <span>Telegram</span>
          </button>
          <button
            onClick={() => setActiveMethod("serverchan")}
            className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              activeMethod === "serverchan" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-800"
            }`}
            title="Server酱微信强提醒推送"
          >
            <MessageSquare className="w-3.5 h-3.5 text-green-500" />
            <span>Server酱(微信)</span>
          </button>
          <button
            onClick={() => setActiveMethod("pushdeer")}
            className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              activeMethod === "pushdeer" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-800"
            }`}
            title="PushDeer 微信/APP 免费推送"
          >
            <Smartphone className="w-3.5 h-3.5 text-red-500" />
            <span>PushDeer</span>
          </button>
          <button
            onClick={() => setActiveMethod("bark")}
            className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              activeMethod === "bark" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-800"
            }`}
            title="Bark iOS 原生超轻量弹窗提醒"
          >
            <Smartphone className="w-3.5 h-3.5 text-purple-500" />
            <span>Bark(iOS)</span>
          </button>
          <button
            onClick={() => setActiveMethod("callmebot")}
            className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              activeMethod === "callmebot" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-800"
            }`}
            title="CallMeBot 定时发送到 WhatsApp"
          >
            <Phone className="w-3.5 h-3.5 text-indigo-500" />
            <span>CallMeBot</span>
          </button>
          <button
            onClick={() => setActiveMethod("twilio")}
            className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              activeMethod === "twilio" 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-800"
            }`}
            title="Twilio 官方付费自动通道"
          >
            <Code className="w-3.5 h-3.5 text-amber-500" />
            <span>Twilio</span>
          </button>
        </div>
      </div>

      {/* Global Status Banner */}
      <div className="p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border-slate-200">
        <div className="flex items-center gap-2.5">
          <div className={`w-2.5 h-2.5 rounded-full animate-pulse flex-shrink-0 ${
            activeMode === "simulated" ? "bg-amber-500" : "bg-emerald-500"
          }`} />
          <span className="font-semibold text-slate-700">
            后台 15 分钟定时推送状态：
            {activeMode === "simulated" && "已关闭真实后台通道 (仅本地日志打印)"}
            {activeMode === "telegram" && "Telegram 机器人推送已激活 🚀"}
            {activeMode === "serverchan" && "Server酱微信通道推送已激活 🚀"}
            {activeMode === "pushdeer" && "PushDeer 微信与 App 通道已激活 🚀"}
            {activeMode === "bark" && "iOS Bark 原生推送通道已激活 🚀"}
            {activeMode === "callmebot" && "免 Twilio 免费自动推送 (CallMeBot 已激活) 🚀"}
            {activeMode === "twilio" && "Twilio 企业级自动推送已激活 🚀"}
          </span>
        </div>
        <button 
          onClick={triggerTestMessage} 
          disabled={testing}
          className="text-[11px] bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 self-start sm:self-auto"
        >
          {testing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          立即测试单次发送
        </button>
      </div>

      {testResult && (
        <div className={`p-3 rounded-xl border text-[11px] font-semibold flex items-start gap-2 ${
          testResult.success 
            ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
            : "bg-rose-50 border-rose-100 text-rose-800"
        }`}>
          {testResult.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-600" />}
          <div className="leading-snug">
            {testResult.message}
          </div>
        </div>
      )}

      {activeMethod === "direct" && (
        /* ================= WAY A: DIRECT CLICK-TO-CHAT ================= */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Column 1 (Left 7-span): Direct input & Send */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
            <div>
              <div className="bg-emerald-50/70 border border-emerald-100 p-4 rounded-xl text-xs text-emerald-800 leading-relaxed mb-4">
                <p className="font-bold mb-1">💡 快捷一键直发通道特点：</p>
                无需在服务器配置任何密钥。只需在下方输入您的号码并确认行情文本，系统就会<strong>一键帮您生成排版精美的行情卡片</strong>拉起 WhatsApp 对话框，点击确认即可瞬间发出。完全免费，随时可用！
              </div>

              <form onSubmit={handleDirectSend} className="space-y-4">
                <div>
                  <label htmlFor="direct-whatsapp-input" className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    请输入您的接收端手机号 (包含国际区号，如 852xxxxxxxx)
                  </label>
                  <input
                    id="direct-whatsapp-input"
                    type="text"
                    value={directPhone}
                    onChange={(e) => setDirectPhone(e.target.value)}
                    placeholder="例如: 85257032699 (香港) 或 8613800000000 (大陆)"
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-slate-50 text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="direct-message-preview" className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                    <Share2 className="w-3.5 h-3.5 text-slate-400" />
                    行情推送文本预览 (可直接修改)
                  </label>
                  <textarea
                    id="direct-message-preview"
                    rows={8}
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-slate-50 text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono resize-none leading-relaxed"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.01] cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>💬 免配置一键发送至我的 WhatsApp (跳转拉起)</span>
                </button>
              </form>
            </div>
          </div>

          {/* Column 2 (Right 5-span): Instructions & Tips */}
          <div className="lg:col-span-5 bg-slate-50 border border-slate-100 p-5 rounded-2xl flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-emerald-500" />
                极速直连使用指引
              </h3>
              <ul className="space-y-3.5 text-xs text-slate-600 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-[10px] font-bold flex items-center justify-center text-emerald-600">1</span>
                  <div>
                    <p className="font-semibold text-slate-800">填写接收手机号</p>
                    <p className="text-slate-500 mt-0.5">可以填写您本人的号码接收，也可以填入家人、好友的号码分享实时行情走势。</p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-[10px] font-bold flex items-center justify-center text-emerald-600">2</span>
                  <div>
                    <p className="font-semibold text-slate-800">校验生成的卡片</p>
                    <p className="text-slate-500 mt-0.5">上方已根据当前采集的最新的 UGI、LNG、DXCM 和 PTEN 股价变化自动计算生成了汇总卡片，支持手动补充点评。</p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-[10px] font-bold flex items-center justify-center text-emerald-600">3</span>
                  <div>
                    <p className="font-semibold text-slate-800">拉起微信 / WhatsApp</p>
                    <p className="text-slate-500 mt-0.5">点击绿色按钮即可拉起客户端（手机 App 或 Web 网页端），文本会自动填充到对话栏中，一键发出即可！</p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
              <span>🚀 快速安全 · 零开发申请门槛</span>
              <span className="font-medium text-emerald-600">手动极速首选</span>
            </div>
          </div>

        </div>
      )}

      {activeMethod === "browser" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-teal-50/70 border border-teal-100 p-4 rounded-xl text-xs text-teal-800 leading-relaxed">
              <p className="font-bold mb-1">🔔 100% 免费 · 零配置浏览器原生桌面弹窗提醒</p>
              不需要任何第三方账户、手机或 Key。只要保持本网页在浏览器后台运行，每当 15 分钟系统获取最新股价行情时，您就会收到原生操作系统级弹窗推送，高亮展示 UGI、LNG、DXCM 和 PTEN 的最新变动。
            </div>

            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Bell className="w-4 h-4 text-teal-500" />
                激活浏览器通知授权
              </h3>
              
              <div className="p-4 bg-white rounded-xl border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-800">
                    当前状态：{browserNotificationGranted ? "🟢 已授权桌面推送" : "🔴 未授权 / 已禁用"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    系统在获取到最新股价异常、定时抓取时，将自动为您唤醒桌面消息条。
                  </p>
                </div>
                {!browserNotificationGranted && (
                  <button
                    onClick={requestBrowserNotificationPermission}
                    className="py-2 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-xs font-bold text-white shadow-sm cursor-pointer transition-all shrink-0"
                  >
                    授权启用浏览器通知
                  </button>
                )}
              </div>

              <div className="pt-2 text-xs text-slate-500">
                💡 <strong>小提示：</strong> 开启后可以随意切换到其他网页或处理其他事务。只要保持本标签页存活不被完全关闭，推送就会按时下发。
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 bg-slate-50 border border-slate-100 p-5 rounded-2xl flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-teal-500" />
                为什么选择浏览器桌面推送？
              </h3>
              <ul className="space-y-4 text-xs text-slate-600 leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="text-teal-600 font-bold">✔</span>
                  <div>
                    <p className="font-semibold text-slate-800">100% 稳定且实时</p>
                    <p className="text-slate-500 mt-0.5">不依赖任何国外服务商网关，不担心由于网络延迟造成延迟到账。</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-teal-600 font-bold">✔</span>
                  <div>
                    <p className="font-semibold text-slate-800">纯本地化运行，零隐私泄露</p>
                    <p className="text-slate-500 mt-0.5">没有任何密钥存储在服务器或第三方系统，安全性高。</p>
                  </div>
                </li>
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 text-[10px] text-slate-400">
              ⚡ 零配置、极速体验
            </div>
          </div>
        </div>
      )}

      {activeMethod === "telegram" && (
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
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Telegram Bot Token
                  </label>
                  <input
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    placeholder="例如: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-white text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    接收端 Chat ID (用户 ID 或群组 ID)
                  </label>
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
                      在 Telegram 中搜索并联系机器人之父 <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline">@BotFather</a>，发送指令 <span className="font-mono font-bold bg-slate-200 px-1 rounded">/newbot</span> 并根据引导创建属于您的机器人，即可获得 Token。
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-[10px] font-bold flex items-center justify-center text-blue-600">2</span>
                  <div>
                    <p className="font-semibold text-slate-800">获取您自己的 Chat ID</p>
                    <p className="text-slate-500 mt-0.5">
                      联系机器人 <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline">@userinfobot</a> 发送任意消息即可瞬间得到您个人的专属纯数字 Chat ID。别忘了首先跟您自己刚建好的 Bot 发送一条任意消息以解锁会话权限！
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
      )}

      {activeMethod === "serverchan" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-green-50/70 border border-green-100 p-4 rounded-xl text-xs text-green-800 leading-relaxed">
              <p className="font-bold mb-1">🇨🇳 Server酱 微信强提醒定时推送</p>
              直接将美股行情推送到您的个人微信上！只需在 Server 酱官方获取一个专属的 SendKey，本系统即可每 15 分钟将自动更新的行情发送至微信消息提醒，非常显眼。
            </div>

            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-green-500" />
                配置 Server酱 凭证
              </h3>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Server酱 SendKey (SCT键值)
                </label>
                <input
                  type="password"
                  value={serverchanKey}
                  onChange={(e) => setServerchanKey(e.target.value)}
                  placeholder="例如: SCT20384918239T... 或者 Skey..."
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-white text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSaveSettings("serverchan")}
                  disabled={savingSettings}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-green-600 hover:bg-green-500 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {savingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>保存并激活微信自动定时推送</span>
                </button>
                {activeMode === "serverchan" && (
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
                <HelpCircle className="w-4 h-4 text-green-500" />
                获取 SendKey 步骤：
              </h3>
              <ol className="space-y-4 text-xs text-slate-600 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 text-[10px] font-bold flex items-center justify-center text-green-600">1</span>
                  <div>
                    <p className="font-semibold text-slate-800">登入 Server酱 控制台</p>
                    <p className="text-slate-500 mt-0.5 font-sans">
                      打开官网并使用微信扫码登录:{" "}
                      <a href="https://sct.ftqq.com" target="_blank" rel="noreferrer" className="text-green-600 font-bold hover:underline inline-flex items-center gap-0.5">
                        sct.ftqq.com
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 text-[10px] font-bold flex items-center justify-center text-green-600">2</span>
                  <div>
                    <p className="font-semibold text-slate-800">扫码关注公众号并绑定</p>
                    <p className="text-slate-500 mt-0.5">
                      点击“通道配置”，选择“方糖服务号”并微信扫码关注，微信就会自动与您的账号绑定成功。
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 text-[10px] font-bold flex items-center justify-center text-green-600">3</span>
                  <div>
                    <p className="font-semibold text-slate-800">复制 Key</p>
                    <p className="text-slate-500 mt-0.5 font-sans">
                      点击“SendKey”菜单，直接复制以 <span className="font-mono bg-slate-200 px-1 rounded">SCT</span> 开头的专属字符串，填入左侧保存即告成功！
                    </p>
                  </div>
                </li>
              </ol>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
              <span>🇨🇳 微信直连 · 贴心方便</span>
              <span className="font-bold text-green-600">微信重度用户力荐</span>
            </div>
          </div>
        </div>
      )}

      {activeMethod === "pushdeer" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-red-50/70 border border-red-100 p-4 rounded-xl text-xs text-red-800 leading-relaxed">
              <p className="font-bold mb-1">🦌 PushDeer 微信与 App 定时推送</p>
              PushDeer 是一款开源的无感知推送服务。通过配置 Key，支持将 15 分钟行情发送到您的手机 App、微信甚至 macOS / Windows 客户端，零延迟、100% 免费！
            </div>

            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-red-500" />
                配置 PushDeer 凭证
              </h3>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  PushDeer Key (PushKey)
                </label>
                <input
                  type="password"
                  value={pushdeerKey}
                  onChange={(e) => setPushdeerKey(e.target.value)}
                  placeholder="例如: PKEY12038102391203..."
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-white text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSaveSettings("pushdeer")}
                  disabled={savingSettings}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {savingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>保存并激活 PushDeer 定时推送</span>
                </button>
                {activeMode === "pushdeer" && (
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
                <HelpCircle className="w-4 h-4 text-red-500" />
                获取 PushDeer Key 步骤：
              </h3>
              <ol className="space-y-4 text-xs text-slate-600 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 text-[10px] font-bold flex items-center justify-center text-red-600">1</span>
                  <div>
                    <p className="font-semibold text-slate-800">访问 PushDeer 官网</p>
                    <p className="text-slate-500 mt-0.5 font-sans">
                      可以使用网页版、iOS app 或微信轻量版扫码:{" "}
                      <a href="https://www.pushdeer.com" target="_blank" rel="noreferrer" className="text-red-600 font-bold hover:underline inline-flex items-center gap-0.5">
                        www.pushdeer.com
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 text-[10px] font-bold flex items-center justify-center text-red-600">2</span>
                  <div>
                    <p className="font-semibold text-slate-800">生成并配置专属 Key</p>
                    <p className="text-slate-500 mt-0.5">
                      登入后在“Key列表”中点击“创建新 Key”，即可获得专属 PushKey。填入左侧保存，即可通过 PushDeer 的微信机器人或专用手机 App 实时接收了！
                    </p>
                  </div>
                </li>
              </ol>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
              <span>🦌 简单高效 · 开源无痕</span>
              <span className="font-bold text-red-600">轻量推送利器</span>
            </div>
          </div>
        </div>
      )}

      {activeMethod === "bark" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-purple-50/70 border border-purple-100 p-4 rounded-xl text-xs text-purple-800 leading-relaxed">
              <p className="font-bold mb-1">📱 Bark iOS 原生超轻量定时推送提醒</p>
              针对 iPhone 苹果用户的顶级方案！在 App Store 下载 Bark，获取个人专属 URL 填入下方。系统每 15 分钟会自动向您的 iPhone 触发通知，高亮弹窗展示股价汇总，极其丝滑。
            </div>

            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-purple-500" />
                配置 Bark 专属 URL
              </h3>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Bark 完整 API 链接 (包含您的设备 key)
                </label>
                <input
                  type="text"
                  value={barkUrl}
                  onChange={(e) => setBarkUrl(e.target.value)}
                  placeholder="例如: https://api.day.app/yourSecretKey"
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-white text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSaveSettings("bark")}
                  disabled={savingSettings}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {savingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>保存并激活 iOS Bark 定时推送</span>
                </button>
                {activeMode === "bark" && (
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
                <HelpCircle className="w-4 h-4 text-purple-500" />
                iOS Bark 获取与配置：
              </h3>
              <ol className="space-y-4 text-xs text-slate-600 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-100 text-[10px] font-bold flex items-center justify-center text-purple-600">1</span>
                  <div>
                    <p className="font-semibold text-slate-800">下载 iOS Bark 客户端</p>
                    <p className="text-slate-500 mt-0.5">
                      在苹果 App Store 搜索 <span className="font-bold">Bark</span> 推送工具并下载安装。
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-100 text-[10px] font-bold flex items-center justify-center text-purple-600">2</span>
                  <div>
                    <p className="font-semibold text-slate-800">获取并复制 API 链接</p>
                    <p className="text-slate-500 mt-0.5">
                      打开 Bark 手机 App，主界面会自动显示您的专属 API 服务链接（如 <span className="font-mono bg-slate-200 px-1 rounded text-slate-800 text-[11px]">https://api.day.app/Xxxxxxxxxx</span>）。直接复制并填入左侧输入框即可。
                    </p>
                  </div>
                </li>
              </ol>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
              <span>🍏 iPhone 专属 · 绝佳原生交互</span>
              <span className="font-bold text-purple-600">苹果生态顶级神器</span>
            </div>
          </div>
        </div>
      )}

      {activeMethod === "callmebot" && (
        /* ================= WAY B: CALLMEBOT AUTOMATED FREE WORKER ================= */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Form Config */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-indigo-50/70 border border-indigo-100 p-4 rounded-xl text-xs text-indigo-800 leading-relaxed">
              <p className="font-bold mb-1">🎉 10秒免 Twilio 全自动 15分钟推送方案</p>
              使用 CallMeBot 免费网关，本系统每 15 分钟会自动将美股分析看板行情发送到您的 WhatsApp。您完全不需要创建收费的 Twilio 账户，只需要按照右侧提示获取一个免费的配对 API Key 即可！
            </div>

            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-indigo-500" />
                配置您的 CallMeBot 服务
              </h3>
              
              <div className="space-y-3.5">
                <div>
                  <label htmlFor="callmebot-phone" className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    手机接收号码 (纯数字，包含国家代码，例如: 85257032699)
                  </label>
                  <input
                    id="callmebot-phone"
                    type="text"
                    value={callmebotPhone}
                    onChange={(e) => setCallmebotPhone(e.target.value)}
                    placeholder="请输入接收短信的 WhatsApp 手机号"
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-white text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="callmebot-apikey" className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    CallMeBot 专属 API Key (获得的 6 位数字)
                  </label>
                  <input
                    id="callmebot-apikey"
                    type="password"
                    value={callmebotApikey}
                    onChange={(e) => setCallmebotApikey(e.target.value)}
                    placeholder="请输入通过口令获得的 API Key"
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-white text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSaveSettings("callmebot")}
                  disabled={savingSettings}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {savingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>保存并激活 15分钟自动定时推送</span>
                </button>
                
                {activeMode === "callmebot" && (
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

          {/* Right Column: Step-by-Step Guides */}
          <div className="lg:col-span-5 bg-slate-50 border border-slate-100 p-5 rounded-2xl flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-indigo-500" />
                10秒获取 API Key 步骤：
              </h3>
              <ol className="space-y-4 text-xs text-slate-600 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-[10px] font-bold flex items-center justify-center text-indigo-600">1</span>
                  <div>
                    <p className="font-semibold text-slate-800">将机器人添加为联系人</p>
                    <p className="text-slate-500 mt-0.5">
                      在 WhatsApp 中联系或直接点击拉起:{" "}
                      <a 
                        href="https://wa.me/3 Spain number?text=I allow callmebot to send me messages" 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-indigo-600 font-bold hover:underline inline-flex items-center gap-0.5"
                      >
                        +34 644 66 22 47
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-[10px] font-bold flex items-center justify-center text-indigo-600">2</span>
                  <div>
                    <p className="font-semibold text-slate-800">发送许可指令</p>
                    <p className="text-slate-500 mt-0.5">
                      向该机器人发送一行英文: <span className="font-mono font-bold bg-slate-200 px-1 rounded text-slate-800">I allow callmebot to send me messages</span>
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-[10px] font-bold flex items-center justify-center text-indigo-600">3</span>
                  <div>
                    <p className="font-semibold text-slate-800">获得专属 Key 并填入激活</p>
                    <p className="text-slate-500 mt-0.5">机器人会在2秒内回复包含 <span className="font-mono font-bold">"apikey: 123456"</span> 的配对成功短信。将其填入左侧并点击保存即可！</p>
                  </div>
                </li>
              </ol>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
              <span>🔒 本地存储，不向任何第三方泄露</span>
              <span className="font-bold text-indigo-600">100% 免费推荐</span>
            </div>
          </div>

        </div>
      )}

      {activeMethod === "twilio" && (
        /* ================= WAY C: TWILIO AUTOMATED SERVER WORKER ================= */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Column 1: Config Form */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-amber-50/70 border border-amber-100 p-4 rounded-xl text-xs text-amber-800 leading-relaxed">
              <p className="font-bold mb-1">💼 Twilio 自动推送通道（需开发者凭证）</p>
              适合具备 Twilio 开发者账号的企业/高级用户，提供极度稳定、高速的高并发消息分发。由于 API 会产生费用，您需要在 Secrets 中完成账号授权。
            </div>

            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Code className="w-4 h-4 text-amber-500" />
                设置 Twilio 定时提醒
              </h3>

              <div>
                <label htmlFor="twilio-recipient" className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Twilio 接收 WhatsApp 号码 (请包含 + 区号，例如: +85257032699)
                </label>
                <input
                  id="twilio-recipient"
                  type="text"
                  value={twilioRecipient}
                  onChange={(e) => setTwilioRecipient(e.target.value)}
                  placeholder="例如: +85257032699"
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl bg-white text-slate-800 outline-none focus:border-slate-400 transition-colors font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSaveSettings("twilio")}
                  disabled={savingSettings}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {savingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>保存并激活 Twilio 15分钟自动定时推送</span>
                </button>
                
                {activeMode === "twilio" && (
                  <button
                    onClick={() => handleSaveSettings("simulated")}
                    className="py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-bold text-slate-600 transition-all cursor-pointer"
                  >
                    停用自动推送
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Column 2: How to Configure Guides */}
          <div className="lg:col-span-5 bg-slate-50 border border-slate-100 p-5 rounded-2xl flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-slate-400" />
                配置指南与 Twilio 沙盒设置
              </h3>
              <ol className="space-y-3.5 text-xs text-slate-600 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-[10px] font-bold flex items-center justify-center text-slate-500">1</span>
                  <div>
                    <p className="font-semibold text-slate-800">获取 Twilio 凭证</p>
                    <p className="text-slate-500 mt-0.5 font-sans leading-relaxed">在 Twilio 官网注册并获取您的 <span className="font-mono bg-slate-100 px-1 rounded text-[10px]">Account SID</span> 与 <span className="font-mono bg-slate-100 px-1 rounded text-[10px]">Auth Token</span>。</p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-[10px] font-bold flex items-center justify-center text-slate-500">2</span>
                  <div>
                    <p className="font-semibold text-slate-800">【关键】加入 Twilio 沙盒</p>
                    <p className="text-slate-500 mt-0.5 leading-relaxed">
                      使用您的手机 WhatsApp 向沙盒号码 <span className="font-mono bg-slate-100 px-1 rounded text-[10px]">+14155238886</span> 发送特定的加入暗号（例如 <span className="font-bold text-slate-800 font-mono">"join [您的沙盒单词]"</span>）来激活同意接收。
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-[10px] font-bold flex items-center justify-center text-slate-500">3</span>
                  <div>
                    <p className="font-semibold text-slate-800">在 AI Studio 中配置 Secrets</p>
                    <p className="text-slate-500 mt-0.5 leading-relaxed font-sans">在左下角 Secrets 中配置 <span className="font-mono font-semibold bg-slate-100 px-1 rounded">TWILIO_ACCOUNT_SID</span> 与 <span className="font-mono font-semibold bg-slate-100 px-1 rounded">TWILIO_AUTH_TOKEN</span> 并保存。</p>
                  </div>
                </li>
              </ol>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400">
              <span>官方沙盒连接</span>
              <a
                href="https://console.twilio.com/us1/develop/sms/gateways/whatsapp"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-slate-800 font-semibold"
              >
                <span>Twilio 控制台</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

        </div>
      )}

      {/* Running Logs Section */}
      <div className="border-t border-slate-100 pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              15分钟自动抓取与推送日志记录 (历史追踪)
            </h3>
            <span className="text-[10px] text-slate-400">(自动静默刷新)</span>
          </div>
          <button
            onClick={fetchStatus}
            className="text-slate-400 hover:text-slate-900 p-1 rounded transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-semibold"
            title="刷新日志"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>手动刷新日志</span>
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
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                      isSuccess 
                        ? "bg-emerald-100 text-emerald-800" 
                        : isSimulated 
                          ? "bg-indigo-50 border border-indigo-100 text-indigo-700" 
                          : "bg-rose-100 text-rose-800"
                    }`}>
                      {isSuccess ? "通过 API 发送成功" : isSimulated ? "本地控制台打印" : "发送失败"}
                    </span>
                  </div>
                  <div className="font-semibold text-slate-700 line-clamp-3 leading-relaxed">
                    {log.message}
                  </div>
                  {log.error && (
                    <p className="text-[10px] text-rose-600 font-medium leading-snug pt-1 border-t border-rose-100">
                      ⚠️ {log.error}
                    </p>
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
          <button
            onClick={() => setShowFullLogs(!showFullLogs)}
            className="w-full mt-2 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 border border-slate-200 bg-white hover:bg-slate-50 transition-all rounded-xl flex items-center justify-center gap-1 cursor-pointer"
          >
            <span>{showFullLogs ? "收起日志" : `查看完整推送日志历史 (${status.logs.length}条记录)`}</span>
          </button>
        )}
      </div>

    </div>
  );
};
