import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUGUST_PROMOTION_EVENTS,
  AUGUST_PROMOTION_PLAN,
  AUGUST_PROMOTION_PORTFOLIO,
  promotionReviewSummary,
} from "../lib/august-promotion.mjs";

test("syncs six August events and separates usable windows from passed deadlines", () => {
  assert.equal(AUGUST_PROMOTION_EVENTS.length, 6);
  assert.deepEqual(
    AUGUST_PROMOTION_EVENTS.map((event) => event.id),
    [
      "q3-priority-product-discounts-2026",
      "member-pop-up-august-2026",
      "clearout-august-2026",
      "summer-markdowns-august-2026",
      "four-day-flash-august-2026",
      "labor-day-august-2026",
    ],
  );
  assert.ok(AUGUST_PROMOTION_EVENTS.every((event) => event.sourceAsOf === "2026-07-28"));

  const missed = AUGUST_PROMOTION_EVENTS.filter(
    (event) => event.planningStatus === "MISSED_DEADLINE_RECHECK",
  );
  assert.deepEqual(
    missed.map((event) => event.id),
    ["q3-priority-product-discounts-2026", "clearout-august-2026"],
  );
  assert.ok(missed.every((event) => event.canRelyOnForPlan === false));

  const upcoming = AUGUST_PROMOTION_EVENTS.filter(
    (event) => event.planningStatus === "UPCOMING_SUBMISSION",
  );
  assert.equal(upcoming.length, 4);
  assert.ok(upcoming.every((event) => event.canRelyOnForPlan === true));
});

test("maps all 21 current Parts to a review proposal or evidence-based hold", () => {
  assert.equal(AUGUST_PROMOTION_PLAN.length, 21);
  assert.equal(new Set(AUGUST_PROMOTION_PLAN.map((item) => item.part)).size, 21);
  assert.ok(AUGUST_PROMOTION_PLAN.every((item) => item.reviewStatus === "PENDING_REVIEW"));
  assert.ok(AUGUST_PROMOTION_PLAN.every((item) => item.canSubmitToZiniao === false));

  const proposed = AUGUST_PROMOTION_PLAN.filter((item) => item.action === "PROPOSE");
  const held = AUGUST_PROMOTION_PLAN.filter((item) => item.action === "HOLD");
  assert.equal(proposed.length, 15);
  assert.equal(held.length, 6);
  assert.deepEqual(
    held.map((item) => item.part),
    ["3T-B", "5T-1600-800", "5T-1830-1200", "5T-1830-900", "LFC-2W", "5T-wangge"],
  );
  assert.ok(held.every((item) => item.reason.length >= 12));
});

test("uses role-specific margin floors and complete economics for every proposed Part", () => {
  const proposed = AUGUST_PROMOTION_PLAN.filter((item) => item.action === "PROPOSE");
  const roleFloors = new Set(proposed.map((item) => item.roleMarginFloor));

  assert.deepEqual(roleFloors, new Set([0.12, 0.2]));
  assert.ok(proposed.every((item) => Number.isFinite(item.priceBasisCents)));
  assert.ok(proposed.every((item) => Number.isFinite(item.costCents)));
  assert.ok(proposed.every((item) => item.inventoryOnHand > 0));
  assert.ok(proposed.every((item) => item.catalogLiveCount === 1));
  assert.ok(
    proposed.every(
      (item) => item.estimatedWorstMargin + 1e-9 >= item.roleMarginFloor,
    ),
  );
  assert.ok(proposed.every((item) => item.requiredGates.includes("EXPLICIT_USER_APPROVAL")));

  const thinVolume = AUGUST_PROMOTION_PLAN.find((item) => item.part === "MFC-D3-B");
  assert.equal(thinVolume.b2cDiscount, 0.08);
  assert.equal(thinVolume.b2bTotalDiscount, 0.13);
  assert.ok(thinVolume.estimatedWorstMargin >= 0.12);
  assert.ok(thinVolume.estimatedWorstMargin < 0.13);

  const thinRepair = AUGUST_PROMOTION_PLAN.find((item) => item.part === "VFC-2B");
  assert.equal(thinRepair.b2bTotalDiscount, 0.08);
  assert.ok(thinRepair.estimatedWorstMargin >= 0.2);
  assert.match(thinRepair.reason, /8%/);
});

test("protects the 10%-15% store margin with a promotion-compatible advertising pool", () => {
  assert.deepEqual(
    {
      originalAdBudget: AUGUST_PROMOTION_PORTFOLIO.originalAdBudget,
      recommendedAdBudget: AUGUST_PROMOTION_PORTFOLIO.recommendedAdBudget,
      baseAdBudget: AUGUST_PROMOTION_PORTFOLIO.baseAdBudget,
      performanceReserve: AUGUST_PROMOTION_PORTFOLIO.performanceReserve,
      fallbackAdBudget: AUGUST_PROMOTION_PORTFOLIO.fallbackAdBudget,
    },
    {
      originalAdBudget: 4050,
      recommendedAdBudget: 2700,
      baseAdBudget: 2200,
      performanceReserve: 500,
      fallbackAdBudget: 2200,
    },
  );

  const primary = AUGUST_PROMOTION_PORTFOLIO.scenarios.find(
    (item) => item.promotionOrderShare === 0.6,
  );
  const stress = AUGUST_PROMOTION_PORTFOLIO.scenarios.find(
    (item) => item.promotionOrderShare === 0.7,
  );
  const full = AUGUST_PROMOTION_PORTFOLIO.scenarios.find(
    (item) => item.promotionOrderShare === 1,
  );
  assert.equal(primary.projectedRevenue, 16197.2);
  assert.equal(primary.projectedPostAdMargin, 0.1245);
  assert.ok(primary.projectedPostAdMargin >= 0.1 && primary.projectedPostAdMargin <= 0.15);
  assert.equal(stress.projectedPostAdMargin, 0.1112);
  assert.ok(stress.projectedPostAdMargin >= 0.1);
  assert.equal(full.hardAdCapAt10Percent, 2225.16);
  assert.ok(full.projectedPostAdMargin < 0.1);
});

test("keeps the Ziniao handoff locked until the user approves the Part-level plan", () => {
  const summary = promotionReviewSummary(AUGUST_PROMOTION_PLAN);

  assert.deepEqual(summary, {
    totalListings: 10,
    totalParts: 21,
    proposedListings: 9,
    proposedParts: 15,
    heldParts: 6,
    pendingReviewParts: 21,
    ziniaoReadyParts: 0,
    submissionLocked: true,
    originalAdBudget: 4050,
    recommendedAdBudget: 2700,
    adBudgetReduction: 1350,
    projectedPromotionOrderShare: 0.6,
    projectedRevenue: 16197.2,
    projectedPostAdProfit: 2015.92,
    projectedPostAdMargin: 0.1245,
    stressPromotionOrderShare: 0.7,
    stressPostAdMargin: 0.1112,
    fallbackAdBudget: 2200,
    fullPromotionHardAdCap: 2225.16,
  });
});

test("exposes the Part review table and budget conflict in the operating-center UI", async () => {
  const [route, page, styles] = await Promise.all([
    readFile(new URL("../app/api/plan/progress/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(route, /PENDING_PROMOTION_REVIEW/);
  assert.match(route, /AUGUST_PROMOTION_PORTFOLIO/);
  assert.match(page, /逐Part促销审核方案/);
  assert.match(page, /建议提报/);
  assert.match(page, /暂缓/);
  assert.match(page, /促销兼容广告预算/);
  assert.match(page, /原销售预算/);
  assert.match(page, /紫鸟可提报/);
  assert.match(page, /MISSED_DEADLINE_RECHECK/);
  assert.match(styles, /\.promotion-review-table/);
  assert.match(styles, /\.promotion-budget-warning/);
});
