import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PLAN_PROGRESS_CACHE_KEY,
  promotionSummaryForDisplay,
} from "../lib/plan-progress-view.mjs";

test("renders a safe locked review summary when an old cached plan lacks promotion fields", () => {
  assert.deepEqual(promotionSummaryForDisplay(undefined), {
    proposedListings: 0,
    proposedParts: 0,
    heldOrExcludedListings: 0,
    pendingReviewListings: 0,
    ziniaoReadyListings: 0,
    submissionLocked: true,
  });
});

test("preserves the current promotion summary for the review UI", () => {
  const current = {
    proposedListings: 3,
    proposedParts: 5,
    heldOrExcludedListings: 8,
    pendingReviewListings: 11,
    ziniaoReadyListings: 0,
    submissionLocked: true,
  };
  assert.deepEqual(promotionSummaryForDisplay(current), current);
});

test("hydrates the plan cache after mount and uses a schema-versioned cache key", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

  assert.equal(PLAN_PROGRESS_CACHE_KEY, "plan:progress:v4");
  assert.match(page, /useState<PlanProgress\|null>\(null\)/);
  assert.match(page, /PLAN_PROGRESS_CACHE_KEY/);
  assert.doesNotMatch(
    page,
    /useState<PlanProgress\|null>\(readClientCache<PlanProgress>\('plan:progress'/,
  );
});
