const SOURCE = "Wayfair Partner Home promotional calendar screenshot";
const SOURCE_AS_OF = "2026-07-28";

const openEvent = (event) =>
  Object.freeze({
    status: "OPEN_FOR_SUBMISSION",
    source: SOURCE,
    sourceAsOf: SOURCE_AS_OF,
    ...event,
  });

export const AUGUST_PROMOTION_EVENTS = Object.freeze([
  openEvent({
    id: "q3-priority-product-discounts-2026",
    name: "NA Q3 Priority Product Discounts (July - Nov 2026)",
    submissionOpened: "2026-07-23 02:00 EST",
    curationDeadline: "2026-07-27 02:00 EST",
    start: "2026-07-28 03:00 EDT",
    end: "2026-11-19 03:00 EST",
    lengthDays: 115,
    category: "Extended Event",
    recommendedProducts: null,
    planningStatus: "MISSED_DEADLINE_RECHECK",
    canRelyOnForPlan: false,
    planningNote: "截图仍显示开放，但截止日已过；仅后台复核补报窗口，不计入8月目标承诺。",
  }),
  openEvent({
    id: "member-pop-up-august-2026",
    name: "Member Pop Up Sale - August 2026",
    submissionOpened: "2026-07-10 11:00 EST",
    curationDeadline: "2026-07-29 23:59 EST",
    start: "2026-08-05 00:00 EDT",
    end: "2026-08-07 23:59 EDT",
    lengthDays: 3,
    category: "Loyalty Exclusive",
    recommendedProducts: 26,
    planningStatus: "UPCOMING_SUBMISSION",
    canRelyOnForPlan: true,
    planningNote: "文件柜优先窗口；仅提报后台仍推荐且逐Part利润通过的商品。",
  }),
  openEvent({
    id: "clearout-august-2026",
    name: "NA 72 Hour Clearout - August 2026",
    submissionOpened: "2026-07-10 17:00 EST",
    curationDeadline: "2026-07-25 23:00 EST",
    start: "2026-08-08 00:00 EDT",
    end: "2026-08-11 02:59 EDT",
    lengthDays: 4,
    category: "Clearance",
    recommendedProducts: 52,
    planningStatus: "MISSED_DEADLINE_RECHECK",
    canRelyOnForPlan: false,
    planningNote: "截止日已过；只做后台补报窗口复核，不把Clearout销量写入基础目标。",
  }),
  openEvent({
    id: "summer-markdowns-august-2026",
    name: "NA Summer Markdowns - August 2026",
    submissionOpened: "2026-07-12 23:00 EST",
    curationDeadline: "2026-07-31 23:00 EST",
    start: "2026-08-11 03:00 EDT",
    end: "2026-08-17 02:59 EDT",
    lengthDays: 6,
    category: "Major Shopping Holiday",
    recommendedProducts: 52,
    planningStatus: "UPCOMING_SUBMISSION",
    canRelyOnForPlan: true,
    planningNote: "主活动窗口；按Part折扣与角色利润底线提报。",
  }),
  openEvent({
    id: "four-day-flash-august-2026",
    name: "NA Four Day Flash Sale - August 2026",
    submissionOpened: "2026-07-14 05:00 EST",
    curationDeadline: "2026-07-31 23:00 EST",
    start: "2026-08-17 03:00 EDT",
    end: "2026-08-21 03:00 EDT",
    lengthDays: 4,
    category: "Major Shopping Holiday",
    recommendedProducts: 52,
    planningStatus: "UPCOMING_SUBMISSION",
    canRelyOnForPlan: true,
    planningNote: "冲量窗口；薄毛利款不叠加数量Offer，利润款承担利润池。",
  }),
  openEvent({
    id: "labor-day-august-2026",
    name: "NA Labor Day/Labour Day - August 2026",
    submissionOpened: "2026-07-17 08:00 EST",
    curationDeadline: "2026-08-07 23:00 EST",
    start: "2026-08-24 00:00 EDT",
    end: "2026-09-08 02:59 EDT",
    lengthDays: 16,
    category: "Major Shopping Holiday",
    recommendedProducts: null,
    planningStatus: "UPCOMING_SUBMISSION",
    canRelyOnForPlan: true,
    planningNote: "月末收口窗口；只给达到利润、库存和转化Gate的Part继续放量。",
  }),
]);

const EVENT_GROUPS = Object.freeze({
  FILING_CORE: Object.freeze([
    "member-pop-up-august-2026",
    "summer-markdowns-august-2026",
    "four-day-flash-august-2026",
    "labor-day-august-2026",
  ]),
  GENERAL: Object.freeze([
    "summer-markdowns-august-2026",
    "four-day-flash-august-2026",
    "labor-day-august-2026",
  ]),
  NONE: Object.freeze([]),
});

const ROLE_MARGIN_FLOORS = Object.freeze({
  VOLUME_CORE: 0.12,
  CONTROLLED_GROWTH: 0.12,
  PROFIT_POOL: 0.2,
  REPAIR_ORGANIC: 0.2,
});

const REVIEW_GATES = Object.freeze([
  "EXPLICIT_USER_APPROVAL",
  "LIVE_INVENTORY_VERIFIED",
  "PRICE_BASIS_VERIFIED",
  "CERTIFIED_COST_PRESENT",
  "CATALOG_SINGLE_LIVE_MAPPING",
  "STORE_POST_AD_MARGIN_AT_LEAST_10_PERCENT",
]);

const roundMoney = (value) => Number(value.toFixed(2));
const roundRate = (value) => Number(value.toFixed(4));

function discountLabel({ b2cDiscount, b2bTotalDiscount, quantityOffer }) {
  if (!b2cDiscount && !b2bTotalDiscount) return "暂缓，不提报";
  const parts = [
    `B2C ${Math.round(b2cDiscount * 100)}%`,
    `B2B总折扣 ${Math.round(b2bTotalDiscount * 100)}%`,
  ];
  if (quantityOffer) parts.push(`Buy 2再减 ${Math.round(quantityOffer * 100)}%`);
  else parts.push("不叠加数量Offer");
  return parts.join(" · ");
}

function part(input) {
  const action = input.action || "PROPOSE";
  const roleMarginFloor = ROLE_MARGIN_FLOORS[input.role];
  const worstDiscount =
    input.worstDiscount ??
    (input.quantityOffer
      ? 1 - (1 - input.b2bTotalDiscount) * (1 - input.quantityOffer)
      : input.b2bTotalDiscount || 0);
  const netPrice =
    action === "PROPOSE" && Number.isFinite(input.priceBasisCents)
      ? input.priceBasisCents * (1 - worstDiscount)
      : null;
  const estimatedWorstMargin =
    netPrice && Number.isFinite(input.costCents)
      ? roundRate((netPrice - input.costCents) / netPrice)
      : null;

  return Object.freeze({
    reviewStatus: "PENDING_REVIEW",
    canSubmitToZiniao: false,
    b2cDiscount: 0,
    b2bTotalDiscount: 0,
    quantityOffer: 0,
    catalogLiveCount: 1,
    eventGroup: action === "PROPOSE" ? "GENERAL" : "NONE",
    ...input,
    action,
    roleMarginFloor,
    worstDiscount: roundRate(worstDiscount),
    estimatedWorstMargin,
    eventIds: EVENT_GROUPS[action === "PROPOSE" ? input.eventGroup || "GENERAL" : "NONE"],
    discountPlan: discountLabel(input),
    requiredGates: REVIEW_GATES,
    sourceAsOf: SOURCE_AS_OF,
  });
}

export const AUGUST_PROMOTION_PLAN = Object.freeze([
  part({
    listing: "DMOM1021",
    part: "LFC-2B-680",
    role: "VOLUME_CORE",
    priceBasisCents: 9600,
    costCents: 6420,
    inventoryOnHand: 1421,
    juneUnits: 18,
    julyUnits: 9,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "FILING_CORE",
    reason: "主力跑量款；用活动承接并守住12%逐Part底线。",
  }),
  part({
    listing: "DMOM1021",
    part: "LFC-2W-680",
    role: "VOLUME_CORE",
    priceBasisCents: 10800,
    costCents: 6420,
    inventoryOnHand: 203,
    juneUnits: 13,
    julyUnits: 8,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "FILING_CORE",
    reason: "主力跑量款；活动后仍有利润缓冲。",
  }),
  part({
    listing: "DMOM1022",
    part: "MFC-D3-B",
    role: "CONTROLLED_GROWTH",
    priceBasisCents: 8925,
    costCents: 6800,
    inventoryOnHand: 12,
    juneUnits: 2,
    julyUnits: 2,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "FILING_CORE",
    reason: "薄毛利受控跑量；只承接零增量广告的活动流量，库存与店铺利润池双Gate。",
  }),
  part({
    listing: "DMOM1022",
    part: "MFC-D3-W",
    role: "CONTROLLED_GROWTH",
    priceBasisCents: 9450,
    costCents: 6800,
    inventoryOnHand: 80,
    juneUnits: 4,
    julyUnits: 12,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "FILING_CORE",
    reason: "自然转化强；不叠加数量Offer。",
  }),
  part({
    listing: "DMOM1003",
    part: "4T-Kayak",
    role: "PROFIT_POOL",
    priceBasisCents: 12600,
    costCents: 7500,
    inventoryOnHand: 32,
    juneUnits: 11,
    julyUnits: 6,
    b2cDiscount: 0.1,
    b2bTotalDiscount: 0.15,
    quantityOffer: 0.05,
    eventGroup: "GENERAL",
    reason: "季节利润款；可用数量Offer补贴跑量款，库存降至12件即停止放量。",
  }),
  part({
    listing: "DMOM1017",
    part: "3T-B",
    role: "VOLUME_CORE",
    priceBasisCents: 6300,
    costCents: 4300,
    inventoryOnHand: 492,
    catalogLiveCount: 2,
    juneUnits: 3,
    julyUnits: 2,
    action: "HOLD",
    reason: "同一Part映射DMOM1014与DMOM1017；先解除重复映射，避免提错链接。",
  }),
  part({
    listing: "DMOM1017",
    part: "3T-W",
    role: "VOLUME_CORE",
    priceBasisCents: 6300,
    costCents: 4300,
    inventoryOnHand: 246,
    juneUnits: 4,
    julyUnits: 6,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    reason: "低客单跑量款；活动后利润足够，保留评分不下降Gate。",
  }),
  part({
    listing: "DMOM1019",
    part: "VFC-3B",
    role: "PROFIT_POOL",
    priceBasisCents: 10800,
    costCents: 7090,
    inventoryOnHand: 997,
    juneUnits: 4,
    julyUnits: 4,
    b2cDiscount: 0.1,
    b2bTotalDiscount: 0.15,
    reason: "自然利润款；不额外叠加数量Offer。",
  }),
  part({
    listing: "DMOM1019",
    part: "VFC-3W",
    role: "PROFIT_POOL",
    priceBasisCents: 10800,
    costCents: 7090,
    inventoryOnHand: 336,
    juneUnits: 5,
    julyUnits: 1,
    b2cDiscount: 0.1,
    b2bTotalDiscount: 0.15,
    reason: "自然利润款；不额外叠加数量Offer。",
  }),
  part({
    listing: "DMOM1000",
    part: "5T-1600-800",
    role: "PROFIT_POOL",
    priceBasisCents: null,
    costCents: null,
    inventoryOnHand: 221,
    juneUnits: 0,
    julyUnits: 0,
    action: "HOLD",
    reason: "缺实时价格与认证成本，无法对活动价负责。",
  }),
  part({
    listing: "DMOM1000",
    part: "5T-1830-1200",
    role: "PROFIT_POOL",
    priceBasisCents: null,
    costCents: 6800,
    inventoryOnHand: 795,
    juneUnits: 0,
    julyUnits: 0,
    action: "HOLD",
    reason: "缺真实成交或实时价格基准，无法核算折后利润。",
  }),
  part({
    listing: "DMOM1000",
    part: "5T-1830-900",
    role: "PROFIT_POOL",
    priceBasisCents: 8010,
    costCents: 4500,
    inventoryOnHand: 14,
    juneUnits: 0,
    julyUnits: 1,
    action: "HOLD",
    reason: "库存仅14件；先保销售责任库存，不用促销加速断货。",
  }),
  part({
    listing: "DMOM1000",
    part: "5T-1980-1200",
    role: "PROFIT_POOL",
    priceBasisCents: 10200,
    costCents: 6000,
    inventoryOnHand: 580,
    juneUnits: 2,
    julyUnits: 0,
    b2cDiscount: 0.1,
    b2bTotalDiscount: 0.15,
    quantityOffer: 0.05,
    reason: "高毛利货架款；承担组合利润池。",
  }),
  part({
    listing: "DMOM1000",
    part: "6T-2095-122",
    role: "PROFIT_POOL",
    priceBasisCents: 13500,
    costCents: 7000,
    inventoryOnHand: 147,
    juneUnits: 0,
    julyUnits: 1,
    b2cDiscount: 0.1,
    b2bTotalDiscount: 0.15,
    quantityOffer: 0.05,
    reason: "高毛利货架款；承担组合利润池。",
  }),
  part({
    listing: "DMOM1018",
    part: "LFC-2B",
    role: "REPAIR_ORGANIC",
    priceBasisCents: 11475,
    costCents: 7540,
    inventoryOnHand: 164,
    juneUnits: 3,
    julyUnits: 1,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "FILING_CORE",
    reason: "只承接活动自然流量；链接质量Gate前不增加广告。",
  }),
  part({
    listing: "DMOM1018",
    part: "LFC-2W",
    role: "REPAIR_ORGANIC",
    priceBasisCents: null,
    costCents: 7540,
    inventoryOnHand: 273,
    juneUnits: 0,
    julyUnits: 0,
    action: "HOLD",
    reason: "缺真实成交或实时价格基准，无法核算折后利润。",
  }),
  part({
    listing: "DMOM1025",
    part: "LFC-3B",
    role: "REPAIR_ORGANIC",
    priceBasisCents: 13950,
    costCents: 9048,
    inventoryOnHand: 428,
    juneUnits: 2,
    julyUnits: 1,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "FILING_CORE",
    reason: "只承接活动自然流量；链接修复通过前不增加广告。",
  }),
  part({
    listing: "DMOM1025",
    part: "LFC-3W",
    role: "REPAIR_ORGANIC",
    priceBasisCents: 13950,
    costCents: 9094,
    inventoryOnHand: 265,
    juneUnits: 1,
    julyUnits: 1,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "FILING_CORE",
    reason: "只承接活动自然流量；链接修复通过前不增加广告。",
  }),
  part({
    listing: "DMOM1026",
    part: "VFC-2B",
    role: "REPAIR_ORGANIC",
    priceBasisCents: 7200,
    costCents: 5290,
    inventoryOnHand: 256,
    juneUnits: 2,
    julyUnits: 1,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.08,
    reason: "13%会压缩利润缓冲；仅在活动接受8% B2B时提报。",
  }),
  part({
    listing: "DMOM1026",
    part: "VFC-2W",
    role: "REPAIR_ORGANIC",
    priceBasisCents: 7200,
    costCents: 5290,
    inventoryOnHand: 201,
    juneUnits: 1,
    julyUnits: 1,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.08,
    reason: "13%会压缩利润缓冲；仅在活动接受8% B2B时提报。",
  }),
  part({
    listing: "DMOM1016",
    part: "5T-wangge",
    role: "REPAIR_ORGANIC",
    priceBasisCents: null,
    costCents: null,
    inventoryOnHand: 696,
    juneUnits: 0,
    julyUnits: 0,
    action: "HOLD",
    reason: "缺实时价格与认证成本，无法对活动价负责。",
  }),
]);

const BASELINE_REVENUE = 17648.94;
const BASELINE_GROSS_PROFIT = 6167.66;
const FULL_PROMOTION_DISCOUNT_LOSS = 2419.56;
const RECOMMENDED_AD_BUDGET = 2700;

function portfolioScenario(promotionOrderShare) {
  const discountLoss = FULL_PROMOTION_DISCOUNT_LOSS * promotionOrderShare;
  const projectedRevenue = BASELINE_REVENUE - discountLoss;
  const projectedGrossProfit = BASELINE_GROSS_PROFIT - discountLoss;
  const projectedPostAdProfit = projectedGrossProfit - RECOMMENDED_AD_BUDGET;
  return Object.freeze({
    promotionOrderShare,
    projectedRevenue: roundMoney(projectedRevenue),
    projectedGrossProfit: roundMoney(projectedGrossProfit),
    projectedPostAdProfit: roundMoney(projectedPostAdProfit),
    projectedPostAdMargin: roundRate(projectedPostAdProfit / projectedRevenue),
    hardAdCapAt10Percent: roundMoney(projectedGrossProfit - projectedRevenue * 0.1),
    targetAdCapAt12Percent: roundMoney(projectedGrossProfit - projectedRevenue * 0.12),
  });
}

export const AUGUST_PROMOTION_PORTFOLIO = Object.freeze({
  baselineRevenue: BASELINE_REVENUE,
  baselineGrossProfit: BASELINE_GROSS_PROFIT,
  originalAdBudget: 4050,
  recommendedAdBudget: RECOMMENDED_AD_BUDGET,
  baseAdBudget: 2200,
  performanceReserve: 500,
  fallbackAdBudget: 2200,
  fullPromotionDiscountLoss: FULL_PROMOTION_DISCOUNT_LOSS,
  primaryPromotionOrderShare: 0.6,
  stressPromotionOrderShare: 0.7,
  methodology:
    "以批准销售计划为基线，按合格订单命中逐Part最差折扣的比例做60%主情景、70%压力情景和100%极端情景；成本不随折扣下降。",
  budgetRule:
    "活动订单占比超过70%、后台接受价低于模型或店铺广告后利润率低于12%，停止释放$500赢家机动池并把广告上限收紧至$2,200；低于10%停止扩量。",
  scenarios: Object.freeze([portfolioScenario(0.6), portfolioScenario(0.7), portfolioScenario(1)]),
});

export function promotionReviewSummary(plan = AUGUST_PROMOTION_PLAN) {
  const proposed = plan.filter((item) => item.action === "PROPOSE");
  const held = plan.filter((item) => item.action === "HOLD");
  const ziniaoReady = plan.filter((item) => item.canSubmitToZiniao);
  const primary = AUGUST_PROMOTION_PORTFOLIO.scenarios.find(
    (item) => item.promotionOrderShare === AUGUST_PROMOTION_PORTFOLIO.primaryPromotionOrderShare,
  );
  const stress = AUGUST_PROMOTION_PORTFOLIO.scenarios.find(
    (item) => item.promotionOrderShare === AUGUST_PROMOTION_PORTFOLIO.stressPromotionOrderShare,
  );
  const full = AUGUST_PROMOTION_PORTFOLIO.scenarios.find(
    (item) => item.promotionOrderShare === 1,
  );

  return {
    totalListings: new Set(plan.map((item) => item.listing)).size,
    totalParts: plan.length,
    proposedListings: new Set(proposed.map((item) => item.listing)).size,
    proposedParts: proposed.length,
    heldParts: held.length,
    pendingReviewParts: plan.filter((item) => item.reviewStatus === "PENDING_REVIEW").length,
    ziniaoReadyParts: ziniaoReady.length,
    submissionLocked: ziniaoReady.length === 0,
    originalAdBudget: AUGUST_PROMOTION_PORTFOLIO.originalAdBudget,
    recommendedAdBudget: AUGUST_PROMOTION_PORTFOLIO.recommendedAdBudget,
    adBudgetReduction:
      AUGUST_PROMOTION_PORTFOLIO.originalAdBudget -
      AUGUST_PROMOTION_PORTFOLIO.recommendedAdBudget,
    projectedPromotionOrderShare: primary.promotionOrderShare,
    projectedRevenue: primary.projectedRevenue,
    projectedPostAdProfit: primary.projectedPostAdProfit,
    projectedPostAdMargin: primary.projectedPostAdMargin,
    stressPromotionOrderShare: stress.promotionOrderShare,
    stressPostAdMargin: stress.projectedPostAdMargin,
    fallbackAdBudget: AUGUST_PROMOTION_PORTFOLIO.fallbackAdBudget,
    fullPromotionHardAdCap: full.hardAdCapAt10Percent,
  };
}
