export function shouldGenerateAdModelTodo(decision = {}) {
  const status = String(
    decision?.operatingState?.campaignStatus || "",
  ).toUpperCase();
  const explicitlyInactive =
    decision?.operatingState?.campaignActive === false;
  const statusInactive = /INACTIVE|ARCHIVED|PAUSED|FALSE/.test(status);
  const verifiedPaused = decision?.campaignControl?.status === "PAUSED";

  if (explicitlyInactive || statusInactive || verifiedPaused) {
    return { include: false, reason: "CAMPAIGN_NOT_ACTIVE" };
  }
  return { include: true, reason: null };
}
