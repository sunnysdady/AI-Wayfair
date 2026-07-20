// Operator-confirmed platform states that are not exposed reliably by the Campaign report.
// Keep the report status as evidence too; a disagreement must become a manual reconciliation task.
export const AI_CAMPAIGN_PLATFORM_OBSERVATIONS = Object.freeze({
  "660198": Object.freeze({
    platformStage: "ACTIVE_LEARNING",
    platformObservedAt: "2026-07-20",
    platformSource: "Partner Home",
  }),
});

export function platformObservationForCampaign(campaignId) {
  return AI_CAMPAIGN_PLATFORM_OBSERVATIONS[String(campaignId)] || null;
}
