export default async function handler(req: any, res: any) {
  console.log("Vercel Cron 触发：正在抓取股票并发送推送...");
  
  // 15分钟自动推送逻辑写在这里
  
  return res.status(200).json({ success: true, timestamp: new Date().toISOString() });
}
