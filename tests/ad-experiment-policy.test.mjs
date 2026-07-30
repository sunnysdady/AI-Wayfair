import assert from "node:assert/strict";
import test from "node:test";

import { AD_CANARY_RISK_POLICY, canaryRiskForListing } from "../lib/ad-experiment-policy.mjs";

test("protects the monthly contribution target with a bounded portfolio loss budget", () => {
  assert.equal(AD_CANARY_RISK_POLICY.monthlyRevenueTarget, 16_800);
  assert.equal(AD_CANARY_RISK_POLICY.monthlyContributionFloor, 3_859.37);
  assert.equal(AD_CANARY_RISK_POLICY.baseAdPlan, 1_800);
  assert.equal(AD_CANARY_RISK_POLICY.projectedContribution, 3_920.47);
  assert.equal(AD_CANARY_RISK_POLICY.targetBuffer, 61.1);
  assert.equal(AD_CANARY_RISK_POLICY.portfolioMaxLoss, 61.1);
  assert.equal(AD_CANARY_RISK_POLICY.earliestStart, "2026-08-08");
  assert.equal(AD_CANARY_RISK_POLICY.earliestMatureReview, "2026-08-29");
});

test("authorizes only the two prequalified Listing loss envelopes", () => {
  assert.deepEqual(canaryRiskForListing("DMOM1021"), {
    approved: true,
    maxLoss: 41.1,
    maxDailyIncrementalLoss: 5.87,
  });
  assert.deepEqual(canaryRiskForListing("DMOM1017"), {
    approved: true,
    maxLoss: 20,
    maxDailyIncrementalLoss: 2.86,
  });
  assert.deepEqual(canaryRiskForListing("DMOM1022"), {
    approved: false,
    maxLoss: 0,
    maxDailyIncrementalLoss: 0,
  });
});
