import assert from "node:assert/strict";
import test from "node:test";

import {
  AD_MODEL_METRIC_DEFINITIONS,
  buildAdDecisionModel,
  normalizeAdAudience,
} from "../lib/ad-decision-model.mjs";

const ready = {
  attributionMature: true,
  mappingComplete: true,
  inventoryKnown: true,
  inventoryCoverDays: 90,
  inventoryFresh: true,
  linkPass: true,
  linkEvidenceVerified: true,
  mappingVerified: true,
  cooldownUntil: null,
};

function unit(overrides = {}) {
  return {
    identity: {
      site: "wayfair.com",
      currency: "USD",
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
  assert.equal(result.version, "EB-O100-1");
  assert.equal(result.objective, "LEARN_INCREMENTAL_CONTRIBUTION_RESPONSE");
  assert.equal(result.longTermObjective, "MAXIMIZE_EXPECTED_INCREMENTAL_CONTRIBUTION_PROFIT");
  assert.equal(result.optimalBudget.status, "UNKNOWN");
  assert.equal(result.optimalBudget.amount, null);
  assert.equal(result.decisions[0].eligibleForExecution, false);
  assert.equal(result.decisions[0].suggestedAction, "CANARY_BUDGET_10");
  assert.equal(result.decisions[0].confidence.causal, "C0");
  assert.ok(result.decisions[0].posterior.ordersPer100Spend < 100 * 8 / 130);

  for (const candidate of result.decisions[0].candidates) {
    assert.equal(typeof candidate.attributedScenarioDelta.orders, "number");
    assert.equal(typeof candidate.attributedScenarioDelta.wsc, "number");
    assert.equal(typeof candidate.attributedScenarioDelta.spend, "number");
    assert.equal(typeof candidate.attributedScenarioDelta.contributionProxy, "number");
    assert.equal(candidate.expectedDelta.orders, null);
    assert.equal(candidate.expectedDelta.contributionProfit, null);
    assert.equal(candidate.expected.incrementalMarketingRoi, null);
    assert.equal(candidate.probabilityIncrementalContributionPositive, null);
    assert.equal(candidate.causalStatus, "NOT_ESTIMABLE_C0");
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
  assert.ok(tiny.posterior.ordersPer100Spend < 100 * 1 / 3);
  assert.equal(tiny.suggestedAction, "HOLD");
  assert.ok(tiny.blockers.includes("MINIMUM_EVIDENCE"));
  assert.equal(mature.suggestedAction, "CANARY_BUDGET_10");
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

test("isolates empirical priors by site, currency, audience, and targeting type", () => {
  const us = unit();
  const usOnly = buildAdDecisionModel({ asOf: "2026-07-28", units: [us] });
  const mixed = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      us,
      unit({
        identity: {
          site: "wayfair.ca",
          currency: "CAD",
          isB2B: true,
          campaignId: "CA-PRO",
          targetingType: "KEYWORD",
          listing: "CA-SKU",
          targetId: "keyword:ca",
        },
        metrics: { clicks: 100, spend: 100, orders: 30, wsc: 4500 },
      }),
    ],
  });

  assert.equal(mixed.prior.groups.length, 2);
  assert.equal(mixed.decisions[0].posterior.ordersPer100Spend, usOnly.decisions[0].posterior.ordersPer100Spend);
});

test("blocks AI-tROAS listing actions and preserves missing metrics as unknown", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      unit({
        metrics: { clicks: null },
        readiness: { platformStrategy: "AI Bidding - TROAS" },
      }),
    ],
  });

  const decision = result.decisions[0];
  assert.equal(decision.suggestedAction, "HOLD");
  assert.ok(decision.blockers.includes("AI_TROAS_LISTING_ACTION_UNSUPPORTED"));
  assert.ok(decision.blockers.includes("METRICS_INCOMPLETE"));
  assert.equal(decision.candidates[0].attributedScenario.orders, null);
});

test("keeps an immature, low-inventory, cooling unit in shadow hold", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      unit({
        readiness: {
          attributionMature: false,
          inventoryCoverDays: 10,
          cooldownUntil: "2026-08-07",
        },
      }),
    ],
  });

  const decision = result.decisions[0];
  assert.equal(decision.suggestedAction, "HOLD");
  assert.ok(decision.blockers.includes("ATTRIBUTION_IMMATURE"));
  assert.ok(decision.blockers.includes("INVENTORY_COVER_LOW"));
  assert.ok(decision.blockers.includes("COOLDOWN_ACTIVE"));
  assert.equal(decision.confidence.data, "D0");
});

test("C0 never turns a negative attributed scenario into a bid decrease recommendation", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      unit({
        metrics: { clicks: 120, spend: 130, orders: 8, wsc: 100 },
        economics: { marginRate: 0.05, marginKnown: true, mode: "ORDER_ACTUAL" },
      }),
    ],
  });

  const decision = result.decisions[0];
  assert.equal(decision.confidence.causal, "C0");
  assert.equal(decision.suggestedAction, "HOLD");
  assert.notEqual(decision.suggestedAction, "REDUCE_BID_10");
});

test("models view-through attribution as orders per spend, not click conversion", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      unit({ metrics: { clicks: 2, spend: 100, orders: 5, wsc: 750 } }),
    ],
  });

  const posterior = result.decisions[0].posterior;
  assert.ok(Number.isFinite(posterior.ordersPer100Spend));
  assert.ok(posterior.ordersPer100Spend > 0);
  assert.equal("cvr" in posterior, false);
});

test("fails closed on unverifiable identity, mapping scope, stale inventory, and link evidence", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      unit({
        identity: { site: "", currency: "", targetingType: "" },
        readiness: {
          identityComplete: false,
          mappingVerified: false,
          inventoryFresh: false,
          linkEvidenceVerified: false,
        },
      }),
    ],
  });

  const blockers = result.decisions[0].blockers;
  assert.ok(blockers.includes("IDENTITY_INCOMPLETE"));
  assert.ok(blockers.includes("MAPPING_SCOPE_UNVERIFIED"));
  assert.ok(blockers.includes("INVENTORY_STALE"));
  assert.ok(blockers.includes("LISTING_OPERATIONAL_EVIDENCE_UNVERIFIED"));
  assert.equal(result.decisions[0].suggestedAction, "HOLD");
});

test("rejects a malformed model request", () => {
  assert.throws(
    () => buildAdDecisionModel({ asOf: "2026-07-28", units: null }),
    /units must be an array/,
  );
});

test("fails closed when verification fields are omitted", () => {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [
      unit({
        readiness: {
          mappingVerified: undefined,
          inventoryFresh: undefined,
          linkEvidenceVerified: undefined,
        },
      }),
    ],
  });

  const blockers = result.decisions[0].blockers;
  assert.ok(blockers.includes("MAPPING_SCOPE_UNVERIFIED"));
  assert.ok(blockers.includes("INVENTORY_STALE"));
  assert.ok(blockers.includes("LISTING_OPERATIONAL_EVIDENCE_UNVERIFIED"));
  assert.equal(result.decisions[0].suggestedAction, "HOLD");
});

test("normalizes both Wayfair B2B field spellings without mixing audiences", () => {
  assert.deepEqual(normalizeAdAudience({ isB2B: "true" }), { known: true, isB2B: true, key: "B2B" });
  assert.deepEqual(normalizeAdAudience({ isB2b: "false" }), { known: true, isB2B: false, key: "B2C" });
  assert.deepEqual(normalizeAdAudience({}), { known: false, isB2B: false, key: "" });
});
