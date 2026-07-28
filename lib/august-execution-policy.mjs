const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

export const AUGUST_EXECUTION_POLICY = Object.freeze({
  id: "yb-2026-08-authorized-execution",
  authorizationStatus: "APPROVED",
  authorizedAt: "2026-07-28",
  targetMetric: "ORDERS",
  stretchOrderTarget: 150,
  baseAdBudget: 1800,
  canaryLossCap: 61.1,
  stageOneAdCap: 1861.1,
  stageTwoAdCap: 2019.57,
  retiredAdBudgets: Object.freeze([2700, 4050]),
  earliestCanaryStart: "2026-08-08",
  marginFloor: 0.1,
  fillRateFloor: 0.95,
  inventoryCoverDaysFloor: 14,
  campaignControlGuardrails: Object.freeze({
    attributionMaturityDays: 14,
    restoredCapPaceMultiplier: 1.2,
    pauseReviewersRequired: 2,
    mixedCampaignPolicy: "ISOLATE_ZERO_BUDGET_LISTINGS_FIRST",
    longTermSoftPauseAllowed: false,
  }),
  policy:
    "先执行$1,800基础广告预算；模型实验增量亏损最多$61.10，首阶段总上限$1,861.10。只有促销、利润、库存、履约、Listing与映射门禁全部通过，才可把月度上限提高到$2,019.57。",
});

export function recommendedAugustCampaignDailyCap({
  averageDailySpend = 0,
  plannedDailyCap = 0,
} = {}) {
  const pace = Number(averageDailySpend);
  const planCap = Number(plannedDailyCap);
  if (!(pace > 0) || !(planCap > 0)) return 0;
  const paceCap = Math.ceil(
    pace * AUGUST_EXECUTION_POLICY.campaignControlGuardrails.restoredCapPaceMultiplier,
  );
  return roundMoney(Math.min(planCap, paceCap));
}

export function evaluateAugustCampaignPause({
  attributionAgeDays = 0,
  last28Spend = 0,
  last28Revenue = 0,
  last28Orders = 0,
  contributionMarginRate = 0,
  minimumEvidenceMet = false,
  listings = [],
} = {}) {
  const normalizedListings = listings.map((item) => ({
    listing: String(item?.listing || ""),
    plannedAdBudget: roundMoney(item?.plannedAdBudget),
  }));
  const zeroBudgetListings = normalizedListings
    .filter((item) => item.plannedAdBudget <= 0)
    .map((item) => item.listing)
    .filter(Boolean);
  const budgetedListings = normalizedListings.filter(
    (item) => item.plannedAdBudget > 0,
  );
  const contributionAfterAds = roundMoney(
    Number(last28Revenue || 0) * Number(contributionMarginRate || 0) -
      Number(last28Spend || 0),
  );

  const result = (allowed, reason, recommendedAction) => ({
    allowed,
    reason,
    recommendedAction,
    contributionAfterAds,
    last28Orders: Number(last28Orders || 0),
    zeroBudgetListings,
    budgetedListings: budgetedListings.map((item) => item.listing),
  });

  if (normalizedListings.length && budgetedListings.length === 0) {
    return result(true, "ALL_LISTINGS_HAVE_ZERO_BUDGET", "PAUSE_CAMPAIGN");
  }

  if (
    Number(attributionAgeDays || 0) <
    AUGUST_EXECUTION_POLICY.campaignControlGuardrails.attributionMaturityDays
  ) {
    return result(false, "ATTRIBUTION_WINDOW_NOT_MATURE", "OBSERVE");
  }

  if (zeroBudgetListings.length && budgetedListings.length) {
    return result(
      false,
      contributionAfterAds > 0
        ? "PROFITABLE_MIXED_CAMPAIGN_REQUIRES_LISTING_ISOLATION"
        : "MIXED_CAMPAIGN_REQUIRES_LISTING_ISOLATION",
      "PAUSE_ZERO_BUDGET_LISTINGS",
    );
  }

  if (contributionAfterAds > 0) {
    return result(false, "CAMPAIGN_CONTRIBUTION_POSITIVE", "KEEP_ACTIVE");
  }

  if (!minimumEvidenceMet) {
    return result(false, "MINIMUM_EVIDENCE_NOT_MET", "OBSERVE");
  }

  return result(true, "MATURE_CAMPAIGN_LOSS_CONFIRMED", "PAUSE_CAMPAIGN");
}

export function evaluateAugustStageTwo({
  promotionEvents = [],
  projectedPostAdMargin = 0,
  fillRate = 0,
  minimumInventoryCoverDays = 0,
  listingOperationalEvidenceVerified = false,
  mappingScopeVerified = false,
} = {}) {
  const blockers = [];
  const unresolvedPromotions = promotionEvents.filter(
    (event) => !["ACTIVE", "COMPLETED"].includes(String(event?.status || "")),
  );
  if (!promotionEvents.length || unresolvedPromotions.length) {
    blockers.push("PROMOTIONS_NOT_ACTIVE");
  }
  if (Number(projectedPostAdMargin) < AUGUST_EXECUTION_POLICY.marginFloor) {
    blockers.push("CONTRIBUTION_MARGIN_BELOW_FLOOR");
  }
  if (Number(fillRate) < AUGUST_EXECUTION_POLICY.fillRateFloor) {
    blockers.push("FILL_RATE_BELOW_FLOOR");
  }
  if (
    Number(minimumInventoryCoverDays) <
    AUGUST_EXECUTION_POLICY.inventoryCoverDaysFloor
  ) {
    blockers.push("INVENTORY_COVER_BELOW_FLOOR");
  }
  if (!listingOperationalEvidenceVerified) {
    blockers.push("LISTING_OPERATIONAL_EVIDENCE_UNVERIFIED");
  }
  if (!mappingScopeVerified) blockers.push("MAPPING_SCOPE_UNVERIFIED");

  return {
    ready: blockers.length === 0,
    authorizedAdCap: blockers.length
      ? AUGUST_EXECUTION_POLICY.stageOneAdCap
      : AUGUST_EXECUTION_POLICY.stageTwoAdCap,
    blockers,
  };
}

export function validateAugustRunForExecution({ runKey, asOf } = {}) {
  const match = /^weekly:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(
    String(runKey || ""),
  );
  if (!match) return { allowed: false, reason: "INVALID_RUN_KEY" };
  const [, , runEnd] = match;
  if (
    String(asOf || "") >= AUGUST_EXECUTION_POLICY.authorizedAt &&
    runEnd < "2026-08-01"
  ) {
    return {
      allowed: false,
      reason: "SUPERSEDED_BY_AUTHORIZED_AUGUST_PLAN",
    };
  }
  return { allowed: true, reason: null };
}

export function authorizedAugustAdCap(stageTwoReady = false) {
  return roundMoney(
    stageTwoReady
      ? AUGUST_EXECUTION_POLICY.stageTwoAdCap
      : AUGUST_EXECUTION_POLICY.stageOneAdCap,
  );
}
