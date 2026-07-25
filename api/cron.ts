
export default async function handler(req: any, res: any) {
  console.log("Vercel Cron 触发：正在抓取股票并发送推送...");
  
  // 这里写发送消息（WhatsApp / Telegram / PushDeer / Bark）的逻辑
  
  return res.status(200).json({ success: true, timestamp: new Date().toISOString() });
}
