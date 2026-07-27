function daysBetween(start, end) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.floor((endMs - startMs) / 86400000);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function reviewFields({ strategy, asOf, lastChangeDate, cooldownDays, requiresHumanApproval }) {
  return {
    proposalOwner: "广告策略 Agent",
    decisionOwner: requiresHumanApproval ? "广告运营负责人（待确认）" : "广告运营 Agent",
    decisionStatus: requiresHumanApproval ? "PENDING_HUMAN_APPROVAL" : "HOLD",
    hypothesis: strategy.reasons?.[0] || strategy.label,
    singleVariable: true,
    cooldownUntil: lastChangeDate ? addDays(lastChangeDate, cooldownDays) : null,
    reviewDue: requiresHumanApproval ? addDays(asOf, 21) : null,
    rollbackPlan: strategy.actionType === "SET_LISTING_BID"
      ? "若成熟复盘恶化，恢复执行前 Bid"
      : strategy.actionType === "SET_LISTING_ACTIVE"
        ? "修复并复核后，以独立小预算重新测试"
        : "无需回滚",
  };
}

function hold(strategy, label, reason) {
  return {
    ...strategy,
    actionType: "HOLD",
    label,
    proposed: {},
    reasons: [reason, ...(strategy.reasons || [])],
  };
}

const controls = [
  "单一变量：一次只改变一个变量，禁止同时调整 Bid 与预算",
  "人工确认后才进入 API 预检",
  "保存调整前值、建议值和可执行回滚值",
  "执行后至少等待一个归因周期再评价效果",
];

export function applyOperatorDebate({
  strategy,
  liveSafety,
  lastChangeDate,
  asOf,
  cooldownDays = 21,
  eventPhase = "closed",
  hardStop = false,
}) {
  const elapsed = lastChangeDate ? daysBetween(lastChangeDate, asOf) : null;
  const cooling = elapsed !== null && elapsed >= 0 && elapsed < cooldownDays;
  const persistentStop = liveSafety?.status === "CONFIRMED_STOP" || liveSafety?.status === "FORCED_STOP";
  const eventActive = eventPhase !== "closed";

  if (persistentStop && hardStop) {
    return {
      strategy: { ...strategy, proposed: { ...(strategy.proposed || {}) } },
      review: {
        owner: "广告运营 Agent",
        verdict: "CANDIDATE",
        stage: "PERSISTENT_RISK",
        thesis: strategy.label,
        counterpoint: "短期归因仍可能回补；该动作仅因连续窗口和样本门槛同时通过而保留为候选。",
        controls,
        requiresHumanApproval: true,
        ...reviewFields({ strategy, asOf, lastChangeDate, cooldownDays, requiresHumanApproval: true }),
      },
    };
  }

  if (strategy.actionType !== "HOLD" && (cooling || eventActive)) {
    const reason = cooling
      ? `${lastChangeDate} 刚调整，仍在 ${cooldownDays} 天冷却与归因观察期`
      : `当前处于 ${eventPhase} 活动阶段，流量结构和购买时点存在混杂`;
    return {
      strategy: hold(strategy, cooling ? "冷却期内保持，不连续调参" : "活动期仅观察，不做绩效调参", reason),
      review: {
        owner: "广告运营 Agent",
        verdict: "HOLD",
        stage: cooling ? "COOLING_OFF" : "EVENT_FREEZE",
        thesis: strategy.label,
        counterpoint: `${reason}；现在再次修改会混淆上次动作效果。`,
        controls,
        requiresHumanApproval: false,
        ...reviewFields({ strategy, asOf, lastChangeDate, cooldownDays, requiresHumanApproval: false }),
      },
    };
  }

  if (persistentStop) {
    return {
      strategy: { ...strategy, proposed: { ...(strategy.proposed || {}) } },
      review: {
        owner: "广告运营 Agent",
        verdict: "CANDIDATE",
        stage: "PERSISTENT_RISK",
        thesis: strategy.label,
        counterpoint: "短期归因仍可能回补；该动作仅因连续窗口和样本门槛同时通过而保留为候选。",
        controls,
        requiresHumanApproval: true,
        ...reviewFields({ strategy, asOf, lastChangeDate, cooldownDays, requiresHumanApproval: true }),
      },
    };
  }

  if (strategy.actionType === "HOLD") {
    const alert = liveSafety?.status === "ALERT";
    return {
      strategy: { ...strategy, proposed: { ...(strategy.proposed || {}) } },
      review: {
        owner: "广告运营 Agent",
        verdict: "HOLD",
        stage: alert ? "OBSERVE" : "NO_CHANGE",
        thesis: strategy.label,
        counterpoint: alert
          ? "短窗波动可能来自活动流量和归因延迟，先记录异常并继续观察，不用 AI 预警直接改 Bid、预算或状态。"
          : "当前证据不足以证明调整的边际收益高于扰动成本。",
        controls,
        requiresHumanApproval: false,
        ...reviewFields({ strategy, asOf, lastChangeDate, cooldownDays, requiresHumanApproval: false }),
      },
    };
  }

  return {
    strategy: { ...strategy, proposed: { ...(strategy.proposed || {}) } },
    review: {
      owner: "广告运营 Agent",
      verdict: "CANDIDATE",
      stage: "MATURE_EVIDENCE",
      thesis: strategy.label,
      counterpoint: "成熟数据支持方案，但仍需核对活动、库存、链接和近期人工改动，不能只凭单一 ROAS 下结论。",
      controls,
      requiresHumanApproval: true,
      ...reviewFields({ strategy, asOf, lastChangeDate, cooldownDays, requiresHumanApproval: true }),
    },
  };
}
