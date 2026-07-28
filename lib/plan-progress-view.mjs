export const PLAN_PROGRESS_CACHE_KEY = "plan:progress:v5";

const numberOrZero = (value) => Number.isFinite(value) ? value : 0;

export function promotionSummaryForDisplay(summary) {
  return {
    proposedListings: numberOrZero(summary?.proposedListings),
    proposedParts: numberOrZero(summary?.proposedParts),
    heldParts: numberOrZero(summary?.heldParts),
    pendingReviewParts: numberOrZero(summary?.pendingReviewParts),
    ziniaoReadyParts: numberOrZero(summary?.ziniaoReadyParts),
    submissionLocked: summary?.submissionLocked !== false,
    recommendedAdBudget: numberOrZero(summary?.recommendedAdBudget),
    projectedPostAdMargin: numberOrZero(summary?.projectedPostAdMargin),
  };
}
