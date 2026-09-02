import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PLAN_PROGRESS_CACHE_KEY,
  promotionSummaryForDisplay,
} from "../lib/plan-progress-view.mjs";

test("renders a safe synced summary when an old cached plan lacks promotion fields", () => {
  assert.deepEqual(promotionSummaryForDisplay(undefined), {
    submittedListings: 0,
    submittedParts: 0,
    heldParts: 0,
    ziniaoSubmittedParts: 0,
    activeEvents: 0,
    submittedEvents: 0,
    quantityPromotionParts: 0,
    marginAlertParts: 0,
    marginExceptionParts: 0,
    recommendedAdBudget: 0,
    projectedPostAdMargin: 0,
  });
});

test("preserves the current promotion submission summary for the UI", () => {
  const current = {
    submittedListings: 9,
    submittedParts: 15,
    heldParts: 6,
    ziniaoSubmittedParts: 15,
    activeEvents: 1,
    submittedEvents: 5,
    quantityPromotionParts: 11,
    marginAlertParts: 0,
    marginExceptionParts: 2,
    recommendedAdBudget: 2700,
    projectedPostAdMargin: 0.1178,
  };
  assert.deepEqual(promotionSummaryForDisplay(current), current);
});

test("hydrates the plan cache after mount and uses a schema-versioned cache key", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

  assert.equal(PLAN_PROGRESS_CACHE_KEY, "plan:progress:v9-september");
  assert.match(page, /useState<PlanProgress \| null>\(null\)/);
  assert.match(page, /PLAN_PROGRESS_CACHE_KEY/);
  assert.doesNotMatch(
    page,
    /useState<PlanProgress\|null>\(readClientCache<PlanProgress>\('plan:progress'/,
  );
});
