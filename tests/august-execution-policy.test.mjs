import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUGUST_EXECUTION_POLICY,
  evaluateAugustStageTwo,
  validateAugustRunForExecution,
} from "../lib/august-execution-policy.mjs";
import { AUGUST_PROMOTION_EVENTS } from "../lib/august-promotion.mjs";

test("locks the authorized August order target and phased advertising caps", () => {
  assert.deepEqual(
    {
      targetMetric: AUGUST_EXECUTION_POLICY.targetMetric,
      stretchOrderTarget: AUGUST_EXECUTION_POLICY.stretchOrderTarget,
      baseAdBudget: AUGUST_EXECUTION_POLICY.baseAdBudget,
      canaryLossCap: AUGUST_EXECUTION_POLICY.canaryLossCap,
      stageOneAdCap: AUGUST_EXECUTION_POLICY.stageOneAdCap,
      stageTwoAdCap: AUGUST_EXECUTION_POLICY.stageTwoAdCap,
      retiredAdBudgets: AUGUST_EXECUTION_POLICY.retiredAdBudgets,
    },
    {
      targetMetric: "ORDERS",
      stretchOrderTarget: 150,
      baseAdBudget: 1800,
      canaryLossCap: 61.1,
      stageOneAdCap: 1861.1,
      stageTwoAdCap: 2019.57,
      retiredAdBudgets: [2700, 4050],
    },
  );
});

test("keeps stage two locked while submitted promotions or operating gates remain unresolved", () => {
  const current = evaluateAugustStageTwo({
    promotionEvents: AUGUST_PROMOTION_EVENTS,
    projectedPostAdMargin: 0.12,
    fillRate: 0.96,
    minimumInventoryCoverDays: 21,
    listingOperationalEvidenceVerified: true,
    mappingScopeVerified: true,
  });

  assert.equal(current.ready, false);
  assert.ok(current.blockers.includes("PROMOTIONS_NOT_ACTIVE"));

  const ready = evaluateAugustStageTwo({
    promotionEvents: AUGUST_PROMOTION_EVENTS.map((event) => ({
      ...event,
      status: "ACTIVE",
    })),
    projectedPostAdMargin: 0.12,
    fillRate: 0.96,
    minimumInventoryCoverDays: 21,
    listingOperationalEvidenceVerified: true,
    mappingScopeVerified: true,
  });

  assert.deepEqual(ready, {
    ready: true,
    authorizedAdCap: 2019.57,
    blockers: [],
  });
});

test("freezes July decision batches instead of carrying them into the August plan", () => {
  assert.deepEqual(
    validateAugustRunForExecution({
      runKey: "weekly:2026-07-14:2026-07-20",
      asOf: "2026-07-28",
    }),
    {
      allowed: false,
      reason: "SUPERSEDED_BY_AUTHORIZED_AUGUST_PLAN",
    },
  );
  assert.deepEqual(
    validateAugustRunForExecution({
      runKey: "weekly:2026-08-01:2026-08-07",
      asOf: "2026-08-01",
    }),
    { allowed: true, reason: null },
  );
});

test("enforces the August cutover inside the live advertising route", async () => {
  const route = await readFile(
    new URL("../app/api/ads/actions/execute/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /validateAugustRunForExecution/);
  assert.match(route, /SUPERSEDED_BY_AUTHORIZED_AUGUST_PLAN/);
  assert.match(route, /八月执行口径已冻结该跨月旧批次/);
});
