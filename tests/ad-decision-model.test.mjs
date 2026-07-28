import assert from "node:assert/strict";
import test from "node:test";

import {
  AD_MODEL_METRIC_DEFINITIONS,
  buildAdDecisionModel,
} from "../lib/ad-decision-model.mjs";

const ready = {
  attributionMature: true,
  mappingComplete: true,
  inventoryKnown: true,
  inventoryCoverDays: 90,
  linkPass: true,
  cooldownUntil: null,
};

function unit(overrides = {}) {
  return {
    identity: {
      site: "wayfair.com",
      isB2B: false,
      campaignId: "CAMPAIGN-1",
      targetingType: "PRODUCT",
      listing: "DMOM1021",
      targetId: "listing:DMOM1021",
      ...overrides.identity,
    },
    metrics: {
      clicks: 120,
      spend: 130,
      orders: 8,
      wsc: 1200,
      ...overrides.metrics,
    },
    economics: {
      marginRate: 0.35,
      marginKnown: true,
      mode: "ORDER_ACTUAL",
      ...overrides.economics,
    },
    readiness: { ...ready, ...overrides.readiness },
  };
}

test("emits a transparent shadow decision with complete candidate deltas", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [unit()],
  });

  assert.equal(result.mode, "SHADOW");
  assert.equal(result.version, "EB-CVR-1");
  assert.equal(result.objective, "EXPECTED_INCREMENTAL_CONTRIBUTION_PROFIT");
  assert.equal(result.optimalBudget.status, "UNKNOWN");
  assert.equal(result.optimalBudget.amount, null);
  assert.equal(result.decisions[0].eligibleForExecution, false);
  assert.equal(result.decisions[0].suggestedAction, "SCALE_BUDGET_10");
  assert.ok(result.decisions[0].posterior.cvr < 8 / 120);

  for (const candidate of result.decisions[0].candidates) {
    assert.equal(typeof candidate.expectedDelta.orders, "number");
    assert.equal(typeof candidate.expectedDelta.wsc, "number");
    assert.equal(typeof candidate.expectedDelta.spend, "number");
    assert.equal(typeof candidate.expectedDelta.contributionProfit, "number");
    assert.equal(typeof candidate.expected.wscRoas, "number");
    assert.ok(candidate.probabilityIncrementalContributionPositive >= 0);
    assert.ok(candidate.probabilityIncrementalContributionPositive <= 1);
    assert.ok("incrementalMarketingRoi" in candidate.expected);
  }
});

test("shrinks a tiny apparent winner and refuses to scale it", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      unit({
        identity: { campaignId: "TINY", listing: "TINY-SKU", targetId: "listing:TINY-SKU" },
        metrics: { clicks: 5, spend: 3, orders: 1, wsc: 200 },
      }),
      unit({
        identity: { campaignId: "MATURE", listing: "MATURE-SKU", targetId: "listing:MATURE-SKU" },
      }),
    ],
  });

  const tiny = result.decisions.find((item) => item.identity.campaignId === "TINY");
  const mature = result.decisions.find((item) => item.identity.campaignId === "MATURE");
  assert.ok(tiny.posterior.cvr < 0.2);
  assert.equal(tiny.suggestedAction, "HOLD");
  assert.ok(tiny.blockers.includes("MINIMUM_EVIDENCE"));
  assert.equal(mature.suggestedAction, "SCALE_BUDGET_10");
  assert.ok(mature.confidenceScore > tiny.confidenceScore);
});

test("keeps the decision grain separate across campaigns for the same listing", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      unit({ identity: { campaignId: "PRODUCT-1", targetingType: "PRODUCT" } }),
      unit({ identity: { campaignId: "KEYWORD-1", targetingType: "KEYWORD", targetId: "keyword:core" } }),
    ],
  });

  assert.equal(result.decisions.length, 2);
  assert.equal(new Set(result.decisions.map((item) => item.unitKey)).size, 2);
  assert.ok(result.decisions.every((item) => item.unitKey.includes(item.identity.campaignId)));
});

test("unknown contribution economics blocks optimization instead of inventing ROI", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      unit({
        economics: { marginRate: null, marginKnown: false, mode: "UNKNOWN" },
        readiness: { mappingComplete: false, inventoryKnown: false, inventoryCoverDays: null, linkPass: false },
      }),
    ],
  });

  const decision = result.decisions[0];
  assert.equal(decision.suggestedAction, "HOLD");
  assert.ok(decision.blockers.includes("CONTRIBUTION_ECONOMICS_UNKNOWN"));
  assert.ok(decision.blockers.includes("MAPPING_INCOMPLETE"));
  assert.equal(decision.metrics.incrementalMarketingRoi, null);
  assert.equal(decision.metrics.contributionProfit, null);
});

test("metric names do not mislabel order productivity or contribution proxy as ROI or net profit", () => {
  assert.equal(AD_MODEL_METRIC_DEFINITIONS.wscRoas.label, "成熟 WSC ROAS");
  assert.equal(AD_MODEL_METRIC_DEFINITIONS.ordersPer100Spend.label, "每 $100 广告花费订单数");
  assert.match(AD_MODEL_METRIC_DEFINITIONS.incrementalMarketingRoi.definition, /增量贡献利润.*增量广告/);
  assert.match(AD_MODEL_METRIC_DEFINITIONS.contributionProfit.definition, /贡献代理/);
  assert.doesNotMatch(AD_MODEL_METRIC_DEFINITIONS.contributionProfit.definition, /净利润/);
});

