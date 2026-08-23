import type { CriticalMineralCountryStat, CriticalMineralRecord, GlobalMacroSource } from "../../src/types.js";

export const USGS_MCS_2026_URL = "https://doi.org/10.3133/mcs2026";
export const USGS_MCS_2026_TITLE = "USGS Mineral Commodity Summaries 2026（ver. 1.3，May 2026）";
export const USGS_DATA_YEAR = "2025";
const ANNUAL_NOTE = "USGS Mineral Commodity Summaries 2026；年度数据，非实时。2025e 表示 USGS 估计值；W、NA、> 或无法无歧义核验的字段不补值。";

function source(): GlobalMacroSource {
  return {
    provider: "USGS",
    title: USGS_MCS_2026_TITLE,
    url: USGS_MCS_2026_URL,
    dataTime: USGS_DATA_YEAR
  };
}

function countries(entries: Array<[string, string | null, string | null]>): CriticalMineralCountryStat[] {
  return entries.map(([country, production, reserves]) => ({ country, production, reserves }));
}

function record(input: Omit<CriticalMineralRecord, "source" | "note"> & { note?: string }): CriticalMineralRecord {
  return { ...input, source: source(), note: input.note ?? ANNUAL_NOTE };
}

/**
 * 只包含可由 USGS MCS 2026 原文无歧义支持的字符串数值。
 * 不转换单位、不把 resources 当 reserves、不把精炼产量当矿山产量。
 */
export const USGS_CRITICAL_MINERALS_2026: CriticalMineralRecord[] = [
  record({
    id: "lithium",
    name: "锂",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "公吨（锂含量）",
    reserveUnit: "公吨（锂含量）",
    globalProduction: "290,000",
    globalReserves: "37,000,000",
    countries: countries([
      ["澳大利亚", "92,000", null],
      ["中国", "62,000", "4,600,000"],
      ["智利", "56,000", "9,200,000"],
      ["津巴布韦", "28,000", "500,000"],
      ["阿根廷", "23,000", "4,400,000"],
      ["巴西", "12,000", "540,000"],
      ["马里", "9,400", "370,000"],
      ["加拿大", "5,600", "1,600,000"]
    ]),
    available: true
  }),
  record({
    id: "copper",
    name: "铜",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "千公吨（铜含量；矿山产量）",
    reserveUnit: "千公吨（铜含量）",
    globalProduction: "23,000",
    globalReserves: "980,000",
    countries: countries([
      ["智利", "5,300", "180,000"],
      ["刚果（金）", "3,200", "80,000"],
      ["中国", "1,800", "41,000"],
      ["美国", "1,000", "47,000"],
      ["印尼", "710", "21,000"],
      ["哈萨克斯坦", "710", "20,000"],
      ["墨西哥", "690", "53,000"],
      ["加拿大", "500", "7,000"]
    ]),
    available: true
  }),
  record({
    id: "rare-earths",
    name: "稀土",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "公吨（稀土氧化物 REO 当量；含镧系元素与钇，通常不含大部分钪）",
    reserveUnit: "公吨（稀土氧化物 REO 当量）",
    globalProduction: "390,000",
    globalReserves: ">75,000,000",
    countries: countries([
      ["中国", "270,000", "44,000,000"],
      ["美国", "51,000", "1,900,000"],
      ["巴西", "2,000", "11,000,000"],
      ["俄罗斯", "2,600", "3,800,000"],
      ["尼日利亚", "1,500", null]
    ]),
    available: true
  }),
  record({
    id: "nickel",
    name: "镍",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "公吨（镍含量）",
    reserveUnit: "公吨（镍含量）",
    globalProduction: "3,900,000",
    globalReserves: ">140,000,000",
    countries: countries([
      ["印尼", "2,600,000", "62,000,000"],
      ["菲律宾", "270,000", "4,800,000"],
      ["俄罗斯", "200,000", "8,300,000"],
      ["新喀里多尼亚", "140,000", "7,100,000"],
      ["加拿大", "140,000", "2,200,000"],
      ["中国", "120,000", "4,400,000"],
      ["巴西", "70,000", "16,000,000"],
      ["美国", "10,000", "340,000"]
    ]),
    available: true
  }),
  record({
    id: "cobalt",
    name: "钴",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "公吨（钴含量）",
    reserveUnit: "公吨（钴含量）",
    globalProduction: "310,000",
    globalReserves: "12,000,000",
    countries: countries([
      ["刚果（金）", "230,000", "6,000,000"],
      ["印尼", "44,000", "760,000"],
      ["马达加斯加", "3,900", "100,000"],
      ["菲律宾", "3,700", "260,000"],
      ["加拿大", "3,500", "220,000"],
      ["中国", "2,000", "160,000"],
      ["古巴", "2,000", "500,000"],
      ["美国", "300", "70,000"]
    ]),
    available: true
  }),
  record({
    id: "natural-graphite",
    name: "天然石墨",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "公吨",
    reserveUnit: "公吨",
    globalProduction: "1,800,000",
    globalReserves: "310,000,000",
    countries: countries([
      ["中国", "1,400,000", "100,000,000"],
      ["马达加斯加", "80,000", "27,000,000"],
      ["坦桑尼亚", "75,000", "18,000,000"],
      ["巴西", "65,000", "74,000,000"],
      ["莫桑比克", "60,000", "25,000,000"],
      ["印度", "17,000", "8,600,000"],
      ["朝鲜", "8,000", "2,000,000"],
      ["加拿大", "8,000", "5,900,000"]
    ]),
    available: true
  }),
  record({
    id: "manganese",
    name: "锰",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "千公吨（锰含量）",
    reserveUnit: "千公吨（锰含量）",
    globalProduction: "20,000",
    globalReserves: "1,800,000",
    countries: countries([
      ["南非", "7,600", "550,000"],
      ["加蓬", "5,000", "61,000"],
      ["加纳", "2,000", "13,000"],
      ["澳大利亚", "1,600", null],
      ["巴西", "800", "300,000"],
      ["印度", "790", "34,000"],
      ["中国", "700", "260,000"],
      ["科特迪瓦", "350", null]
    ]),
    available: true
  }),
  record({
    id: "bauxite",
    name: "铝土矿",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "千公吨（干重）",
    reserveUnit: "千公吨（干重）",
    globalProduction: "440,000",
    globalReserves: "29,000,000",
    countries: countries([
      ["几内亚", "150,000", "7,400,000"],
      ["中国", "87,000", "710,000"],
      ["巴西", "33,000", "1,700,000"],
      ["印度", "25,000", "650,000"],
      ["印尼", "10,000", "2,900,000"],
      ["牙买加", "6,200", "2,000,000"],
      ["越南", "3,800", "3,100,000"]
    ]),
    available: true
  }),
  record({
    id: "iron-ore",
    name: "铁矿",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "千公吨（可用矿石）",
    reserveUnit: "百万公吨（原矿）",
    globalProduction: "2,600,000",
    globalReserves: "200,000",
    countries: countries([
      ["巴西", "420,000", "34,000"],
      ["印度", "310,000", "5,500"],
      ["中国", "290,000", "17,000"],
      ["伊朗", "93,000", "4,200"],
      ["加拿大", "69,000", "6,000"],
      ["美国", "38,000", "3,600"],
      ["哈萨克斯坦", "35,000", "3,800"],
      ["毛里塔尼亚", "15,000", "10,000"]
    ]),
    available: true
  }),
  record({
    id: "zinc",
    name: "锌",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "千公吨（锌含量）",
    reserveUnit: "千公吨（锌含量）",
    globalProduction: "13,000",
    globalReserves: "240,000",
    countries: countries([
      ["中国", "4,100", "60,000"],
      ["秘鲁", "1,500", "18,000"],
      ["印度", "870", "10,000"],
      ["墨西哥", "780", "14,000"],
      ["美国", "670", "9,300"],
      ["俄罗斯", "430", "29,000"],
      ["哈萨克斯坦", "360", "7,400"],
      ["瑞典", "230", "4,100"]
    ]),
    available: true
  }),
  record({
    id: "tin",
    name: "锡",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "公吨（锡含量）",
    reserveUnit: "公吨（锡含量）",
    globalProduction: "290,000",
    globalReserves: ">6,000,000",
    countries: countries([
      ["中国", "71,000", "1,200,000"],
      ["印尼", "61,000", "1,400,000"],
      ["秘鲁", "33,000", "150,000"],
      ["巴西", "28,000", "700,000"],
      ["刚果（金）", "27,000", "91,000"],
      ["玻利维亚", "15,000", "400,000"],
      ["缅甸", "12,000", "700,000"],
      ["俄罗斯", "4,500", "460,000"]
    ]),
    available: true
  }),
  record({
    id: "uranium",
    name: "铀",
    productionYear: null,
    reserveYear: null,
    productionUnit: null,
    reserveUnit: null,
    globalProduction: null,
    globalReserves: null,
    countries: [],
    available: false,
    note: "USGS MCS 2026 未提供铀的对应商品章节与可验证世界产量／储量表；暂无可靠资料。年度数据，非实时。"
  }),
  record({
    id: "gold",
    name: "黄金",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "公吨（金含量）",
    reserveUnit: "公吨（金含量）",
    globalProduction: "3,300",
    globalReserves: "66,000",
    countries: countries([
      ["中国", "380", "3,200"],
      ["加拿大", "200", "3,200"],
      ["美国", "160", "3,000"],
      ["加纳", "150", "1,000"],
      ["墨西哥", "140", "1,400"],
      ["哈萨克斯坦", "130", "2,300"],
      ["印尼", "90", "3,600"],
      ["巴西", "80", "2,500"]
    ]),
    available: true
  }),
  record({
    id: "silver",
    name: "白银",
    productionYear: "2025e",
    reserveYear: "2025",
    productionUnit: "公吨（银含量）",
    reserveUnit: "公吨（银含量）",
    globalProduction: "26,000",
    globalReserves: "610,000",
    countries: countries([
      ["墨西哥", "6,300", "37,000"],
      ["秘鲁", "3,600", "110,000"],
      ["中国", "3,400", "67,000"],
      ["智利", "1,400", "33,000"],
      ["波兰", "1,300", "59,000"],
      ["俄罗斯", "1,200", "92,000"],
      ["美国", "1,100", "23,000"],
      ["阿根廷", "800", "6,500"]
    ]),
    available: true
  }),
  record({
    id: "platinum-group-metals",
    name: "铂族金属",
    productionYear: null,
    reserveYear: "2025",
    productionUnit: null,
    reserveUnit: "千克（铂族金属含量）",
    globalProduction: null,
    globalReserves: ">76,000,000",
    countries: countries([
      ["南非", null, "63,000,000"],
      ["津巴布韦", null, "1,300,000"],
      ["美国", null, "590,000"],
      ["加拿大", null, "310,000"]
    ]),
    available: true,
    note: "USGS MCS 2026 将矿山产量拆分为钯与铂两列，未将其合并为单一 PGM 产量；因此本记录只显示可验证的 PGM 储量。年度数据，非实时。"
  })
];
