export const WAYFAIR_ADVERTISING_AUDIENCE = "https://api.wayfair.com/";

export function canRetryAction(status) {
  return status === "FAILED";
}

export function isBulkApprovable(action = {}) {
  return ["PLANNED", "FAILED"].includes(action.status)
    && ["SET_LISTING_BID", "SET_LISTING_ACTIVE"].includes(action.action_type);
}

export function filterAdActions(rows = [], filters = {}, queueState = {}) {
  const query = String(filters.query || "").trim().toLowerCase();
  const recommendation = filters.recommendation || "ALL";
  const queue = filters.queue || "ALL";
  return rows.filter((row) => {
    const key = `${row.campaignId}:${row.listing}`;
    const queued = Boolean(queueState[key]);
    const haystack = [row.listing, row.campaignId, ...(row.parts || [])].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (recommendation !== "ALL" && row.action?.recommendation !== recommendation) return false;
    if (queue === "queued" && !queued) return false;
    if (queue === "unqueued" && queued) return false;
    return true;
  });
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

function readableCampaignError(error, campaignId) {
  const message = error instanceof Error ? error.message : String(error || "广告执行失败");
  if (/status:\s*paused|campaign[^\n]*paused/i.test(message)) {
    return `Campaign ${campaignId} 已暂停，Wayfair 不允许修改其中的 Listing。请先在 Partner Home 恢复该 Campaign，或从批次移除这条动作。`;
  }
  return message;
}

export async function executeCampaignUpdates(campaigns = [], updateCampaign) {
  const outcomes = [];
  for (const campaign of campaigns) {
    try {
      const response = await updateCampaign(campaign);
      outcomes.push({ campaignId: campaign.campaignId, actionIds: campaign.actionIds, ok: true, response });
    } catch (error) {
      outcomes.push({
        campaignId: campaign.campaignId,
        actionIds: campaign.actionIds,
        ok: false,
        error: readableCampaignError(error, campaign.campaignId),
      });
    }
  }
  return outcomes;
}

function resultPayload(value) {
  try { return payload(value); } catch { return {}; }
}

function resultTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date).replaceAll("/", "-");
}

export function executionResultForAction(action = {}) {
  const eventType = action.result_event_type || "";
  const result = resultPayload(action.result_payload);
  const when = resultTime(action.result_at);
  if (eventType === "EXECUTED" || action.status === "EXECUTED") {
    const campaignId = result.campaignId || action.campaign_id || "-";
    return { tone: "success", title: "已写入 Wayfair", detail: `Campaign ${campaignId}${when ? ` · ${when}` : ""}` };
  }
  if (eventType === "FAILED" || action.status === "FAILED") {
    return { tone: "error", title: "未写入", detail: String(result.error || "Wayfair 返回失败；请选择后重新预检") };
  }
  if (eventType === "VALIDATED" || action.status === "VALIDATED") {
    return { tone: "ready", title: "预检通过", detail: when ? `等待执行 · ${when}` : "等待正式执行" };
  }
  if (action.status === "EXECUTING") return { tone: "ready", title: "正在提交", detail: "正在等待 Wayfair 返回" };
  return { tone: "neutral", title: "尚未执行", detail: action.status === "APPROVED" ? "等待预检" : "等待确认并预检" };
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
