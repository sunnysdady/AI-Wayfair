export type PlanListing = {
  listing: string;
  parts: string[];
  juneUnits: number;
  augustUnits: number;
  budget: number;
  rating?: number;
  reviews?: number;
  marginRate?: number;
  role: string;
  gate: string;
  eligible: boolean;
};

export const AUGUST_PLAN = {
  id: "yb-2026-08-growth",
  month: "2026-08",
  status: "PREPARATION",
  unitTarget: 150,
  revenueTarget: 16800,
  attributedOrderTarget: 76,
  baseAdBudget: 1800,
  hardAdCap: 2500,
  wscRoasGoal: 3.2,
  scaleRoasGate: 4,
  fillRateGoal: .95,
  source: "YB店_8月150单完整增长Playbook.html",
  sourceAsOf: "2026-07-15",
  scopeWarning: "SKU责任表按150 Units拆解，但Scorecard标题使用150 Orders；第一阶段按Units跟踪，需运营确认统一口径。",
};

export const PLAN_LISTINGS: PlanListing[] = [
  { listing: "DMOM1021", parts: ["LFC-2B-680", "LFC-2W-680"], juneUnits: 28, augustUnits: 50, budget: 700, rating: 4.46, reviews: 13, marginRate: .346, role: "第一主力", gate: "Keyword收割、Product发现、B2B承接", eligible: true },
  { listing: "DMOM1022", parts: ["MFC-D3-W", "MFC-D3-B"], juneUnits: 4, augustUnits: 30, budget: 340, rating: 4.46, reviews: 13, role: "第二主力", gate: "确认带连字符Live Part与库存映射后放量", eligible: true },
  { listing: "DMOM1019", parts: ["VFC-3B", "VFC-3W"], juneUnits: 10, augustUnits: 21, budget: 290, rating: 4.8, role: "Keyword赢家", gate: "Keyword优先，Product仅保留发现流量", eligible: true },
  { listing: "DMOM1003", parts: ["4T-Kayak"], juneUnits: 8, augustUnits: 18, budget: 140, rating: 5, marginRate: .345, role: "季节增长", gate: "库存归属确认后执行", eligible: true },
  { listing: "DMOM1018", parts: ["LFC-2B", "LFC-2W"], juneUnits: 3, augustUnits: 9, budget: 30, role: "自然单为主", gate: "CVR偏低，链接修复后小测", eligible: true },
  { listing: "DMOM1017", parts: ["3T-W", "3T-B"], juneUnits: 4, augustUnits: 6, budget: 10, rating: 4, reviews: 1, role: "严格限额", gate: "评分4.0且仅1评，不扩量", eligible: true },
  { listing: "DMOM1000", parts: ["5T-1980-1200", "6T-2095-122"], juneUnits: 2, augustUnits: 6, budget: 10, marginRate: .384, role: "恢复池", gate: "Catalog更新状态清零前不启用Offer、不扩广告", eligible: true },
  { listing: "DMOM1025", parts: ["LFC-3B", "LFC-3W"], juneUnits: 2, augustUnits: 4, budget: 0, rating: 4, role: "自然观察", gate: "近28天商品/关键词均0单，先修链接", eligible: false },
  { listing: "DMOM1026", parts: ["VFC-2B", "VFC-2W"], juneUnits: 2, augustUnits: 4, budget: 0, rating: 4.67, reviews: 3, role: "自然观察", gate: "评论少、转化弱，不投广告", eligible: false },
  { listing: "DMOM1016", parts: ["5T-wangge"], juneUnits: 0, augustUnits: 2, budget: 0, rating: 4.33, role: "自然恢复", gate: "自然/恢复池，不投广告", eligible: false },
  { listing: "DRCI1007", parts: [], juneUnits: 0, augustUnits: 0, budget: 0, role: "永久剔除", gate: "目标0、预算0，禁止任何加价或扩预算", eligible: false },
];

export const WEEKLY_MILESTONES = [
  { label: "准备周", range: "07/14–07/20", cumulative: 0, note: "确认目标、库存覆盖、保本CPO和参数快照" },
  { label: "上线前", range: "07/21–07/31", cumulative: 0, note: "建立台账、预算池；一次只改一个变量" },
  { label: "W1", range: "08/01–08/07", cumulative: 30, note: "基础预算节奏；D7只看安全与止损" },
  { label: "W2", range: "08/08–08/14", cumulative: 65, note: "达标才解锁Gate 1；赢家Cap +20%" },
  { label: "W3", range: "08/15–08/21", cumulative: 105, note: "达标才解锁Gate 2；核心库存≥14天" },
  { label: "W4", range: "08/22–08/31", cumulative: 150, note: "只给达标赢家冲刺；月花费≤$2,500" },
];

export function planForListing(listing: string) {
  return PLAN_LISTINGS.find((item) => item.listing === listing);
}
