const MODEL_VERSION = "EB-O100-1";
const PRIOR_SPEND_STRENGTH = 200;
const PRIOR_ORDER_VALUE_STRENGTH = 5;
const PORTFOLIO_BASE_SPEND = 200;
const PORTFOLIO_BASE_ORDER_RATE = 0.03;
const MINIMUM_CLICKS = 30;
const MINIMUM_ORDERS = 2;

export const AD_MODEL_METRIC_DEFINITIONS = Object.freeze({
  wscRoas: {
    label: "成熟 WSC ROAS",
    definition: "成熟归因窗口 WSC 销售额 ÷ 广告花费。",
  },
  ordersPer100Spend: {
    label: "每 $100 广告花费订单数",
    definition: "成熟归因订单数 ÷ 广告花费 × 100；这是订单获取效率，不是 ROI。",
  },
  incrementalMarketingRoi: {
    label: "增量营销 ROI",
    definition: "模型预期增量贡献利润 ÷ 增量广告与促销投入；只对新增投入计算。",
  },
  contributionProfit: {
    label: "广告后贡献利润",
    definition: "WSC × 已验证贡献率 − 广告花费；这是贡献代理，未覆盖退货、物流与扣款。",
  },
});

export function normalizeAdAudience(row = {}) {
  const raw = row.isB2B ?? row.isB2b;
  if (raw === true || String(raw).toLowerCase() === "true") {
    return { known: true, isB2B: true, key: "B2B" };
  }
  if (raw === false || String(raw).toLowerCase() === "false") {
    return { known: true, isB2B: false, key: "B2C" };
  }
  return { known: false, isB2B: false, key: "" };
}

const ACTIONS = Object.freeze([
  { action: "HOLD", spendMultiplier: 1, orderRateMultiplier: 1 },
  { action: "REDUCE_BID_10", spendMultiplier: 0.9, orderRateMultiplier: 1 },
  { action: "CANARY_BUDGET_10", spendMultiplier: 1.1, orderRateMultiplier: 0.99 },
  { action: "PAUSE", spendMultiplier: 0, orderRateMultiplier: 1 },
]);

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 4) {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function hasCompleteMetrics(metrics) {
  return ["clicks", "spend", "orders", "wsc"].every((key) => (
    metrics?.[key] !== null
    && metrics?.[key] !== undefined
    && metrics?.[key] !== ""
    && Number.isFinite(Number(metrics[key]))
  ));
}

function identityKey(identity) {
  return [
    identity.site || "UNKNOWN_SITE",
    identity.currency || "UNKNOWN_CURRENCY",
    identity.isB2B ? "B2B" : "B2C",
    identity.campaignId || "UNKNOWN_CAMPAIGN",
    identity.targetingType || "UNKNOWN_TARGETING",
    identity.listing || "UNKNOWN_LISTING",
  ].join("::");
}

function priorGroupKey(identity) {
  return [
    identity.site || "UNKNOWN_SITE",
    identity.currency || "UNKNOWN_CURRENCY",
    identity.isB2B ? "B2B" : "B2C",
    identity.targetingType || "UNKNOWN_TARGETING",
  ].join("::");
}

function portfolioPrior(units) {
  const totals = units.filter((unit) => hasCompleteMetrics(unit.metrics)).reduce((result, unit) => {
    result.clicks += Math.max(0, finite(unit.metrics?.clicks));
    result.spend += Math.max(0, finite(unit.metrics?.spend));
    result.orders += Math.max(0, finite(unit.metrics?.orders));
    result.wsc += Math.max(0, finite(unit.metrics?.wsc));
    return result;
  }, { clicks: 0, spend: 0, orders: 0, wsc: 0 });

  return {
    ordersPerDollar: clamp(
      (totals.orders + PORTFOLIO_BASE_ORDER_RATE * PORTFOLIO_BASE_SPEND)
        / (totals.spend + PORTFOLIO_BASE_SPEND),
      0.001,
      1,
    ),
    wscPerOrder: totals.orders > 0 ? totals.wsc / totals.orders : 150,
    spendStrength: PRIOR_SPEND_STRENGTH,
    orderValueStrength: PRIOR_ORDER_VALUE_STRENGTH,
    source: totals.spend > 0 ? "CURRENT_PORTFOLIO" : "CONSERVATIVE_FALLBACK",
  };
}

function readinessBlockers(unit, asOf) {
  const blockers = [];
  const metrics = unit.metrics || {};
  const economics = unit.economics || {};
  const readiness = unit.readiness || {};
  const identity = unit.identity || {};

  if (!hasCompleteMetrics(metrics)) blockers.push("METRICS_INCOMPLETE");
  if (readiness.identityComplete === false || (
    !identity.site
    || !identity.currency
    || !identity.campaignId
    || !identity.targetingType
    || !identity.listing
  )) blockers.push("IDENTITY_INCOMPLETE");
  if (!readiness.attributionMature) blockers.push("ATTRIBUTION_IMMATURE");
  if (!readiness.mappingComplete) blockers.push("MAPPING_INCOMPLETE");
  if (readiness.mappingVerified !== true) blockers.push("MAPPING_SCOPE_UNVERIFIED");
  if (!economics.marginKnown || !Number.isFinite(Number(economics.marginRate))) {
    blockers.push("CONTRIBUTION_ECONOMICS_UNKNOWN");
  }
  if (!readiness.inventoryKnown) blockers.push("INVENTORY_UNKNOWN");
  else if (finite(readiness.inventoryCoverDays) < 28) blockers.push("INVENTORY_COVER_LOW");
  else if (readiness.inventoryFresh !== true) blockers.push("INVENTORY_STALE");
  if (!readiness.linkPass) blockers.push("LISTING_QUALITY_UNSAFE");
  if (readiness.linkEvidenceVerified !== true) blockers.push("LISTING_OPERATIONAL_EVIDENCE_UNVERIFIED");
  if (
    Math.max(0, finite(metrics.clicks)) < MINIMUM_CLICKS
    || Math.max(0, finite(metrics.orders)) < MINIMUM_ORDERS
  ) {
    blockers.push("MINIMUM_EVIDENCE");
  }
  if (readiness.cooldownUntil && String(readiness.cooldownUntil) >= asOf) blockers.push("COOLDOWN_ACTIVE");
  if (/AI Bidding|TROAS/i.test(String(readiness.platformStrategy || ""))) {
    blockers.push("AI_TROAS_LISTING_ACTION_UNSUPPORTED");
  }

  return [...new Set(blockers)];
}

function candidateFor(action, context) {
  if (!context.metricsComplete) {
    return {
      action: action.action,
      assumptions: {
        spendMultiplier: action.spendMultiplier,
        orderRateMultiplier: action.orderRateMultiplier,
        elasticitySource: "UNVALIDATED_SCENARIO_ASSUMPTION",
      },
      attributedScenario: {
        orders: null,
        wsc: null,
        spend: null,
        contributionProxy: null,
        wscRoas: null,
      },
      attributedScenarioDelta: {
        orders: null,
        wsc: null,
        spend: null,
        contributionProxy: null,
      },
      expected: {
        orders: null,
        wsc: null,
        spend: null,
        contributionProfit: null,
        wscRoas: null,
        incrementalMarketingRoi: null,
      },
      expectedDelta: {
        orders: null,
        wsc: null,
        spend: null,
        contributionProfit: null,
      },
      probabilityIncrementalContributionPositive: null,
      causalStatus: "NOT_ESTIMABLE_C0",
    };
  }
  const expectedSpend = context.spend * action.spendMultiplier;
  const expectedOrders = expectedSpend * context.posteriorOrdersPerDollar * action.orderRateMultiplier;
  const expectedWsc = expectedOrders * context.posteriorWscPerOrder;
  const expectedContribution = context.marginKnown
    ? expectedWsc * context.marginRate - expectedSpend
    : null;
  const deltaSpend = expectedSpend - context.baseline.spend;
  const deltaOrders = expectedOrders - context.baseline.orders;
  const deltaWsc = expectedWsc - context.baseline.wsc;
  const deltaContribution = expectedContribution === null
    ? null
    : expectedContribution - context.baseline.contribution;
  return {
    action: action.action,
    assumptions: {
      spendMultiplier: action.spendMultiplier,
      orderRateMultiplier: action.orderRateMultiplier,
      elasticitySource: "UNVALIDATED_SCENARIO_ASSUMPTION",
    },
    attributedScenario: {
      orders: round(expectedOrders),
      wsc: round(expectedWsc, 2),
      spend: round(expectedSpend, 2),
      contributionProxy: round(expectedContribution, 2),
      wscRoas: round(expectedSpend > 0 ? expectedWsc / expectedSpend : 0, 2),
    },
    attributedScenarioDelta: {
      orders: round(deltaOrders),
      wsc: round(deltaWsc, 2),
      spend: round(deltaSpend, 2),
      contributionProxy: round(deltaContribution, 2),
    },
    expected: {
      orders: null,
      wsc: null,
      spend: null,
      contributionProfit: null,
      wscRoas: null,
      incrementalMarketingRoi: null,
    },
    expectedDelta: {
      orders: null,
      wsc: null,
      spend: null,
      contributionProfit: null,
    },
    probabilityIncrementalContributionPositive: null,
    causalStatus: "NOT_ESTIMABLE_C0",
  };
}

function decisionFor(unit, prior, asOf) {
  const metricsComplete = hasCompleteMetrics(unit.metrics);
  const clicks = Math.max(0, finite(unit.metrics?.clicks));
  const spend = Math.max(0, finite(unit.metrics?.spend));
  const orders = Math.max(0, finite(unit.metrics?.orders));
  const wsc = Math.max(0, finite(unit.metrics?.wsc));
  const posteriorAlpha = orders + prior.ordersPerDollar * prior.spendStrength;
  const posteriorBeta = spend + prior.spendStrength;
  const posteriorOrdersPerDollar = posteriorAlpha / posteriorBeta;
  const posteriorOrderRateVariance = posteriorAlpha / (posteriorBeta ** 2);
  const posteriorWscPerOrder = (
    wsc + prior.wscPerOrder * prior.orderValueStrength
  ) / (orders + prior.orderValueStrength);
  const marginKnown = Boolean(
    unit.economics?.marginKnown
    && Number.isFinite(Number(unit.economics?.marginRate)),
  );
  const marginRate = marginKnown ? clamp(finite(unit.economics.marginRate), 0, 1) : null;
  const baselineOrders = spend * posteriorOrdersPerDollar;
  const baselineWsc = baselineOrders * posteriorWscPerOrder;
  const baselineContribution = marginKnown ? baselineWsc * marginRate - spend : null;
  const context = {
    metricsComplete,
    clicks,
    spend,
    posteriorOrdersPerDollar,
    posteriorWscPerOrder,
    marginKnown,
    marginRate,
    baseline: {
      clicks,
      spend,
      orders: baselineOrders,
      wsc: baselineWsc,
      contribution: baselineContribution,
    },
  };
  const blockers = readinessBlockers(unit, asOf);
  const candidates = ACTIONS.map((action) => candidateFor(action, context));
  const canary = candidates.find((candidate) => candidate.action === "CANARY_BUDGET_10");
  let suggestedAction = "HOLD";

  if (!blockers.length) {
    if (
      canary.attributedScenarioDelta.contributionProxy > 0
    ) {
      suggestedAction = canary.action;
    }
  }

  const evidenceScore = Math.min(1, clicks / 120) * 0.6 + Math.min(1, orders / 8) * 0.4;
  const posteriorStandardDeviation = Math.sqrt(posteriorOrderRateVariance);
  return {
    unitKey: identityKey(unit.identity || {}),
    identity: { ...unit.identity },
    mode: "SHADOW",
    eligibleForExecution: false,
    suggestedAction,
    blockers,
    confidenceScore: round(evidenceScore * (blockers.length ? 0.5 : 1), 4),
    confidence: {
      data: unit.readiness?.attributionMature && unit.readiness?.mappingComplete ? "D2" : "D0",
      predictive: clicks >= 120 && orders >= 8 ? "P2" : clicks >= MINIMUM_CLICKS ? "P1" : "P0",
      causal: "C0",
      explanation: "当前只有平台归因观察数据，没有随机或准实验对照；只能生成 Shadow Canary，不能声明增量因果或正式 Scale。",
    },
    posterior: {
      ordersPerDollar: round(posteriorOrdersPerDollar, 6),
      ordersPer100Spend: round(posteriorOrdersPerDollar * 100, 4),
      ordersPer100SpendInterval80: [
        round(clamp(posteriorOrdersPerDollar - 1.2816 * posteriorStandardDeviation, 0, 1) * 100, 4),
        round(clamp(posteriorOrdersPerDollar + 1.2816 * posteriorStandardDeviation, 0, 1) * 100, 4),
      ],
      wscPerOrder: round(posteriorWscPerOrder, 2),
      priorOrdersPer100Spend: round(prior.ordersPerDollar * 100, 4),
      priorStrengthSpend: prior.spendStrength,
    },
    metrics: {
      wscRoas: metricsComplete ? round(spend > 0 ? wsc / spend : 0, 2) : null,
      ordersPer100Spend: metricsComplete ? round(spend > 0 ? orders / spend * 100 : 0, 2) : null,
      contributionProfit: round(
        metricsComplete && marginKnown ? wsc * marginRate - spend : null,
        2,
      ),
      incrementalMarketingRoi: null,
    },
    candidates,
  };
}

export function buildAdDecisionModel({ asOf, units }) {
  if (!Array.isArray(units)) throw new TypeError("units must be an array");
  const effectiveAsOf = String(asOf || "");
  const groups = new Map();
  for (const unit of units) {
    const key = priorGroupKey(unit.identity || {});
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(unit);
  }
  const priors = new Map(
    [...groups].map(([key, members]) => [key, portfolioPrior(members)]),
  );
  const decisions = units.map((unit) => {
    const peers = groups.get(priorGroupKey(unit.identity || {})).filter((peer) => (
      String(peer.identity?.listing || "") !== String(unit.identity?.listing || "")
    ));
    return decisionFor(unit, portfolioPrior(peers), effectiveAsOf);
  });

  return {
    version: MODEL_VERSION,
    mode: "SHADOW",
    objective: "LEARN_INCREMENTAL_CONTRIBUTION_RESPONSE",
    longTermObjective: "MAXIMIZE_EXPECTED_INCREMENTAL_CONTRIBUTION_PROFIT",
    generatedFor: effectiveAsOf,
    grain: "mature_7d_window × site × currency × isB2B × campaign × targetingType × listing",
    prior: {
      grouping: "site × currency × isB2B × targetingType",
      unitPriorScope: "LEAVE_ONE_LISTING_OUT",
      groups: [...priors].map(([key, prior]) => ({
        key,
        source: prior.source,
        ordersPer100Spend: round(prior.ordersPerDollar * 100, 4),
        spendStrength: prior.spendStrength,
        wscPerOrder: round(prior.wscPerOrder, 2),
      })),
    },
    optimalBudget: {
      status: "UNKNOWN",
      amount: null,
      reason: "尚无足够的随机或准实验干预历史来估计边际响应曲线。",
    },
    metricDefinitions: AD_MODEL_METRIC_DEFINITIONS,
    summary: {
      units: decisions.length,
      actionableInShadow: decisions.filter((decision) => decision.suggestedAction !== "HOLD").length,
      blocked: decisions.filter((decision) => decision.blockers.length > 0).length,
    },
    decisions,
  };
}
