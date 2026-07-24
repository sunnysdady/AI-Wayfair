function daysBetween(start, end) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

export function evaluateAdjustment({ action, baseline, observed, executedDate, matureThrough, breakEvenRoas = 0 }) {
  const matureDays = daysBetween(executedDate, matureThrough);
  if (matureDays < 7) return { verdict: "PENDING", matureDays, summary: `归因数据尚未成熟，还需 ${7 - matureDays} 天` };
  if ((observed?.clicks || 0) < 10 && (observed?.orders || 0) < 2) {
    return { verdict: "INCONCLUSIVE", matureDays, summary: "成熟样本仍不足，保留当前值，不连续调整" };
  }
  const orderDelta = (observed.orders || 0) - (baseline.orders || 0);
  const revenueDelta = (observed.wsc || 0) - (baseline.wsc || 0);
  const roasDelta = (observed.wscRoas || 0) - (baseline.wscRoas || 0);
  const harmful = (observed.wscRoas || 0) < breakEvenRoas && (baseline.wscRoas || 0) >= breakEvenRoas
    || (baseline.orders || 0) > 0 && orderDelta / baseline.orders <= -0.4 && revenueDelta < 0;
  const effective = !harmful && (roasDelta >= Math.max(.2, (baseline.wscRoas || 0) * .1)
    || ((observed.wscRoas || 0) >= breakEvenRoas && (observed.orders || 0) >= (baseline.orders || 0)));
  const verdict = harmful ? "HARMFUL" : effective ? "EFFECTIVE" : "NEUTRAL";
  const labels = { HARMFUL: "调整后销售或盈利恶化，下周停止同向调整", EFFECTIVE: "调整有效，可在销售护栏内继续分阶段优化", NEUTRAL: "结果无显著改善，本周保持并继续观察" };
  return { verdict, matureDays, orderDelta, revenueDelta: Number(revenueDelta.toFixed(2)), roasDelta: Number(roasDelta.toFixed(2)), summary: labels[verdict], actionType: action.action_type };
}

export function reviewGuardrail(review) {
  if (!review) return null;
  if (["PENDING", "INCONCLUSIVE"].includes(review.verdict)) return { hold: true, reason: review.summary };
  if (review.verdict === "HARMFUL") return { hold: true, reason: review.summary };
  return { hold: false, reason: review.summary };
}
