import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUGUST_SALES_PLAN_ROWS,
  augustSalesPlanForListing,
} from "../lib/august-sales-plan.mjs";

test("exposes the same per-listing August budget to advertising optimization", () => {
  assert.deepEqual(augustSalesPlanForListing("DMOM1021"), {
    targetMetric: "ORDERS",
    targetOrders: 46,
    baseAdBudget: 900,
    canaryBudget: 41.1,
    plannedAdBudget: 941.1,
    scaleEligible: true,
  });
  assert.deepEqual(augustSalesPlanForListing("DMOM1016"), {
    targetMetric: "ORDERS",
    targetOrders: 2,
    baseAdBudget: 0,
    canaryBudget: 0,
    plannedAdBudget: 0,
    scaleEligible: false,
  });
  assert.equal(
    AUGUST_SALES_PLAN_ROWS.reduce((sum, row) => sum + row.plannedAdBudget, 0),
    1861.1,
  );
});

test("wires August targets and budget eligibility into model input, To-Do, and execution", async () => {
  const [analysis, route, experimentPolicy] = await Promise.all([
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/ads/actions/execute/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/ad-experiment-policy.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(analysis, /augustSalesPlanForListing/);
  assert.match(analysis, /executionPlan:/);
  assert.match(analysis, /listingTargetOrders/);
  assert.match(analysis, /listingPlannedAdBudget/);
  assert.match(analysis, /AUGUST_EXECUTION_POLICY/);
  assert.match(route, /validateAugustAdActionsAgainstPlan/);
  assert.match(route, /该Listing的8月授权广告预算为\\$0/);
  assert.match(experimentPolicy, /AUGUST_EXECUTION_POLICY/);
  assert.doesNotMatch(experimentPolicy, /const BASE_AD_PLAN = 1_800/);
  assert.doesNotMatch(experimentPolicy, /const PORTFOLIO_MAX_LOSS = 61\\.1/);
});
