import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildAdDecisionModel } from "../lib/ad-decision-model.mjs";

const cases = JSON.parse(await readFile(
  new URL("../.claude/evals/ad-decision-model.cases.json", import.meta.url),
  "utf8",
));
const commonPriorUnit = {
  identity: {
    site: "wayfair.com",
    currency: "USD",
    isB2B: false,
    campaignId: "PRIOR-ANCHOR",
    targetingType: "PRODUCT",
    listing: "PRIOR-ANCHOR",
    targetId: "listing:PRIOR-ANCHOR",
  },
  metrics: { clicks: 300, spend: 360, orders: 18, wsc: 2700 },
  economics: { marginRate: 0.35, marginKnown: true, mode: "ORDER_ACTUAL" },
  readiness: {
    attributionMature: true,
    mappingComplete: true,
    mappingVerified: true,
    inventoryKnown: true,
    inventoryCoverDays: 90,
    inventoryFresh: true,
    linkPass: true,
    linkEvidenceVerified: true,
    cooldownUntil: null,
  },
};

let passed = 0;
for (const evalCase of cases) {
  const result = buildAdDecisionModel({
    asOf: "2026-07-28",
    units: [evalCase.input, commonPriorUnit],
  });
  const decision = result.decisions[0];
  assert.equal(decision.suggestedAction, evalCase.expectedAction, evalCase.description);
  if (evalCase.expectedBlocker) {
    assert.ok(
      decision.blockers.includes(evalCase.expectedBlocker),
      `${evalCase.id} should contain ${evalCase.expectedBlocker}`,
    );
  }
  assert.equal(decision.eligibleForExecution, false);
  assert.equal(decision.confidence.causal, "C0");
  assert.ok(decision.candidates.every((candidate) => (
    candidate.probabilityIncrementalContributionPositive === null
    && candidate.expected.incrementalMarketingRoi === null
  )));
  passed += 1;
  process.stdout.write(`PASS ${evalCase.id}\n`);
}

process.stdout.write(`\n${passed}/${cases.length} advertising model evals passed\n`);
