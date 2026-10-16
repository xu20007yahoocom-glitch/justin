import React from "react";
import { StockQuote } from "../types";

interface WhatsAppNotificationsProps {
  stocks?: StockQuote[];
}

export const WhatsAppNotifications: React.FC<WhatsAppNotificationsProps> = () => (
  <section
    id="whatsapp-notifications-section"
    className="flex flex-col gap-3 border-t border-slate-200 py-5"
    aria-labelledby="telegram-notifications-title"
  >
    <div className="flex flex-wrap items-center gap-3">
      <h2 id="telegram-notifications-title" className="text-base font-semibold text-slate-900">
        Telegram 通知
      </h2>
      <span className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
        暫時停用
      </span>
    </div>
    <p className="text-sm text-slate-700">
      Telegram 通知設定暫時停用，待安全登入系統完成後重新啟用。
    </p>
    <p className="text-sm text-slate-600">
      為保護通知憑證與聊天識別資訊，目前無法在此頁面查看或修改設定。
    </p>
  </section>
);
