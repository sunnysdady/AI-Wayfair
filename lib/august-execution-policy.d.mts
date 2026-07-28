export type AugustPromotionEventStatus = {
  status?: string | null;
};

export type AugustStageTwoInput = {
  promotionEvents?: AugustPromotionEventStatus[];
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
  policy: string;
}>;

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
