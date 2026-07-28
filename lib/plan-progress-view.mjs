export const PLAN_PROGRESS_CACHE_KEY = "plan:progress:v3";

const numberOrZero = (value) => Number.isFinite(value) ? value : 0;

export function promotionSummaryForDisplay(summary) {
  return {
    proposedListings: numberOrZero(summary?.proposedListings),
    proposedParts: numberOrZero(summary?.proposedParts),
    heldOrExcludedListings: numberOrZero(summary?.heldOrExcludedListings),
    pendingReviewListings: numberOrZero(summary?.pendingReviewListings),
    ziniaoReadyListings: numberOrZero(summary?.ziniaoReadyListings),
    submissionLocked: summary?.submissionLocked !== false,
  };
}
