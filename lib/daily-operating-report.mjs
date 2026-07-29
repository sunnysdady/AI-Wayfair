const MANUAL_AD_TASK_TOTAL = 10;
const TERMINAL_STATUSES = new Set(["VERIFIED", "CLOSED"]);
const ACTIVE_STATUSES = new Set([
  "EXECUTING",
  "PENDING_ACCEPTANCE",
  "PENDING_REVIEW",
  "REOPENED",
]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  return Number(number(value).toFixed(digits));
}

export function shanghaiDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function shanghaiHour(value = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(value));
}

export function dailyOperatingReportDue({
  now = new Date(),
  existingReportDate = null,
} = {}) {
  const reportDate = shanghaiDate(now);
  return shanghaiHour(now) >= 20 && existingReportDate !== reportDate;
}

function operationDate(operation) {
  const timestamp = operation?.updatedAt || operation?.closedAt || "";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? "" : shanghaiDate(parsed);
}

function uniqueTitles(operations) {
  return [...new Set(operations.map((item) => String(item?.title || "").trim()).filter(Boolean))];
}

export function buildDailyOperatingReport({
  now = new Date(),
  dailyOrders = {},
  monthOrders = {},
  dailyAds = {},
  manualCompletions = {},
  operations = {},
  planProgress = {},
  readiness = {},
  previousReport = null,
} = {}) {
  const reportDate = shanghaiDate(now);
  const dailyCurrent = dailyOrders.current || {};
  const dailyPrevious = dailyOrders.previous || {};
  const monthCurrent = monthOrders.current || {};
  const adsCurrent = dailyAds.current || {};
  const adsPrevious = dailyAds.previous || {};
  const operationRecords = Array.isArray(operations.records) ? operations.records : [];
  const todayOperations = operationRecords.filter((item) => operationDate(item) === reportDate);
  const completed = todayOperations.filter((item) => TERMINAL_STATUSES.has(String(item.status || "").toUpperCase()));
  const inProgress = operationRecords.filter((item) => ACTIVE_STATUSES.has(String(item.status || "").toUpperCase()));
  const failed = todayOperations.filter((item) => String(item.status || "").toUpperCase() === "FAILED");
  const manualRecords = Array.isArray(manualCompletions.records) ? manualCompletions.records : [];
  const verifiedManual = manualRecords.filter((item) => item.status === "VERIFIED").length;
  const modelTodoCount = Array.isArray(dailyAds.modelTodo) ? dailyAds.modelTodo.length : 0;
  const previousModelTodoCount = number(previousReport?.aiOptimization?.modelTodoCount);
  const zombieFindings = Array.isArray(dailyAds.zombieFindings) ? dailyAds.zombieFindings : [];
  const policy = planProgress?.nextPlan?.executionPolicy || {};
  const targetMonth = reportDate.slice(0, 7);
  const orderTarget = targetMonth === "2026-08"
    ? number(policy.stretchOrderTarget) || 150
    : number(planProgress?.plan?.orderTarget) || number(policy.stretchOrderTarget) || 150;
  const contributionFloor = targetMonth === "2026-08"
    ? number(policy.monthlyContributionFloor)
      || number(dailyAds?.decisionModel?.riskPolicy?.monthlyContributionFloor)
    : 0;
  const monthOrdersCount = number(monthCurrent.orders);
  const monthContribution = monthCurrent.contributionAfterAds == null
    ? null
    : round(monthCurrent.contributionAfterAds);
  const approvalOperations = operationRecords.filter((item) => (
    item?.intendedAfterState?.requiresUserApproval === true
    || item?.intendedAfterState?.approvalScope === "RULE_EXCEPTION"
  ));
  const adsRefreshFallback = String(dailyAds.refreshFallback || "").trim();
  const risks = [
    ...(adsRefreshFallback
      ? [`广告实时刷新失败，已使用服务器快照：${adsRefreshFallback}`]
      : []),
    ...zombieFindings.map((item) => (
      `Campaign ${item.campaignId || "未知"} · ${item.actionType || "待诊断"} · ${item.severity || "P1"}`
    )),
    ...failed.map((item) => `执行失败 · ${item.title || item.operationId || "未知任务"}`),
  ];
  const tomorrow = [
    ...uniqueTitles(inProgress).slice(0, 5).map((title) => `继续推进：${title}`),
    ...zombieFindings.slice(0, 3).map((item) => `复核 Campaign ${item.campaignId || "未知"} 的 ${item.actionType || "投放异常"}`),
  ];
  if (!tomorrow.length) tomorrow.push("继续监控订单、广告效率、任务闭环和利润护栏");

  return {
    version: "daily-operating-report-v1",
    reportDate,
    generatedAt: now.toISOString(),
    source: "DigitalOcean server scheduler",
    performance: {
      daily: {
        orders: number(dailyCurrent.orders),
        units: number(dailyCurrent.units),
        revenue: round(dailyCurrent.revenue),
        adSpend: round(adsCurrent.spend),
        retailRoas: round(adsCurrent.retailRoas),
        wscRoas: round(adsCurrent.wscRoas),
        contributionAfterAds: dailyCurrent.contributionAfterAds == null
          ? null
          : round(dailyCurrent.contributionAfterAds),
      },
      delta: {
        orders: number(dailyCurrent.orders) - number(dailyPrevious.orders),
        units: number(dailyCurrent.units) - number(dailyPrevious.units),
        revenue: round(number(dailyCurrent.revenue) - number(dailyPrevious.revenue)),
        adSpend: round(number(adsCurrent.spend) - number(adsPrevious.spend)),
        retailRoas: round(number(adsCurrent.retailRoas) - number(adsPrevious.retailRoas)),
        wscRoas: round(number(adsCurrent.wscRoas) - number(adsPrevious.wscRoas)),
      },
      month: {
        orders: monthOrdersCount,
        units: number(monthCurrent.units),
        revenue: round(monthCurrent.revenue),
        contributionAfterAds: monthContribution,
      },
    },
    work: {
      completed: uniqueTitles(completed),
      inProgress: uniqueTitles(inProgress),
      failed: uniqueTitles(failed),
    },
    aiOptimization: {
      modelTodoCount,
      modelTodoDelta: previousReport ? modelTodoCount - previousModelTodoCount : null,
      zombieFindingCount: zombieFindings.length,
      attributionMature: Boolean(dailyAds?.range?.mature),
      note: "创建/执行任务与投放健康诊断分开记账；Inactive、Archived Campaign 不重复生成优化任务。",
    },
    todo: {
      totalManual: MANUAL_AD_TASK_TOTAL,
      verifiedManual,
      remainingManual: Math.max(0, MANUAL_AD_TASK_TOTAL - verifiedManual),
      activeOperations: inProgress.length,
      failedToday: failed.length,
    },
    target: {
      metric: "ORDERS",
      targetMonth,
      orderTarget,
      monthOrders: monthOrdersCount,
      ordersToTarget: Math.max(0, orderTarget - monthOrdersCount),
      completionRate: orderTarget ? round(monthOrdersCount / orderTarget, 4) : 0,
      monthlyContributionFloor: contributionFloor || null,
      monthContributionAfterAds: monthContribution,
      contributionGap: contributionFloor && monthContribution != null
        ? round(monthContribution - contributionFloor)
        : null,
    },
    risks,
    approvals: uniqueTitles(approvalOperations),
    tomorrow,
    dataQuality: {
      adsFresh: !adsRefreshFallback,
      adsLayer: String(dailyAds?.cache?.layer || "UNKNOWN"),
      adsRefreshFallback: adsRefreshFallback || null,
      orderSyncStale: Boolean(dailyOrders?.sync?.stale || monthOrders?.sync?.stale),
    },
    system: {
      execution: "SERVER_SILENT",
      environmentVerified: Boolean(readiness?.environment?.verified),
      healthyScopes: number(readiness?.scopeHealth?.summary?.healthy),
      failedScopes: number(readiness?.scopeHealth?.summary?.failed),
      browserDependency: false,
      codexDependency: false,
    },
  };
}
