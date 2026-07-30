export type CanaryRisk = {
  approved: boolean;
  maxLoss: number;
  maxDailyIncrementalLoss: number;
};

export const AD_CANARY_RISK_POLICY: {
  basis: string;
  monthlyRevenueTarget: number;
  monthlyContributionFloor: number;
  baseAdPlan: number;
  conservativeMarginRate: number;
  projectedContribution: number;
  targetBuffer: number;
  portfolioMaxLoss: number;
  portfolioMaxDailyIncrementalLoss: number;
  earliestStart: string;
  earliestMatureReview: string;
  scope: string;
};

export function canaryRiskForListing(listing: string): CanaryRisk;
