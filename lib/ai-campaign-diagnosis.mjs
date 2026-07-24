export const AI_LEARNING_DAYS = 14;
export const AI_LEARNING_ORDER_TARGET = 50;

function inclusiveDays(startDate, asOf) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

function isActiveCampaign(input) {
  return /active|true/i.test(`${input.status || ""} ${input.isActive || ""}`)
    && !/inactive|false/i.test(`${input.status || ""} ${input.isActive || ""}`);
}

export function diagnoseAiCampaign(input) {
  if (!/AI Bidding|TROAS/i.test(String(input.strategy || ""))) return null;

  const orders14d = Math.max(0, Math.round(Number(input.orders14d || 0)));
  const daysActive = inclusiveDays(String(input.startDate || ""), String(input.asOf || ""));
  const remainingOrders = Math.max(0, AI_LEARNING_ORDER_TARGET - orders14d);
  const noDailyCap = /NO DAILY CAP/i.test(String(input.dailyCap || ""));
  const reportActive = isActiveCampaign(input);
  const platformLearning = /ACTIVE[_ -]?LEARNING/i.test(String(input.platformStage || ""));
  const statusConflict = platformLearning && !reportActive;
  const active = reportActive || platformLearning;
  const reportedStatus = `${input.status || "UNKNOWN"} / ${input.isActive || "UNKNOWN"}`;
  const sourceFields = {
    statusConflict,
    reportedStatus,
    platformStage: String(input.platformStage || ""),
    platformObservedAt: String(input.platformObservedAt || ""),
    platformSource: String(input.platformSource || ""),
  };

  if (!active) {
    return {
      ...sourceFields,
      stage: "INACTIVE",
      priority: "P2",
      action: "KEEP_INACTIVE",
      daysActive,
      orders14d,
      remainingOrders,
      noDailyCap,
      significantChangesBlocked: true,
      summary: "AI Campaign 当前未启用，不进入学习或自动优化。",
      guardrail: "保持暂停；重新启用前重新核对50个归因订单/14天的学习能力。",
    };
  }

  if (orders14d >= AI_LEARNING_ORDER_TARGET) {
    return {
      ...sourceFields,
      stage: "LEARNED",
      priority: noDailyCap ? "P1" : "P2",
      action: "REVIEW_TARGETS",
      daysActive,
      orders14d,
      remainingOrders,
      noDailyCap,
      significantChangesBlocked: false,
      summary: `最近14天${orders14d}个归因订单，已达到AI学习目标。`,
      guardrail: "可以进入人工复盘；每次只调整 tROAS、Daily Cap 或 Listing 中的一个变量。",
    };
  }

  if (daysActive > AI_LEARNING_DAYS) {
    return {
      ...sourceFields,
      stage: "LEARNING_OVERDUE",
      priority: "P0",
      action: "CONTACT_ACCOUNT_MANAGER",
      daysActive,
      orders14d,
      remainingOrders,
      noDailyCap,
      significantChangesBlocked: true,
      summary: `${statusConflict ? `状态冲突：${input.platformSource || "平台"}显示 Active Learning，但Campaign报表为${reportedStatus}；` : ""}已运行${daysActive}天且最近14天仅${orders14d}/50个归因订单，学习期超过14天。`,
      guardrail: `${statusConflict ? "先核对平台真实状态，不要恢复 Campaign；" : ""}联系 Account Manager；确认前不要修改 tROAS、Daily Cap 或 Listing，紧急止损仅允许人工暂停整个 Campaign。`,
    };
  }

  return {
    ...sourceFields,
    stage: "LEARNING",
    priority: "P1",
    action: "WAIT_FOR_LEARNING",
    daysActive,
    orders14d,
    remainingOrders,
    noDailyCap,
    significantChangesBlocked: true,
    summary: `学习第${daysActive}天，最近14天${orders14d}/50个归因订单。`,
    guardrail: "等待学习完成；不要修改 tROAS、Daily Cap 或 Listing。",
  };
}
