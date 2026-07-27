const DAY_MS = 86400000;

export const OPERATING_EVENTS = Object.freeze([
  Object.freeze({
    id: "bfij-2026",
    name: "Black Friday in July",
    kind: "PEAK",
    start: "2026-07-23",
    end: "2026-07-28",
    attributionDays: 14,
    source: "Wayfair BFIJ activity notice and supplier email",
  }),
  Object.freeze({
    id: "q3-extended-discounts-2026",
    name: "Q3 Extended Discounts",
    kind: "ALWAYS_ON",
    start: "2026-07-28",
    end: "2026-11-19",
    attributionDays: 0,
    source: "Wayfair Cost Update email received 2026-07-23",
  }),
]);

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysUntil(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
}

function publicEvent(event) {
  return {
    id: event.id,
    name: event.name,
    kind: event.kind,
    start: event.start,
    end: event.end,
    source: event.source,
  };
}

export function eventCycleForDate(asOf, events = OPERATING_EVENTS) {
  const activeEvents = events.filter((event) => asOf >= event.start && asOf <= event.end);
  const endedEvents = events.filter((event) => {
    if (event.kind !== "PEAK" || !event.attributionDays || asOf <= event.end) return false;
    return asOf <= addDays(event.end, event.attributionDays);
  });
  const upcomingEvents = events.filter((event) => {
    const leadDays = daysUntil(asOf, event.start);
    return leadDays > 0 && leadDays <= 7;
  });
  const activePeak = activeEvents.some((event) => event.kind === "PEAK");
  const activeAlwaysOn = activeEvents.some((event) => event.kind === "ALWAYS_ON");
  let mode = "NORMAL";
  let strategyNote = "当前没有已确认的平台活动窗口，按常规成熟数据、利润、库存和链接质量执行。";

  if (activePeak) {
    mode = "ACTIVE_PEAK";
    strategyNote = "活动仍在进行：只对通过利润、库存和承接 Gate 的成熟赢家增加 Cap，不因单日峰值提高 Bid。";
  } else if (endedEvents.length && activeAlwaysOn) {
    mode = "POST_PEAK_TRANSITION";
    strategyNote = "峰值活动结束，但长周期折扣仍在；先把峰值回落视为活动结构切换，在14天归因成熟前不据此追量或误判广告失效。";
  } else if (endedEvents.length) {
    mode = "POST_EVENT_ATTRIBUTION";
    strategyNote = "峰值活动已结束并处于14天归因期；先恢复活动前基准，再判断真实趋势。";
  } else if (activeAlwaysOn) {
    mode = "ALWAYS_ON_PROMOTION";
    strategyNote = "长周期折扣仍在运行；策略应与无活动基准比较，不使用BFIJ峰值作为日常目标。";
  } else if (upcomingEvents.length) {
    mode = "PRE_EVENT";
    strategyNote = "活动将在7天内开始；先锁定价格、库存、利润和链接，不提前追高 Bid。";
  }

  const attributionMaturesOn = endedEvents.length
    ? endedEvents.map((event) => addDays(event.end, event.attributionDays)).sort().at(-1)
    : null;

  return {
    asOf,
    mode,
    activeEvents: activeEvents.map(publicEvent),
    endedEvents: endedEvents.map(publicEvent),
    upcomingEvents: upcomingEvents.map(publicEvent),
    attributionMaturesOn,
    strategyNote,
    volatilityRule: "先比较活动前、活动中、活动后同口径日均；活动结束只作为解释候选，不单独证明因果。",
  };
}

export function assessEventRelatedVolatility({ asOf, baselineValue, currentValue }) {
  const baseline = Number(baselineValue);
  const current = Number(currentValue);
  const context = eventCycleForDate(asOf);
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(current)) {
    return {
      changeRate: null,
      classification: "INSUFFICIENT_DATA",
      confidence: "LOW",
      explanation: "缺少同口径活动前基线或当前值，不能判断波动是否与活动周期有关。",
      context,
    };
  }

  const changeRate = Number((current / baseline - 1).toFixed(4));
  const inPostEventWindow = ["POST_PEAK_TRANSITION", "POST_EVENT_ATTRIBUTION"].includes(context.mode);
  if (inPostEventWindow && changeRate <= -0.1) {
    return {
      changeRate,
      classification: "EVENT_END_POSSIBLE",
      confidence: "MEDIUM",
      explanation: "下降发生在峰值活动结束后的归因窗口，活动回落是合理候选，但不能单独证明因果；仍需核对流量、CVR、价格、库存与广告变化。",
      context,
    };
  }
  return {
    changeRate,
    classification: "EVENT_END_NOT_PRIMARY",
    confidence: "LOW",
    explanation: "当前时间或变动幅度不满足活动结束解释条件，应优先检查流量、转化、价格、库存和广告结构。",
    context,
  };
}

export function effectiveStackedDiscount(baseDiscount, incrementalDiscount) {
  const base = Math.min(1, Math.max(0, Number(baseDiscount) || 0));
  const incremental = Math.min(1, Math.max(0, Number(incrementalDiscount) || 0));
  return Number((1 - (1 - base) * (1 - incremental)).toFixed(4));
}
