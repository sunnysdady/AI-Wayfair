import { AUGUST_EXECUTION_POLICY } from "./august-execution-policy.mjs";

const SOURCE = "Wayfair Partner Home + Purple Bird submission receipts";
const SOURCE_AS_OF = "2026-07-28";

const submittedEvent = (event) =>
  Object.freeze({
    source: SOURCE,
    sourceAsOf: SOURCE_AS_OF,
    submittedAt: SOURCE_AS_OF,
    ...event,
  });

export const AUGUST_PROMOTION_EVENTS = Object.freeze([
  submittedEvent({
    id: "q3-priority-product-discounts-2026",
    name: "NA Q3 Priority Product Discounts (July - Nov 2026)",
    projectId: "23766503",
    status: "ACTIVE",
    submissionOpened: "2026-07-23 02:00 EST",
    curationDeadline: "2026-07-27 02:00 EST",
    start: "2026-07-28 03:00 EDT",
    end: "2026-11-19 03:00 EST",
    lengthDays: 115,
    category: "Extended Event",
    recommendedProducts: null,
    submittedProducts: 15,
    planningStatus: "ACTIVE",
    canRelyOnForPlan: true,
    planningNote: "15个SKU已生效；作为8月常驻折扣底盘，广告按利润Gate释放。",
  }),
  submittedEvent({
    id: "member-pop-up-august-2026",
    name: "Member Pop Up Sale - August 2026",
    projectId: "23673214",
    status: "SUBMITTED",
    submissionOpened: "2026-07-10 11:00 EST",
    curationDeadline: "2026-07-29 23:59 EST",
    start: "2026-08-05 00:00 EDT",
    end: "2026-08-07 23:59 EDT",
    lengthDays: 3,
    category: "Loyalty Exclusive",
    recommendedProducts: 26,
    submittedProducts: 8,
    planningStatus: "SUBMITTED_PROCESSING",
    canRelyOnForPlan: true,
    planningNote: "8个B2C SKU按8%提交，B2B未提报；等待Wayfair处理/排期。",
  }),
  submittedEvent({
    id: "clearout-august-2026",
    name: "NA 72 Hour Clearout - August 2026",
    projectId: "23685504",
    status: "SUBMITTED",
    submissionOpened: "2026-07-10 17:00 EST",
    curationDeadline: "2026-07-25 23:00 EST",
    start: "2026-08-08 00:00 EDT",
    end: "2026-08-11 02:59 EDT",
    lengthDays: 4,
    category: "Clearance",
    recommendedProducts: 52,
    submittedProducts: 15,
    planningStatus: "SUBMITTED_PROCESSING",
    canRelyOnForPlan: true,
    planningNote: "15个SKU已补报成功；等待Wayfair处理/排期，未生效前不提前放大广告。",
  }),
  submittedEvent({
    id: "summer-markdowns-august-2026",
    name: "NA Summer Markdowns - August 2026",
    projectId: "23697903",
    status: "SUBMITTED",
    submissionOpened: "2026-07-12 23:00 EST",
    curationDeadline: "2026-07-31 23:00 EST",
    start: "2026-08-11 03:00 EDT",
    end: "2026-08-17 02:59 EDT",
    lengthDays: 6,
    category: "Major Shopping Holiday",
    recommendedProducts: 52,
    submittedProducts: 20,
    planningStatus: "SUBMITTED_PROCESSING",
    canRelyOnForPlan: true,
    planningNote: "20个SKU已提交；主活动窗口，按实际生效SKU承接销量。",
  }),
  submittedEvent({
    id: "four-day-flash-august-2026",
    name: "NA Four Day Flash Sale - August 2026",
    projectId: "23723498",
    status: "SUBMITTED",
    submissionOpened: "2026-07-14 05:00 EST",
    curationDeadline: "2026-07-31 23:00 EST",
    start: "2026-08-17 03:00 EDT",
    end: "2026-08-21 03:00 EDT",
    lengthDays: 4,
    category: "Major Shopping Holiday",
    recommendedProducts: 52,
    submittedProducts: 20,
    planningStatus: "SUBMITTED_PROCESSING",
    canRelyOnForPlan: true,
    planningNote: "20个SKU已提交；冲量窗口仍按店铺利润率与库存Gate放量。",
  }),
  submittedEvent({
    id: "labor-day-august-2026",
    name: "NA Labor Day/Labour Day - August 2026",
    projectId: "23766473",
    status: "SUBMITTED",
    submissionOpened: "2026-07-17 08:00 EST",
    curationDeadline: "2026-08-07 23:00 EST",
    start: "2026-08-24 00:00 EDT",
    end: "2026-09-08 02:59 EDT",
    lengthDays: 16,
    category: "Major Shopping Holiday",
    recommendedProducts: null,
    submittedProducts: 20,
    planningStatus: "SUBMITTED_PROCESSING",
    canRelyOnForPlan: true,
    planningNote: "20个SKU已提交；月末收口窗口，只给通过利润、库存和转化Gate的SKU放量。",
  }),
]);

export const AUGUST_QUANTITY_PROMOTION = Object.freeze({
  id: "b2b-buy-2-save-5-august-2026",
  projectId: "16685433",
  name: "August 2026 B2B Quantity Discount - 16 SKUs",
  status: "PROCESSING",
  submittedAt: SOURCE_AS_OF,
  minimumQuantity: 2,
  additionalDiscount: 0.05,
  stackingRule: "与当时生效的最深B2B/活动折扣叠加。",
  platformMessage: "Your discount is being processed.",
  parts: Object.freeze([
    "3T-B",
    "3T-W",
    "4T-Kayak",
    "5T-1600-800",
    "5T-1830-1200",
    "5T-1980-1200",
    "5T-wangge",
    "6T-2095-122",
    "LFC-2B",
    "LFC-2B-680",
    "LFC-2W",
    "LFC-2W-680",
    "LFC-3B",
    "LFC-3W",
    "VFC-3B",
    "VFC-3W",
  ]),
});

const EVENT_GROUPS = Object.freeze({
  FILING_CORE: Object.freeze([
    "q3-priority-product-discounts-2026",
    "member-pop-up-august-2026",
    "clearout-august-2026",
    "summer-markdowns-august-2026",
    "four-day-flash-august-2026",
    "labor-day-august-2026",
  ]),
  GENERAL: Object.freeze([
    "q3-priority-product-discounts-2026",
    "clearout-august-2026",
    "summer-markdowns-august-2026",
    "four-day-flash-august-2026",
    "labor-day-august-2026",
  ]),
  SUPPLEMENTAL_FILING: Object.freeze([
    "member-pop-up-august-2026",
    "summer-markdowns-august-2026",
    "four-day-flash-august-2026",
    "labor-day-august-2026",
  ]),
  SUPPLEMENTAL_GENERAL: Object.freeze([
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
  const action = input.action || "SUBMITTED";
  const isSubmitted = action === "SUBMITTED";
  const quantityOffer =
    isSubmitted && AUGUST_QUANTITY_PROMOTION.parts.includes(input.part)
      ? AUGUST_QUANTITY_PROMOTION.additionalDiscount
      : 0;
  const normalizedInput = { ...input, quantityOffer };
  const roleMarginFloor =
    input.approvedMarginFloor ?? ROLE_MARGIN_FLOORS[input.role];
  const worstDiscount =
    input.worstDiscount ??
    (quantityOffer
      ? 1 - (1 - input.b2bTotalDiscount) * (1 - quantityOffer)
      : input.b2bTotalDiscount || 0);
  const netPrice =
    isSubmitted && Number.isFinite(input.priceBasisCents)
      ? input.priceBasisCents * (1 - worstDiscount)
      : null;
  const estimatedWorstMargin =
    netPrice && Number.isFinite(input.costCents)
      ? roundRate((netPrice - input.costCents) / netPrice)
      : null;

  return Object.freeze({
    reviewStatus: isSubmitted ? "APPROVED" : "APPROVED_HOLD",
    canSubmitToZiniao: false,
    submittedToZiniao: isSubmitted,
    submissionStatus: isSubmitted ? "SUBMITTED" : "ON_HOLD",
    b2cDiscount: 0,
    b2bTotalDiscount: 0,
    quantityOffer: 0,
    catalogLiveCount: 1,
    priceBasisType: "PARTNER_HOME_CURRENT_BASE_COST",
    eventGroup: isSubmitted ? "GENERAL" : "NONE",
    ...normalizedInput,
    action,
    roleMarginFloor,
    worstDiscount: roundRate(worstDiscount),
    estimatedWorstMargin,
    marginAlert:
      estimatedWorstMargin !== null && estimatedWorstMargin < roleMarginFloor,
    marginExceptionApproved: Number.isFinite(input.approvedMarginFloor),
    eventIds: EVENT_GROUPS[isSubmitted ? input.eventGroup || "GENERAL" : "NONE"],
    activeEventIds:
      isSubmitted &&
      EVENT_GROUPS[input.eventGroup || "GENERAL"].includes(
        "q3-priority-product-discounts-2026",
      )
        ? Object.freeze(["q3-priority-product-discounts-2026"])
        : Object.freeze([]),
    submittedEventIds: isSubmitted
      ? Object.freeze(
          EVENT_GROUPS[input.eventGroup || "GENERAL"].filter(
            (id) => id !== "q3-priority-product-discounts-2026",
          ),
        )
      : Object.freeze([]),
    memberB2cDiscount:
      isSubmitted &&
      ["FILING_CORE", "SUPPLEMENTAL_FILING"].includes(input.eventGroup)
        ? 0.08
        : null,
    quantityPromotionStatus: quantityOffer
      ? AUGUST_QUANTITY_PROMOTION.status
      : "NOT_APPLICABLE",
    discountPlan: discountLabel(normalizedInput),
    requiredGates: REVIEW_GATES,
    sourceAsOf: SOURCE_AS_OF,
  });
}

export const AUGUST_PROMOTION_PLAN = Object.freeze([
  part({
    listing: "DMOM1021",
    part: "LFC-2B-680",
    role: "VOLUME_CORE",
    priceBasisCents: 12000,
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
    priceBasisCents: 12000,
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
    priceBasisCents: 10500,
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
    priceBasisCents: 10500,
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
    priceBasisCents: 14000,
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
    priceBasisCents: 7000,
    costCents: 4300,
    inventoryOnHand: 492,
    catalogLiveCount: 1,
    juneUnits: 3,
    julyUnits: 2,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "SUPPLEMENTAL_GENERAL",
    reason: "已确认唯一映射为DMOM1017；作为低客单跑量补充款，按8%/13%增补开放活动。",
  }),
  part({
    listing: "DMOM1017",
    part: "3T-W",
    role: "VOLUME_CORE",
    priceBasisCents: 7000,
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
    priceBasisCents: 12000,
    costCents: 7090,
    inventoryOnHand: 997,
    juneUnits: 4,
    julyUnits: 4,
    b2cDiscount: 0.1,
    b2bTotalDiscount: 0.15,
    reason: "高评分、高库存的B2B/自然次级跑量款；用户允许压缩利润，但按正确Base Cost核算后无需突破20%角色底线，叠加多件优惠的订单不追加广告。",
  }),
  part({
    listing: "DMOM1019",
    part: "VFC-3W",
    role: "PROFIT_POOL",
    priceBasisCents: 12000,
    costCents: 7090,
    inventoryOnHand: 336,
    juneUnits: 5,
    julyUnits: 1,
    b2cDiscount: 0.1,
    b2bTotalDiscount: 0.15,
    reason: "高评分、高库存的B2B/自然次级跑量款；用户允许压缩利润，但按正确Base Cost核算后无需突破20%角色底线，叠加多件优惠的订单不追加广告。",
  }),
  part({
    listing: "DMOM1000",
    part: "5T-1600-800",
    role: "PROFIT_POOL",
    priceBasisCents: 8500,
    costCents: 4300,
    inventoryOnHand: 221,
    juneUnits: 0,
    julyUnits: 0,
    b2cDiscount: 0.1,
    b2bTotalDiscount: 0.15,
    eventGroup: "SUPPLEMENTAL_GENERAL",
    reason: "Partner Home当前Base Cost $85、认证成本$43；DMOM1000合法多变体，作为货架利润款增补开放活动。",
  }),
  part({
    listing: "DMOM1000",
    part: "5T-1830-1200",
    role: "PROFIT_POOL",
    priceBasisCents: 14000,
    costCents: 6800,
    inventoryOnHand: 795,
    juneUnits: 0,
    julyUnits: 0,
    b2cDiscount: 0.1,
    b2bTotalDiscount: 0.15,
    eventGroup: "SUPPLEMENTAL_GENERAL",
    reason: "Partner Home当前Base Cost $140、认证成本$68；利润与库存充足，作为货架利润款增补开放活动。",
  }),
  part({
    listing: "DMOM1000",
    part: "5T-1830-900",
    role: "PROFIT_POOL",
    priceBasisCents: 8900,
    costCents: 4500,
    inventoryOnHand: 37,
    juneUnits: 0,
    julyUnits: 1,
    action: "HOLD",
    reason: "Partner Home当前总库存37件，是DMOM1000最低库存变体；保留为非促销利润与可用性保护款，库存恢复至60件再评估。",
  }),
  part({
    listing: "DMOM1000",
    part: "5T-1980-1200",
    role: "PROFIT_POOL",
    priceBasisCents: 12000,
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
    priceBasisCents: 15000,
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
    priceBasisCents: 13500,
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
    priceBasisCents: 13500,
    costCents: 7540,
    inventoryOnHand: 273,
    juneUnits: 0,
    julyUnits: 0,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "SUPPLEMENTAL_FILING",
    reason: "Partner Home当前Base Cost $135、认证成本$75.40，前台白色变体价格已复核；只承接活动自然流量。",
  }),
  part({
    listing: "DMOM1025",
    part: "LFC-3B",
    role: "REPAIR_ORGANIC",
    priceBasisCents: 15500,
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
    priceBasisCents: 15500,
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
    priceBasisCents: 8000,
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
    priceBasisCents: 8000,
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
    priceBasisCents: 8000,
    costCents: 4500,
    inventoryOnHand: 696,
    juneUnits: 0,
    julyUnits: 0,
    b2cDiscount: 0.08,
    b2bTotalDiscount: 0.13,
    eventGroup: "SUPPLEMENTAL_GENERAL",
    reason: "当前前台价$113.99、中台Base Cost $80、认证成本$45；高库存货架款按8%/13%恢复活动测试。",
  }),
]);

const BASELINE_REVENUE = 17648.94;
const BASELINE_GROSS_PROFIT = 6167.66;
const FULL_PROMOTION_DISCOUNT_LOSS = 2419.56;
const RECOMMENDED_AD_BUDGET = AUGUST_EXECUTION_POLICY.baseAdBudget;
const AUTHORIZED_STAGE_ONE_AD_CAP = AUGUST_EXECUTION_POLICY.stageOneAdCap;

function portfolioScenario(promotionOrderShare, quantityOrderShare) {
  const discountLoss = FULL_PROMOTION_DISCOUNT_LOSS * promotionOrderShare;
  const revenueAfterEventDiscount = BASELINE_REVENUE - discountLoss;
  const quantityDiscountLoss =
    revenueAfterEventDiscount *
    quantityOrderShare *
    AUGUST_QUANTITY_PROMOTION.additionalDiscount;
  const projectedRevenue = revenueAfterEventDiscount - quantityDiscountLoss;
  const projectedGrossProfit =
    BASELINE_GROSS_PROFIT - discountLoss - quantityDiscountLoss;
  const projectedPostAdProfit =
    projectedGrossProfit - AUTHORIZED_STAGE_ONE_AD_CAP;
  return Object.freeze({
    promotionOrderShare,
    quantityOrderShare,
    eventDiscountLoss: roundMoney(discountLoss),
    quantityDiscountLoss: roundMoney(quantityDiscountLoss),
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
  baseAdBudget: AUGUST_EXECUTION_POLICY.baseAdBudget,
  performanceReserve: AUGUST_EXECUTION_POLICY.canaryLossCap,
  stageOneAdCap: AUGUST_EXECUTION_POLICY.stageOneAdCap,
  stageTwoAdCap: AUGUST_EXECUTION_POLICY.stageTwoAdCap,
  fallbackAdBudget: AUGUST_EXECUTION_POLICY.baseAdBudget,
  retiredAdBudgets: AUGUST_EXECUTION_POLICY.retiredAdBudgets,
  fullPromotionDiscountLoss: FULL_PROMOTION_DISCOUNT_LOSS,
  primaryPromotionOrderShare: 0.6,
  stressPromotionOrderShare: 0.7,
  primaryQuantityOrderShare: 0.15,
  stressQuantityOrderShare: 0.2,
  methodology:
    "以批准销售计划为基线：活动订单占比按60%主情景、70%压力情景；B2B买2件额外5%的订单占比分别按15%与20%叠加测算；成本不随折扣下降。",
  budgetRule:
    "先执行$1,800基础预算，Canary增量亏损最多$61.10；促销、利润、库存、履约、Listing和映射门禁全部通过前，总支出不得超过$1,861.10。第二阶段总上限为$2,019.57，低于10%利润率立即停止扩量。",
  scenarios: Object.freeze([
    portfolioScenario(0.6, 0.15),
    portfolioScenario(0.7, 0.2),
    portfolioScenario(1, 0.3),
  ]),
});

export function promotionReviewSummary(plan = AUGUST_PROMOTION_PLAN) {
  const submitted = plan.filter((item) => item.action === "SUBMITTED");
  const held = plan.filter((item) => item.action === "HOLD");
  const submittedToZiniao = plan.filter((item) => item.submittedToZiniao);
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
    submittedListings: new Set(submitted.map((item) => item.listing)).size,
    submittedParts: submitted.length,
    heldParts: held.length,
    approvedParts: plan.filter((item) => item.reviewStatus === "APPROVED").length,
    ziniaoSubmittedParts: submittedToZiniao.length,
    activeEvents: AUGUST_PROMOTION_EVENTS.filter((event) => event.status === "ACTIVE").length,
    submittedEvents: AUGUST_PROMOTION_EVENTS.filter((event) => event.status === "SUBMITTED").length,
    quantityPromotionParts: AUGUST_QUANTITY_PROMOTION.parts.length,
    quantityPromotionStatus: AUGUST_QUANTITY_PROMOTION.status,
    marginAlertParts: submitted.filter((item) => item.marginAlert).length,
    marginExceptionParts: submitted.filter((item) => item.marginExceptionApproved).length,
    originalAdBudget: AUGUST_PROMOTION_PORTFOLIO.originalAdBudget,
    recommendedAdBudget: AUGUST_PROMOTION_PORTFOLIO.recommendedAdBudget,
    adBudgetReduction:
      AUGUST_PROMOTION_PORTFOLIO.originalAdBudget -
      AUGUST_PROMOTION_PORTFOLIO.recommendedAdBudget,
    projectedPromotionOrderShare: primary.promotionOrderShare,
    projectedRevenue: primary.projectedRevenue,
    projectedPostAdProfit: primary.projectedPostAdProfit,
    projectedPostAdMargin: primary.projectedPostAdMargin,
    projectedQuantityOrderShare: primary.quantityOrderShare,
    stressPromotionOrderShare: stress.promotionOrderShare,
    stressQuantityOrderShare: stress.quantityOrderShare,
    stressPostAdMargin: stress.projectedPostAdMargin,
    fallbackAdBudget: AUGUST_PROMOTION_PORTFOLIO.fallbackAdBudget,
    fullPromotionHardAdCap: full.hardAdCapAt10Percent,
  };
}

export function syncPromotionsToSalesPlan(
  salesRows,
  promotionPlan = AUGUST_PROMOTION_PLAN,
) {
  return Object.freeze(
    salesRows.map((row) => {
      const parts = promotionPlan.filter((item) => item.listing === row.listing);
      const submitted = parts.filter((item) => item.action === "SUBMITTED");
      const held = parts.filter((item) => item.action === "HOLD");
      const eventIds = [...new Set(submitted.flatMap((item) => item.eventIds))];
      const activeEventIds = [...new Set(submitted.flatMap((item) => item.activeEventIds))];
      const submittedEventIds = [
        ...new Set(submitted.flatMap((item) => item.submittedEventIds)),
      ];
      const quantityParts = submitted
        .filter((item) => item.quantityOffer > 0)
        .map((item) => item.part);
      const discountTiers = [
        ...new Set(
          submitted.map(
            (item) =>
              `${Math.round(item.b2cDiscount * 100)}%/${Math.round(item.b2bTotalDiscount * 100)}%`,
          ),
        ),
      ];

      return Object.freeze({
        ...row,
        promotion: Object.freeze({
          status:
            submitted.length === 0
              ? "ON_HOLD"
              : held.length
                ? "PARTIALLY_SUBMITTED"
                : "SUBMITTED",
          submittedParts: Object.freeze(submitted.map((item) => item.part)),
          heldParts: Object.freeze(held.map((item) => item.part)),
          eventIds: Object.freeze(eventIds),
          activeEventIds: Object.freeze(activeEventIds),
          submittedEventIds: Object.freeze(submittedEventIds),
          discountTiers: Object.freeze(discountTiers),
          quantityOfferParts: Object.freeze(quantityParts),
          marginAlertParts: Object.freeze(
            submitted.filter((item) => item.marginAlert).map((item) => item.part),
          ),
          marginExceptionParts: Object.freeze(
            submitted
              .filter((item) => item.marginExceptionApproved)
              .map((item) => item.part),
          ),
          syncedAt: SOURCE_AS_OF,
        }),
      });
    }),
  );
}
