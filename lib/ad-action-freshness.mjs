function parseDay(value) {
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function differs(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) > 0.001;
}

export function validateAdActionFreshness({ action, latest, asOf }) {
  if (!latest) return { ok: false, reason: "缺少最新广告报表，无法确认当前状态" };
  const reportDay = parseDay(latest.reportDate);
  const currentDay = parseDay(asOf);
  if (reportDay === null || currentDay === null || currentDay - reportDay > 2 * 86400000) {
    return { ok: false, reason: `最新广告报表已过期（${latest.reportDate || "日期未知"}）` };
  }
  if (latest.campaignActive === false) {
    return { ok: false, reason: "Campaign 已经暂停，Listing 动作不再适用" };
  }
  if (action.before?.active !== undefined && Boolean(action.before.active) !== Boolean(latest.active)) {
    if (action.actionType === "SET_LISTING_ACTIVE" && action.proposed?.active === false && latest.active === false) {
      return { ok: false, reason: "Listing 已经暂停，无需重复执行" };
    }
    return { ok: false, reason: "Listing 启停状态已变化，请重新生成建议" };
  }
  if (action.actionType === "SET_LISTING_BID" && differs(action.before?.bid, latest.bid)) {
    return { ok: false, reason: "Listing Bid 已变化，请重新生成建议" };
  }
  if (action.actionType === "SET_LISTING_BID" && !differs(action.proposed?.bid, latest.bid)) {
    return { ok: false, reason: "Listing Bid 已是建议值，无需重复执行" };
  }
  if (action.actionType === "SET_LISTING_ACTIVE" && action.proposed?.active === false && latest.active === false) {
    return { ok: false, reason: "Listing 已经暂停，无需重复执行" };
  }
  return { ok: true };
}
