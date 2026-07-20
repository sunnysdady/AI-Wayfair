import { MAKEACE_CPC_PLAN } from "./makeace-cpc-plan.mjs";
export { MAKEACE_CPC_PLAN } from "./makeace-cpc-plan.mjs";

export type AdRole = "scale" | "protect" | "hold" | "reduce" | "observe" | "exclude";

export type PlanListing = {
  listing: string;
  parts: string[];
  budget: number;
  rating?: number;
  reviews?: number;
  marginRate?: number;
  role: string;
  gate: string;
  eligible: boolean;
  adRole: AdRole;
  juneUnits?: number;
  augustUnits?: number;
  juneBaselineOrders?: number;
  julyTargetOrders?: number;
  averagePrice?: number;
  estimatedNetProfit?: number;
  tactic?: string;
  promotionMode?: "PROMOTION_CANDIDATE" | "REGULAR_ADS_ONLY" | "ORGANIC_WITH_LISTING" | "LOW_BID";
  sourceWarning?: string;
};

export const JULY_PLAN = {
  id: "yb-2026-07-true-baseline",
  month: "2026-07",
  status: "ACTIVE",
  targetMetric: "ORDERS",
  orderTarget: 128,
  baselineOrders: 102,
  floorOrders: 112,
  stretchOrders: 145,
  adBudget: 790,
  estimatedNetProfit: 3394,
  source: "Wayfair_7月推广计划_v3真实基线_20260623.html",
  sourceAsOf: "2026-06-23",
  scopeWarning: "主计划称6月满月真实基线102单，但SKU表10行合计100单；系统保留两种来源口径，不擅自补齐2单。DMOM1022正文称6月实际10单，表格基线为5单，待运营确认。",
};

export const JULY_PLAN_LISTINGS: PlanListing[] = [
  { listing: "DMOM1020", parts: ["MFC-D2-B", "MFC-D2-W"], juneBaselineOrders: 19, julyTargetOrders: 25, averagePrice: 96, budget: 80, estimatedNetProfit: 640, role: "增长主力", tactic: "广告×2（历史ROI 5.7）+ BFIJ", gate: "促销毛利、库存覆盖与链接质量通过后放量", eligible: true, adRole: "scale", promotionMode: "PROMOTION_CANDIDATE" },
  { listing: "DMOM1021", parts: ["LFC-2B-680", "LFC-2W-680"], juneBaselineOrders: 27, julyTargetOrders: 33, averagePrice: 106, budget: 300, estimatedNetProfit: 749, rating: 4.46, reviews: 13, marginRate: .346, role: "第一主力", tactic: "保护主力 + BFIJ促销", gate: "活动价与B2B折扣核算通过；优先保护不断流", eligible: true, adRole: "protect", promotionMode: "PROMOTION_CANDIDATE" },
  { listing: "DMOM1003", parts: ["4T-Kayak"], juneBaselineOrders: 15, julyTargetOrders: 20, averagePrice: 124, budget: 108, estimatedNetProfit: 636, rating: 5, marginRate: .345, role: "季节增长", tactic: "广告×2（历史ROI 3.9）+ 夏季", gate: "库存覆盖与活动价格通过后放量", eligible: true, adRole: "scale", promotionMode: "PROMOTION_CANDIDATE" },
  { listing: "DMOM1019", parts: ["VFC-3B", "VFC-3W"], juneBaselineOrders: 11, julyTargetOrders: 14, averagePrice: 107, budget: 0, estimatedNetProfit: 449, rating: 4.8, role: "自然单主力", tactic: "自然 + BFIJ；广告保留Listing", gate: "保留广告承接，不因月预算为0自动暂停", eligible: true, adRole: "hold", promotionMode: "ORGANIC_WITH_LISTING" },
  { listing: "DMOM1029", parts: ["VF-ZH-4B", "VF-ZH-4W"], juneBaselineOrders: 8, julyTargetOrders: 10, averagePrice: 163, budget: 62, estimatedNetProfit: 427, role: "利润增长", tactic: "广告×2（历史ROI 4.7）", gate: "活动价、利润与库存Gate通过后放量", eligible: true, adRole: "scale", promotionMode: "PROMOTION_CANDIDATE" },
  { listing: "DMOM1017", parts: ["3T-B", "3T-W"], juneBaselineOrders: 8, julyTargetOrders: 10, averagePrice: 63, budget: 25, estimatedNetProfit: 164, rating: 4, reviews: 1, role: "限额观察", tactic: "降Bid + BFIJ", gate: "评分评论弱，不进入活动扩量池", eligible: true, adRole: "reduce", promotionMode: "LOW_BID" },
  { listing: "DMOM1022", parts: ["MFC-D3-B", "MFC-D3-W"], juneBaselineOrders: 5, julyTargetOrders: 6, averagePrice: 94, budget: 115, estimatedNetProfit: 54, rating: 4.46, reviews: 13, role: "常规跑量", tactic: "维持Bid + 修主图；不参加折扣", gate: "促销后毛利仅9.6%，禁止用促销换量；保留常规广告", eligible: true, adRole: "hold", promotionMode: "REGULAR_ADS_ONLY", sourceWarning: "正文称6月实际10单，SKU表基线为5单。" },
  { listing: "DMOM1018", parts: ["LFC-2B", "LFC-2W"], juneBaselineOrders: 3, julyTargetOrders: 4, averagePrice: 118, budget: 34, estimatedNetProfit: 108, role: "小额增长", tactic: "广告×1.5", gate: "仅在链接与利润通过时小额放量", eligible: true, adRole: "scale", promotionMode: "PROMOTION_CANDIDATE" },
  { listing: "DMOM1025", parts: ["LFC-3B", "LFC-3W"], juneBaselineOrders: 3, julyTargetOrders: 4, averagePrice: 140, budget: 20, estimatedNetProfit: 148, rating: 4, role: "修复池", tactic: "降Bid + 修Listing", gate: "链接修复前不扩量", eligible: true, adRole: "reduce", promotionMode: "LOW_BID" },
  { listing: "DMOM1000", parts: ["5T-1600-800", "5T-1830-1200", "5T-1830-900", "5T-1980-1200", "6T-2095-122"], juneBaselineOrders: 1, julyTargetOrders: 2, averagePrice: 108, budget: 46, estimatedNetProfit: 19, marginRate: .384, role: "保留池", tactic: "后台ROAS 2028%；维持Bid", gate: "保持参数，不因旧CSV漏数误降Bid", eligible: true, adRole: "hold", promotionMode: "REGULAR_ADS_ONLY" },
  { listing: "DRCI1007", parts: [], juneBaselineOrders: 0, julyTargetOrders: 0, budget: 0, role: "平台合并·永久剔除", tactic: "暂停所有投放", gate: "MFC-D2-B / MFC-D2-W 已被Wayfair合并，无法承接新订单；所有Campaign停用", eligible: false, adRole: "exclude" },
];

export const JULY_EVENTS = [
  { label: "Canada Day / Summer Flash", range: "07/07–07/10", note: "历史活动，纳入7月复盘而非当前动作。" },
  { label: "48 Hour", range: "07/11–07/12", note: "历史活动，使用成熟归因回看。" },
  { label: "Member Day", range: "07/21", note: "与BFIJ预热衔接，避免同一SKU重复无门槛加码。" },
  { label: "Black Friday in July", range: "07/23–07/28", note: "官方北美主活动；加拿大Co-Invest为07/23–07/27。" },
];

export const BFIJ_PLAN = {
  id: "yb-bfij-2026",
  name: "Black Friday in July 广告策略",
  officialEventRange: "2026-07-23/2026-07-28",
  canadaCoInvestRange: "2026-07-23/2026-07-27",
  flashDealRange: "2026-07-26/2026-07-27",
  flashConfirmationDeadline: "2026-07-17",
  catalogLockRange: "2026-07-21/2026-07-28",
  strategyBudget: 330,
  monthlyBudget: JULY_PLAN.adBudget,
  cpcAnchorPlanId: MAKEACE_CPC_PLAN.id,
  bidGuardrail: "活动赢家只加Cap、不提高Bid；有订单组按BM CPC锚分阶段校准。",
  budgetNote: "$330包含在7月$790月预算内；先保护8月责任库存，再释放活动预算。",
  source: "Wayfair 北美地区 Black Friday in July官宣定档！.pdf",
  sourceAsOf: "2026-07-16",
  phases: [
    { id: "confirm", label: "资格确认", range: "07/16–07/17", budgetCap: 0, bidRule: "不加价", capRule: "确认Wallet、促销价、Flash邀请与$75/SKU费用", objective: "先确认可参加对象，未获邀请不计Flash Deal收益。" },
    { id: "prepare", label: "预热与锁版", range: "07/18–07/20", budgetCap: 55, bidRule: "Bid按BM CPC锚分阶段校准；有订单组单次最多-10%", capRule: "成熟赢家最多+20%，单次只改一个变量", objective: "07/21前完成链接、利润和7月剩余量+8月预留库存核查。" },
    { id: "ramp", label: "Member Day衔接", range: "07/21–07/22", budgetCap: 45, bidRule: "不提高Bid；成熟赢家保持当前Bid", capRule: "落后计划且通过Gate才+20%", objective: "用Cap承接增量，避免抬高CPC或提前烧完预算。" },
    { id: "event", label: "BFIJ主活动", range: "07/23–07/25", budgetCap: 120, bidRule: "赢家保持Bid；低效组分阶段-10%～15%", capRule: "赢家逐级+20%；库存不足立即冻结", objective: "优先填补7月目标缺口，同时保留8月SKU责任库存。" },
    { id: "flash", label: "Flash Deal窗口", range: "07/26–07/27", budgetCap: 85, bidRule: "受邀且盈利SKU保持Bid，不追价", capRule: "按成熟订单与利润逐级加Cap，仍受月预算约束", objective: "把$75/SKU固定费计入利润；未受邀SKU不进入Flash预算池。" },
    { id: "close", label: "收尾与回撤", range: "07/28–07/31", budgetCap: 25, bidRule: "保持校准后的BM CPC锚，不反弹追价", capRule: "回到活动前Cap，停止救量", objective: "活动归因成熟后再决定8月首周参数。" },
  ],
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

export const AUGUST_PLAN_LISTINGS: PlanListing[] = [
  { listing: "DMOM1021", parts: ["LFC-2B-680", "LFC-2W-680"], juneUnits: 28, augustUnits: 50, budget: 700, rating: 4.46, reviews: 13, marginRate: .346, role: "第一主力", gate: "Keyword收割、Product发现、B2B承接", eligible: true, adRole: "scale" },
  { listing: "DMOM1022", parts: ["MFC-D3-W", "MFC-D3-B"], juneUnits: 4, augustUnits: 30, budget: 340, rating: 4.46, reviews: 13, role: "第二主力", gate: "确认带连字符Live Part与库存映射后放量", eligible: true, adRole: "scale" },
  { listing: "DMOM1019", parts: ["VFC-3B", "VFC-3W"], juneUnits: 10, augustUnits: 21, budget: 290, rating: 4.8, role: "Keyword赢家", gate: "Keyword优先，Product仅保留发现流量", eligible: true, adRole: "scale" },
  { listing: "DMOM1003", parts: ["4T-Kayak"], juneUnits: 8, augustUnits: 18, budget: 140, rating: 5, marginRate: .345, role: "季节增长", gate: "库存归属确认后执行", eligible: true, adRole: "scale" },
  { listing: "DMOM1018", parts: ["LFC-2B", "LFC-2W"], juneUnits: 3, augustUnits: 9, budget: 30, role: "自然单为主", gate: "CVR偏低，链接修复后小测", eligible: true, adRole: "observe" },
  { listing: "DMOM1017", parts: ["3T-W", "3T-B"], juneUnits: 4, augustUnits: 6, budget: 10, rating: 4, reviews: 1, role: "严格限额", gate: "评分4.0且仅1评，不扩量", eligible: true, adRole: "reduce" },
  { listing: "DMOM1000", parts: ["5T-1980-1200", "6T-2095-122"], juneUnits: 2, augustUnits: 6, budget: 10, marginRate: .384, role: "恢复池", gate: "Catalog更新状态清零前不启用Offer、不扩广告", eligible: true, adRole: "hold" },
  { listing: "DMOM1025", parts: ["LFC-3B", "LFC-3W"], juneUnits: 2, augustUnits: 4, budget: 0, rating: 4, role: "自然观察", gate: "近28天商品/关键词均0单，先修链接", eligible: false, adRole: "observe" },
  { listing: "DMOM1026", parts: ["VFC-2B", "VFC-2W"], juneUnits: 2, augustUnits: 4, budget: 0, rating: 4.67, reviews: 3, role: "自然观察", gate: "评论少、转化弱，不投广告", eligible: false, adRole: "observe" },
  { listing: "DMOM1016", parts: ["5T-wangge"], juneUnits: 0, augustUnits: 2, budget: 0, rating: 4.33, role: "自然恢复", gate: "自然/恢复池，不投广告", eligible: false, adRole: "observe" },
  { listing: "DRCI1007", parts: [], juneUnits: 0, augustUnits: 0, budget: 0, role: "平台合并·永久剔除", gate: "MFC-D2-B / MFC-D2-W 已被Wayfair合并，无法承接新订单；目标0、预算0、所有Campaign停用", eligible: false, adRole: "exclude" },
];

// Compatibility alias for the August playbook consumers.
export const PLAN_LISTINGS = AUGUST_PLAN_LISTINGS;

export const WEEKLY_MILESTONES = [
  { label: "准备周", range: "07/14–07/20", cumulative: 0, note: "确认目标、库存覆盖、保本CPO和参数快照" },
  { label: "上线前", range: "07/21–07/31", cumulative: 0, note: "建立台账、预算池；一次只改一个变量" },
  { label: "W1", range: "08/01–08/07", cumulative: 30, note: "基础预算节奏；D7只看安全与止损" },
  { label: "W2", range: "08/08–08/14", cumulative: 65, note: "达标才解锁Gate 1；赢家Cap +20%" },
  { label: "W3", range: "08/15–08/21", cumulative: 105, note: "达标才解锁Gate 2；核心库存≥14天" },
  { label: "W4", range: "08/22–08/31", cumulative: 150, note: "只给达标赢家冲刺；月花费≤$2,500" },
];

export function planForListing(listing: string, month = JULY_PLAN.month) {
  const list = month === AUGUST_PLAN.month ? AUGUST_PLAN_LISTINGS : JULY_PLAN_LISTINGS;
  return list.find((item) => item.listing === listing);
}
