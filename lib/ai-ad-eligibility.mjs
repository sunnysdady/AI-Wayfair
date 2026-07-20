export const AI_LAUNCH_ORDER_TARGET = 50;
export const AI_LAUNCH_WINDOW_DAYS = 14;
export const AI_LAUNCH_MIN_COVER_DAYS = 30;

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function evaluateAiAdCandidate(input) {
  const orders14d = Math.max(0, Math.round(Number(input.orders14d || 0)));
  const spend14d = Math.max(0, Number(input.spend14d || 0));
  const wsc14d = Math.max(0, Number(input.wsc14d || 0));
  const orderGap = Math.max(0, AI_LAUNCH_ORDER_TARGET - orders14d);
  const blockers = [];
  if (!input.linkPass) blockers.push("Listing质量或目录状态未通过");
  if (!input.inventoryKnown) blockers.push("库存证据缺失");
  else if (Number(input.coverDays || 0) < AI_LAUNCH_MIN_COVER_DAYS) blockers.push(`库存覆盖不足${AI_LAUNCH_MIN_COVER_DAYS}天`);

  const canLaunch = orders14d >= AI_LAUNCH_ORDER_TARGET && blockers.length === 0;
  const status = blockers.length ? "BLOCKED" : canLaunch ? "ELIGIBLE" : "NOT_READY";
  const marginRate = Math.max(0, Number(input.marginRate || 0));
  const aov = orders14d > 0 ? wsc14d / orders14d : 0;
  const affordableCpa = aov > 0 && marginRate > 0 ? aov * marginRate * 0.7 : 0;
  const preLaunchDailyCap = canLaunch ? round2(affordableCpa * Math.ceil(AI_LAUNCH_ORDER_TARGET / AI_LAUNCH_WINDOW_DAYS)) : 0;
  const targetRoasFloor = Math.ceil(Math.max(3.5, Number(input.breakEvenRoas || 0) * 1.15) * 10) * 10;

  return {
    listing: String(input.listing || ""), status, canLaunch, orders14d, orderGap,
    spend14d: round2(spend14d), wsc14d: round2(wsc14d), wscRoas14d: spend14d > 0 ? round2(wsc14d / spend14d) : 0,
    blockers, preLaunchDailyCap, targetRoasFloor,
    whenToLaunch: canLaunch ? "下一个完整14天周期开始前设置护栏后启用" : blockers.length ? `先解除：${blockers.join("；")}` : `滚动14天达到50个归因订单后再评估，当前还差${orderGap}单`,
    guardrail: canLaunch ? `启用前设置 Daily Cap $${preLaunchDailyCap.toFixed(2)} 与 tROAS 不低于 ${targetRoasFloor}%；学习期内不改 tROAS、Daily Cap 或 Listing。` : "继续使用 Manual Campaign 积累稳定转化；不得为追求学习量无上限烧钱。",
  };
}
