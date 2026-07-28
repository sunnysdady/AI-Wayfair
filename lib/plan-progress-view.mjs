export const PLAN_PROGRESS_CACHE_KEY = "plan:progress:v6";

const numberOrZero = (value) => Number.isFinite(value) ? value : 0;

export function promotionSummaryForDisplay(summary) {
  return {
    submittedListings: numberOrZero(summary?.submittedListings),
    submittedParts: numberOrZero(summary?.submittedParts),
    heldParts: numberOrZero(summary?.heldParts),
    ziniaoSubmittedParts: numberOrZero(summary?.ziniaoSubmittedParts),
    activeEvents: numberOrZero(summary?.activeEvents),
    submittedEvents: numberOrZero(summary?.submittedEvents),
    quantityPromotionParts: numberOrZero(summary?.quantityPromotionParts),
    marginAlertParts: numberOrZero(summary?.marginAlertParts),
    marginExceptionParts: numberOrZero(summary?.marginExceptionParts),
    recommendedAdBudget: numberOrZero(summary?.recommendedAdBudget),
    projectedPostAdMargin: numberOrZero(summary?.projectedPostAdMargin),
  };
}
