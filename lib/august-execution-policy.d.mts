export type AugustPromotionEventStatus = {
  status?: string | null;
};

export type AugustStageTwoInput = {
  promotionEvents?: readonly AugustPromotionEventStatus[];
  projectedPostAdMargin?: number;
  fillRate?: number;
  minimumInventoryCoverDays?: number;
  listingOperationalEvidenceVerified?: boolean;
  mappingScopeVerified?: boolean;
};

export const AUGUST_EXECUTION_POLICY: Readonly<{
  id: string;
  authorizationStatus: "APPROVED";
  authorizedAt: string;
  targetMetric: "ORDERS";
  stretchOrderTarget: number;
  baseAdBudget: number;
  canaryLossCap: number;
  stageOneAdCap: number;
  stageTwoAdCap: number;
  retiredAdBudgets: readonly number[];
  earliestCanaryStart: string;
  marginFloor: number;
  fillRateFloor: number;
  inventoryCoverDaysFloor: number;
  campaignControlGuardrails: Readonly<{
    attributionMaturityDays: number;
    restoredCapPaceMultiplier: number;
    pauseReviewersRequired: number;
    mixedCampaignPolicy: "ISOLATE_ZERO_BUDGET_LISTINGS_FIRST";
    longTermSoftPauseAllowed: false;
  }>;
  policy: string;
}>;

export type AugustCampaignExecutionFact = {
  campaignId: string;
  status: "ACTIVE" | "PAUSED";
  dailyCap: number | null;
  protectedFromWholeCampaignPause: boolean;
  controlMode:
    | "LISTING_ISOLATION"
    | "CAMPAIGN_PAUSED"
    | "CAMPAIGN_ACTIVE";
  isolatedProducts: Array<{
    listing: string;
    part: string;
    status: "PAUSED";
  }>;
};

export const AUGUST_AD_EXECUTION_STATUS: Readonly<{
  asOf: string;
  walletDailyCap: number;
  activeCampaignDailyCap: number;
  otherActiveCampaignDailyCap: number;
  correctedCampaign: Readonly<{
    campaignId: "597350";
    status: "ACTIVE";
    dailyCap: number;
    last28RetailRoas: number;
    pausedProductRows: readonly string[];
  }>;
  pausedCampaignIds: readonly string[];
}>;

export const AUGUST_CAMPAIGN_CONTROL_SNAPSHOT: Readonly<{
  asOf: string;
  source: string;
  walletDailyCap: number;
  activeCampaignDailyCap: number;
  walletHeadroom: number;
  activeCampaignDailyCaps: Readonly<Record<string, number>>;
  pausedCampaignIds: readonly string[];
  correctedCampaign: Readonly<{
    campaignId: "597350";
    status: "ACTIVE";
    dailyCap: number;
    last28Spend: number;
    last28Revenue: number;
    last28RetailRoas: number;
    protectedFromWholeCampaignPause: true;
    controlMode: "LISTING_ISOLATION";
    isolatedProducts: readonly Readonly<{
      listing: "DMOM1025";
      part: "LFC-3W";
      status: "PAUSED";
    }>[];
  }>;
}>;

export function campaignExecutionFact(
  campaignId?: string,
): AugustCampaignExecutionFact | null;

export function reconcileAugustCampaignFindings<T extends {
  campaignId?: string;
  actionType?: string;
}>(findings?: T[]): {
  findings: T[];
  suppressed: Array<T & { reason: string }>;
};

export function recommendedAugustCampaignDailyCap(input?: {
  averageDailySpend?: number;
  plannedDailyCap?: number;
}): number;

export function evaluateAugustCampaignPause(input?: {
  attributionAgeDays?: number;
  last28Spend?: number;
  last28Revenue?: number;
  last28Orders?: number;
  contributionMarginRate?: number;
  minimumEvidenceMet?: boolean;
  listings?: readonly {
    listing?: string;
    plannedAdBudget?: number;
  }[];
}): {
  allowed: boolean;
  reason: string;
  recommendedAction: string;
  contributionAfterAds: number;
  last28Orders: number;
  zeroBudgetListings: string[];
  budgetedListings: string[];
};

export function evaluateAugustStageTwo(input?: AugustStageTwoInput): {
  ready: boolean;
  authorizedAdCap: number;
  blockers: string[];
};

export function validateAugustRunForExecution(input?: {
  runKey?: string;
  asOf?: string;
}): {
  allowed: boolean;
  reason: string | null;
};

export function authorizedAugustAdCap(stageTwoReady?: boolean): number;
