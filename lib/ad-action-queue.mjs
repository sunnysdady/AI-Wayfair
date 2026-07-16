export const WAYFAIR_ADVERTISING_AUDIENCE = "https://api.wayfair.com/";

export function canRetryAction(status) {
  return status === "FAILED";
}

function payload(value) {
  if (typeof value === "string") return JSON.parse(value || "{}");
  return value && typeof value === "object" ? value : {};
}

function bid(value, listing) {
  const numeric = Number(value);
  const truncated = Math.trunc(numeric * 100) / 100;
  if (!Number.isFinite(numeric) || truncated < 0.05 || truncated > 10000) {
    throw new Error(`Listing ${listing} 的 Bid 必须在 0.05 到 10000 之间`);
  }
  return truncated.toFixed(2);
}

export function queuedActionState(actions = []) {
  const visible = {
    APPROVED: "approved",
    VALIDATED: "validated",
    EXECUTING: "executing",
    EXECUTED: "executed",
    FAILED: "failed",
  };
  return Object.fromEntries(actions.map((action) => [
    `${action.campaign_id}:${action.listing}`,
    visible[action.status] || "saved",
  ]));
}

export function buildCampaignUpdates(actions = []) {
  const campaigns = new Map();
  for (const action of actions) {
    if (!["APPROVED", "VALIDATED"].includes(action.status)) continue;
    if (!["SET_LISTING_BID", "SET_LISTING_ACTIVE"].includes(action.action_type)) continue;
    if (!/^\d+$/.test(String(action.campaign_id || ""))) throw new Error("Campaign ID 必须为数字");
    if (!String(action.listing || "").trim()) throw new Error("Listing 不能为空");
    const before = payload(action.before_payload);
    const proposed = payload(action.proposed_payload);
    const listingBid = action.action_type === "SET_LISTING_BID" ? proposed.bid : before.bid;
    const isActive = action.action_type === "SET_LISTING_ACTIVE" ? proposed.active : before.active;
    if (typeof isActive !== "boolean") throw new Error(`Listing ${action.listing} 缺少有效的启停状态`);
    const campaignId = String(action.campaign_id);
    const campaign = campaigns.get(campaignId) || { campaignId, actionIds: [], listings: {} };
    campaign.actionIds.push(action.id);
    campaign.listings[action.listing] = { bid: bid(listingBid, action.listing), isActive };
    campaigns.set(campaignId, campaign);
  }
  return [...campaigns.values()];
}
