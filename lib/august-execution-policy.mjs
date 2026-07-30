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

const activeCampaignDailyCaps = Object.freeze({
  "597350": 4,
  "622725": 15,
  "622741": 3,
  "622721": 5,
  "622759": 5,
  "635903": 5,
  "676299": 2,
  "675055": 2,
  "676302": 2,
  "676296": 2,
});

export const AUGUST_AD_EXECUTION_STATUS = Object.freeze({
  asOf: "2026-07-28",
  walletDailyCap: 60,
  activeCampaignDailyCap: 45,
  otherActiveCampaignDailyCap: 41,
  correctedCampaign: Object.freeze({
    campaignId: "597350",
    status: "ACTIVE",
    dailyCap: 4,
    last28RetailRoas: 25.3,
    pausedProductRows: Object.freeze(["DMOM1025", "LFC-3W"]),
  }),
  pausedCampaignIds: Object.freeze(["661593", "622734", "622727"]),
});

export const AUGUST_CAMPAIGN_CONTROL_SNAPSHOT = Object.freeze({
  asOf: "2026-07-28",
  source: "Wayfair Partner Home 写入回执与回读",
  walletDailyCap: AUGUST_AD_EXECUTION_STATUS.walletDailyCap,
  activeCampaignDailyCap:
    AUGUST_AD_EXECUTION_STATUS.activeCampaignDailyCap,
  walletHeadroom:
    AUGUST_AD_EXECUTION_STATUS.walletDailyCap -
    AUGUST_AD_EXECUTION_STATUS.activeCampaignDailyCap,
  activeCampaignDailyCaps,
  pausedCampaignIds: AUGUST_AD_EXECUTION_STATUS.pausedCampaignIds,
  correctedCampaign: Object.freeze({
    campaignId: "597350",
    status: "ACTIVE",
    dailyCap: 4,
    last28Spend: 93.17,
    last28Revenue: 2357,
    last28RetailRoas: 25.3,
    protectedFromWholeCampaignPause: true,
    controlMode: "LISTING_ISOLATION",
    isolatedProducts: Object.freeze([
      Object.freeze({
        listing: "DMOM1025",
        part: "LFC-3W",
        status: "PAUSED",
      }),
    ]),
  }),
});

export function campaignExecutionFact(campaignId) {
  const id = String(campaignId || "");
  if (id === AUGUST_CAMPAIGN_CONTROL_SNAPSHOT.correctedCampaign.campaignId) {
    const corrected = AUGUST_CAMPAIGN_CONTROL_SNAPSHOT.correctedCampaign;
    return {
      campaignId: id,
      status: corrected.status,
      dailyCap: corrected.dailyCap,
      protectedFromWholeCampaignPause:
        corrected.protectedFromWholeCampaignPause,
      controlMode: corrected.controlMode,
      isolatedProducts: corrected.isolatedProducts.map((item) => ({ ...item })),
    };
  }
  if (AUGUST_CAMPAIGN_CONTROL_SNAPSHOT.pausedCampaignIds.includes(id)) {
    return {
      campaignId: id,
      status: "PAUSED",
      dailyCap: null,
      protectedFromWholeCampaignPause: false,
      controlMode: "CAMPAIGN_PAUSED",
      isolatedProducts: [],
    };
  }
  if (Object.hasOwn(activeCampaignDailyCaps, id)) {
    return {
      campaignId: id,
      status: "ACTIVE",
      dailyCap: activeCampaignDailyCaps[id],
      protectedFromWholeCampaignPause: false,
      controlMode: "CAMPAIGN_ACTIVE",
      isolatedProducts: [],
    };
  }
  return null;
}

export function reconcileAugustCampaignFindings(findings = []) {
  const suppressed = [];
  const active = [];
  for (const finding of findings) {
    const campaignId = String(finding?.campaignId || "");
    const fact = campaignExecutionFact(campaignId);
    if (
      campaignId ===
        AUGUST_CAMPAIGN_CONTROL_SNAPSHOT.correctedCampaign.campaignId &&
      finding?.actionType === "PAUSE_CAMPAIGN"
    ) {
      suppressed.push({
        ...finding,
        reason: "SUPERSEDED_BY_LISTING_ISOLATION",
      });
      continue;
    }
    if (
      fact?.status === "PAUSED" &&
      finding?.actionType === "PAUSE_CAMPAIGN"
    ) {
      suppressed.push({ ...finding, reason: "ALREADY_PAUSED" });
      continue;
    }
    active.push(finding);
  }
  return { findings: active, suppressed };
}

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
