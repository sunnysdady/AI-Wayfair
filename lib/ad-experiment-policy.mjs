const MONTHLY_REVENUE_TARGET = 16_800;
const BASE_AD_PLAN = 1_800;
const CONSERVATIVE_MARGIN_RATE = 0.340504;
const PORTFOLIO_MAX_LOSS = 61.1;
const PROJECTED_CONTRIBUTION = Number((
  MONTHLY_REVENUE_TARGET * CONSERVATIVE_MARGIN_RATE - BASE_AD_PLAN
).toFixed(2));
const MONTHLY_CONTRIBUTION_FLOOR = Number((PROJECTED_CONTRIBUTION - PORTFOLIO_MAX_LOSS).toFixed(2));

const LISTING_LIMITS = Object.freeze({
  DMOM1021: Object.freeze({ maxLoss: 41.1, maxDailyIncrementalLoss: 5.87 }),
  DMOM1017: Object.freeze({ maxLoss: 20, maxDailyIncrementalLoss: 2.86 }),
});

export const AD_CANARY_RISK_POLICY = Object.freeze({
  basis: "AUGUST_CONTRIBUTION_PROXY_FLOOR",
  monthlyRevenueTarget: MONTHLY_REVENUE_TARGET,
  monthlyContributionFloor: MONTHLY_CONTRIBUTION_FLOOR,
  baseAdPlan: BASE_AD_PLAN,
  conservativeMarginRate: CONSERVATIVE_MARGIN_RATE,
  projectedContribution: PROJECTED_CONTRIBUTION,
  targetBuffer: Number((PROJECTED_CONTRIBUTION - MONTHLY_CONTRIBUTION_FLOOR).toFixed(2)),
  portfolioMaxLoss: PORTFOLIO_MAX_LOSS,
  portfolioMaxDailyIncrementalLoss: 8.73,
  earliestStart: "2026-08-08",
  earliestMatureReview: "2026-08-29",
  scope: "INCREMENTAL_CANARY_LOSS_NOT_TOTAL_CAMPAIGN_CAP",
});

export function canaryRiskForListing(listing) {
  const limit = LISTING_LIMITS[String(listing || "")];
  return limit
    ? { approved: true, ...limit }
    : { approved: false, maxLoss: 0, maxDailyIncrementalLoss: 0 };
}
