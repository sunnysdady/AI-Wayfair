const LIVE_SPEND_FLOOR = 20;
const LIVE_CLICK_FLOOR = 30;
const STOP_SPEND_FLOOR = 50;

function inactive(value) {
  return /inactive|paused|false/i.test(String(value || ""));
}

function cloneStrategy(strategy) {
  return {
    ...strategy,
    proposed: { ...(strategy.proposed || {}) },
    reasons: [...(strategy.reasons || [])],
    warnings: [...(strategy.warnings || [])],
  };
}

function isScaleAction(strategy, currentBid) {
  if (strategy.actionType === "INCREASE_DAILY_CAP") return true;
  if (strategy.actionType === "SET_LISTING_ACTIVE") return strategy.proposed?.active === true;
  if (strategy.actionType !== "SET_LISTING_BID") return false;
  return Number(strategy.proposed?.bid || 0) > Number(currentBid || 0);
}

export function applyLiveSafety({
  strategy,
  currentBid,
  breakEvenRoas,
  baselineCvr = 0.02,
  recent,
  trailing,
  latestProductStatus,
  latestCampaignStatus,
  forceStop = false,
}) {
  const base = cloneStrategy(strategy);
  const alreadyInactive = inactive(latestProductStatus) || inactive(latestCampaignStatus);
  const recentWinner = Number(trailing?.orders || 0) > 0
    && Number(trailing?.wscRoas || 0) >= Number(breakEvenRoas || 0);
  const alert = Number(recent?.spend || 0) >= LIVE_SPEND_FLOOR
    && Number(recent?.clicks || 0) >= LIVE_CLICK_FLOOR
    && Number(recent?.orders || 0) === 0;
  const expectedCvr = Math.max(0.01, Math.min(0.1, Number(baselineCvr || 0.02)));
  const requiredClicks = Math.ceil(Math.log(0.05) / Math.log(1 - expectedCvr));
  const confirmedStop = alert
    && Number(trailing?.spend || 0) >= STOP_SPEND_FLOOR
    && Number(trailing?.clicks || 0) >= requiredClicks
    && Number(trailing?.orders || 0) === 0;

  const liveSafety = {
    status: alreadyInactive ? "INACTIVE" : confirmedStop ? "CONFIRMED_STOP" : recentWinner ? "RECENT_WINNER" : alert ? "ALERT" : "WATCH",
    recent: { ...(recent || {}) },
    trailing: { ...(trailing || {}) },
    thresholds: { spend: LIVE_SPEND_FLOOR, clicks: LIVE_CLICK_FLOOR, stopSpend: STOP_SPEND_FLOOR },
    baselineCvr: expectedCvr,
    requiredClicks,
  };

  if (base.actionType === "SET_LISTING_ACTIVE" && base.proposed?.active === false && alreadyInactive) {
    return {
      strategy: {
        ...base,
        actionType: "HOLD",
        label: "最新状态已经暂停，无需重复暂停",
        proposed: {},
        reasons: ["最新广告报表显示 Listing 或 Campaign 已停止", ...base.reasons],
      },
      liveSafety,
    };
  }

  if (forceStop) return { strategy: base, liveSafety: { ...liveSafety, status: "FORCED_STOP" } };

  if (confirmedStop && !alreadyInactive) {
    return {
      strategy: {
        ...base,
        actionType: "SET_LISTING_ACTIVE",
        label: "持续止损：暂停 Listing",
        proposed: { active: false },
        reasons: [
          `最近7个完整日已花费$${Number(trailing.spend).toFixed(2)}、${Number(trailing.clicks)}点击、0单`,
          `按成熟基线CVR ${(expectedCvr * 100).toFixed(2)}%计算，${requiredClicks}次零转化点击达到95%异常证据门槛`,
          "连续窗口只允许生成暂停候选，不会调整 Bid 或预算",
          ...base.reasons,
        ],
      },
      liveSafety,
    };
  }

  if (base.actionType === "SET_LISTING_ACTIVE" && base.proposed?.active === false && recentWinner) {
    return {
      strategy: {
        ...base,
        actionType: "HOLD",
        label: "近期已出单，等待归因成熟",
        proposed: {},
        reasons: [
          `最近7个完整日已有${Number(trailing.orders)}单，WSC ROAS ${Number(trailing.wscRoas).toFixed(2)}×`,
          ...base.reasons,
        ],
      },
      liveSafety,
    };
  }

  if (isScaleAction(base, currentBid) && !recentWinner) {
    return {
      strategy: {
        ...base,
        actionType: "HOLD",
        label: alert ? "实时预警，冻结扩量" : "实时安全窗未确认，禁止扩量",
        proposed: {},
        reasons: [
          alert
            ? `最近4个完整日已花费$${Number(recent.spend).toFixed(2)}、${Number(recent.clicks)}点击、0单，仅作为预警`
            : "最近7个完整日尚未达到保本线，成熟窗口的扩量动作暂缓",
          ...base.reasons,
        ],
      },
      liveSafety,
    };
  }

  if (alert && base.actionType === "HOLD") {
    return {
      strategy: {
        ...base,
        label: "实时预警：保持并继续观察",
        reasons: [
          `实时安全窗已花费$${Number(recent.spend).toFixed(2)}、${Number(recent.clicks)}点击、0单`,
          `尚未满足7日持续异常与${requiredClicks}次零转化点击门槛，不调整 Bid、预算或状态`,
          ...base.reasons,
        ],
      },
      liveSafety,
    };
  }

  return { strategy: base, liveSafety };
}
