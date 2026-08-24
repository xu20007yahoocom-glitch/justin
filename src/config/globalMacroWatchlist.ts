export type WatchlistPriority = 4 | 5;

export interface ThemeFramework {
  id: "energy" | "rates" | "supply" | "news";
  code: "A" | "B" | "C" | "D";
  title: string;
  overviewTitle: string;
  coreIndicators: string;
  impactedMarkets: string;
  focus: string;
  priority: WatchlistPriority;
  keyDrivers: string;
}

export interface MetricFramework {
  drivers: string;
  impactedMarkets: string;
  focus: string;
  priority: WatchlistPriority;
}

export const WATCHLIST_SUBTITLE = "以通胀传导、全球流动性、能源供需与政策敏感度整理";
export const WATCHLIST_DATA_NOTICE = "本板块将公开宏观数据按主题传导关系整理，重点观察能源价格、政策利率、公债收益率、主要能源国供需及地缘事件。数据可能存在发布延迟，具体日期与频率以各指标标记为准。";
export const WATCHLIST_PURPOSE = "将分散的利率、能源、供需与新闻资料整理为可持续跟踪的宏观 Watchlist。重点不是预测单一资产涨跌，而是观察宏观变化如何向股票、债券、外汇、能源、工业和防御板块传导。";
export const WATCHLIST_DISCLAIMER = "观察优先级仅反映指标对市场主题的传导能力，不代表看多、看空或价格预测，也不构成投资建议。";
export const WATCHLIST_PRIORITY_NOTICE = "编辑性观察优先级，并非投资评级或市场趋势预测。";
export const WATCHLIST_STATUS_NOTICE = "观察优先级为编辑性分类，只反映主题传导能力，不代表实时市场强弱。";

export const CORE_PRIORITIES = [
  "美国政策利率与国债收益率",
  "WTI 与 Brent",
  "主要央行政策利率",
  "主要能源国供需",
  "Henry Hub 天然气",
  "地缘政治与经济新闻"
] as const;

export const THEME_FRAMEWORKS: readonly ThemeFramework[] = [
  {
    id: "energy", code: "A", title: "能源与通胀传导", overviewTitle: "能源与通胀传导",
    coreIndicators: "WTI、Brent、Henry Hub 天然气、黄金",
    impactedMarkets: "能源、运输、工业、通胀预期、避险资产",
    focus: "价格趋势、供给变化、能源成本与风险偏好",
    priority: 5,
    keyDrivers: "能源供需、库存、天气、运输与地缘风险"
  },
  {
    id: "rates", code: "B", title: "利率与全球流动性", overviewTitle: "利率与全球流动性",
    coreIndicators: "政策利率、10 年期公债收益率及现有系统已取得的利率指标",
    impactedMarkets: "股票估值、债券、外汇、金融、成长型资产",
    focus: "政策方向、收益率变化与国家间利差",
    priority: 5,
    keyDrivers: "央行政策、通胀、经济增长与债券供需"
  },
  {
    id: "supply", code: "C", title: "全球能源供需", overviewTitle: "全球能源供需",
    coreIndicators: "石油消费／产量、天然气消费／产量、电力消费",
    impactedMarkets: "能源生产商、公用事业、工业、运输和能源安全",
    focus: "主要国家需求、产量、能源结构与数据频率",
    priority: 4,
    keyDrivers: "能源需求、产量、经济活动与能源安全"
  },
  {
    id: "news", code: "D", title: "政策、地缘与新闻", overviewTitle: "政策、地缘与新闻",
    coreIndicators: "地缘政治新闻、全球经济相关新闻",
    impactedMarkets: "能源、国防、航运、外汇、避险资产",
    focus: "政策变化、制裁、冲突、供应链及宏观事件",
    priority: 4,
    keyDrivers: "政策公告、制裁、冲突、供应链及宏观事件"
  }
] as const;

export const ENERGY_METRIC_FRAMEWORK: Readonly<Record<string, MetricFramework>> = {
  "WTI 原油": {
    drivers: "美国供需、库存、产量与地缘风险", impactedMarkets: "能源、运输、通胀预期", focus: "价格方向、数据日期及供给变化", priority: 5
  },
  "Brent 原油": {
    drivers: "全球海运原油供需与地缘事件", impactedMarkets: "全球能源、航运、通胀预期", focus: "与 WTI 的相对变化及全球供应风险", priority: 5
  },
  "Henry Hub 天然气": {
    drivers: "天气、库存、发电需求与 LNG 出口", impactedMarkets: "公用事业、化工、LNG、能源生产商", focus: "季节性、库存与供需变化", priority: 4
  },
  "黄金现货价": {
    drivers: "实际利率、美元、避险需求与央行需求", impactedMarkets: "贵金属、矿业、避险资产", focus: "利率、美元及风险事件", priority: 4
  }
};

export const CORE_WATCHLIST_RANKS = [
  { rank: 1, key: "us-rates", item: "美国政策利率与国债收益率", theme: "全球流动性／估值", reason: "对全球债券、美元及风险资产估值具有较强传导能力。" },
  { rank: 2, key: "wti-brent", item: "WTI 与 Brent", theme: "能源／通胀", reason: "反映能源成本、供需及地缘风险的重要公开指标。" },
  { rank: 3, key: "global-policy", item: "主要央行政策利率", theme: "全球金融条件", reason: "用于观察不同经济体的政策方向和利率差异。" },
  { rank: 4, key: "us-china-energy", item: "美国与中国能源供需", theme: "全球需求／能源安全", reason: "用于观察主要能源消费经济体的需求与产量变化。" },
  { rank: 5, key: "henry-hub", item: "Henry Hub 天然气", theme: "天然气／LNG／电力", reason: "与美国天然气、发电及 LNG 供需相关。" },
  { rank: 6, key: "macro-news", item: "地缘政治与经济新闻", theme: "事件风险", reason: "用于补充硬数据无法即时反映的政策和供应链事件。" }
] as const;

export const CORE_JUDGMENT_NOTICE = "宏观指标应结合观察：能源价格反映成本与供需变化，政策利率及公债收益率反映金融条件，能源消费与产量反映实体需求和供应能力，新闻事件用于补充政策及地缘冲击。单一指标不足以形成市场方向判断。";
export const USAGE_NOTICE = "建议将宏观 Watchlist 分成第一层核心指标与第二层主题资料。先观察政策利率、国债收益率和能源价格，再检查主要国家的能源供需，最后结合地缘及经济新闻判断可能的传导路径。数据发布日期与频率不同，不能把所有指标视为同一时间截面的实时数据。";
export const MONITORING_SEQUENCE = ["政策利率及公债收益率", "能源价格", "主要国家能源消费与产量", "政策／地缘事件", "相关市场与行业表现"] as const;
