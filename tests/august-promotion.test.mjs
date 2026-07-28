import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUGUST_PROMOTION_EVENTS,
  AUGUST_PROMOTION_PLAN,
  AUGUST_PROMOTION_PORTFOLIO,
  AUGUST_QUANTITY_PROMOTION,
  promotionReviewSummary,
  syncPromotionsToSalesPlan,
} from "../lib/august-promotion.mjs";
import { AUGUST_SALES_PLAN_ROWS } from "../lib/august-sales-plan.mjs";

test("syncs all six August event receipts and separates active from submitted", () => {
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
  assert.deepEqual(
    AUGUST_PROMOTION_EVENTS.map((event) => event.projectId),
    ["23766503", "23673214", "23685504", "23697903", "23723498", "23766473"],
  );
  assert.equal(AUGUST_PROMOTION_EVENTS.filter((event) => event.status === "ACTIVE").length, 1);
  assert.equal(AUGUST_PROMOTION_EVENTS.filter((event) => event.status === "SUBMITTED").length, 5);
  assert.equal(AUGUST_PROMOTION_EVENTS.find((event) => event.status === "ACTIVE").submittedProducts, 15);
  assert.equal(
    AUGUST_PROMOTION_EVENTS.find((event) => event.id === "member-pop-up-august-2026")
      .submittedProducts,
    8,
  );
  assert.deepEqual(
    AUGUST_PROMOTION_EVENTS.map((event) => event.submittedProducts),
    [15, 8, 15, 20, 20, 20],
  );
});

test("maps all 21 current Parts to a completed submission or evidence-based hold", () => {
  assert.equal(AUGUST_PROMOTION_PLAN.length, 21);
  assert.equal(new Set(AUGUST_PROMOTION_PLAN.map((item) => item.part)).size, 21);
  assert.ok(AUGUST_PROMOTION_PLAN.every((item) => item.canSubmitToZiniao === false));

  const submitted = AUGUST_PROMOTION_PLAN.filter((item) => item.action === "SUBMITTED");
  const held = AUGUST_PROMOTION_PLAN.filter((item) => item.action === "HOLD");
  assert.equal(submitted.length, 20);
  assert.equal(held.length, 1);
  assert.ok(submitted.every((item) => item.reviewStatus === "APPROVED"));
  assert.ok(submitted.every((item) => item.submittedToZiniao === true));
  assert.ok(held.every((item) => item.reviewStatus === "APPROVED_HOLD"));
  assert.deepEqual(
    held.map((item) => item.part),
    ["5T-1830-900"],
  );
  assert.equal(held[0].inventoryOnHand, 37);
  assert.ok(held.every((item) => item.reason.length >= 12));
});

test("uses role-specific margin floors and complete economics for every proposed Part", () => {
  const submitted = AUGUST_PROMOTION_PLAN.filter((item) => item.action === "SUBMITTED");
  const roleFloors = new Set(submitted.map((item) => item.roleMarginFloor));

  assert.deepEqual(roleFloors, new Set([0.12, 0.2]));
  assert.ok(submitted.every((item) => Number.isFinite(item.priceBasisCents)));
  assert.ok(submitted.every((item) => Number.isFinite(item.costCents)));
  assert.ok(submitted.every((item) => item.inventoryOnHand > 0));
  assert.ok(submitted.every((item) => item.catalogLiveCount === 1));
  assert.ok(
    submitted.every(
      (item) => item.priceBasisType === "PARTNER_HOME_CURRENT_BASE_COST",
    ),
  );
  assert.ok(submitted.every((item) => item.requiredGates.includes("EXPLICIT_USER_APPROVAL")));

  const thinVolume = AUGUST_PROMOTION_PLAN.find((item) => item.part === "MFC-D3-B");
  assert.equal(thinVolume.b2cDiscount, 0.08);
  assert.equal(thinVolume.b2bTotalDiscount, 0.13);
  assert.equal(thinVolume.estimatedWorstMargin, 0.2556);

  const thinRepair = AUGUST_PROMOTION_PLAN.find((item) => item.part === "VFC-2B");
  assert.equal(thinRepair.b2bTotalDiscount, 0.08);
  assert.ok(thinRepair.estimatedWorstMargin >= 0.2);
  assert.match(thinRepair.reason, /8%/);

  assert.deepEqual(
    submitted.filter((item) => item.marginAlert).map((item) => item.part),
    [],
  );
  assert.deepEqual(
    submitted
      .filter((item) => item.marginExceptionApproved)
      .map((item) => item.part),
    [],
  );
});

test("syncs the submitted 16-SKU B2B quantity offer and its stacking rule", () => {
  assert.equal(AUGUST_QUANTITY_PROMOTION.projectId, "16685433");
  assert.equal(AUGUST_QUANTITY_PROMOTION.status, "PROCESSING");
  assert.equal(AUGUST_QUANTITY_PROMOTION.minimumQuantity, 2);
  assert.equal(AUGUST_QUANTITY_PROMOTION.additionalDiscount, 0.05);
  assert.equal(AUGUST_QUANTITY_PROMOTION.parts.length, 16);
  assert.match(AUGUST_QUANTITY_PROMOTION.stackingRule, /叠加/);
  assert.deepEqual(
    AUGUST_PROMOTION_PLAN.filter((item) => item.quantityOffer === 0.05).map(
      (item) => item.part,
    ).sort(),
    [...AUGUST_QUANTITY_PROMOTION.parts].sort(),
  );
});

test("protects the 10%-15% store margin after event and quantity discounts", () => {
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
      recommendedAdBudget: 1800,
      baseAdBudget: 1800,
      performanceReserve: 61.1,
      fallbackAdBudget: 1800,
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
  assert.equal(primary.quantityOrderShare, 0.15);
  assert.equal(primary.projectedRevenue, 16075.72);
  assert.equal(primary.projectedPostAdMargin, 0.17);
  assert.ok(primary.projectedPostAdMargin >= 0.1);
  assert.equal(stress.quantityOrderShare, 0.2);
  assert.equal(stress.projectedPostAdMargin, 0.1553);
  assert.ok(stress.projectedPostAdMargin >= 0.1);
  assert.equal(full.hardAdCapAt10Percent, 2019.57);
  assert.ok(full.projectedPostAdMargin >= 0.1);
  assert.equal(
    AUGUST_PROMOTION_PORTFOLIO.stageTwoAdCap,
    full.hardAdCapAt10Percent,
  );
});

test("summarizes the completed Purple Bird handoff without calling processing active", () => {
  const summary = promotionReviewSummary(AUGUST_PROMOTION_PLAN);

  assert.deepEqual(summary, {
    totalListings: 10,
    totalParts: 21,
    submittedListings: 10,
    submittedParts: 20,
    heldParts: 1,
    approvedParts: 20,
    ziniaoSubmittedParts: 20,
    activeEvents: 1,
    submittedEvents: 5,
    quantityPromotionParts: 16,
    quantityPromotionStatus: "PROCESSING",
    marginAlertParts: 0,
    marginExceptionParts: 0,
    originalAdBudget: 4050,
    recommendedAdBudget: 1800,
    adBudgetReduction: 2250,
    projectedPromotionOrderShare: 0.6,
    projectedRevenue: 16075.72,
    projectedPostAdProfit: 2733.34,
    projectedPostAdMargin: 0.17,
    projectedQuantityOrderShare: 0.15,
    stressPromotionOrderShare: 0.7,
    stressQuantityOrderShare: 0.2,
    stressPostAdMargin: 0.1553,
    fallbackAdBudget: 1800,
    fullPromotionHardAdCap: 2019.57,
  });
});

test("joins promotion status into every August sales-plan row", () => {
  const synced = syncPromotionsToSalesPlan(AUGUST_SALES_PLAN_ROWS);
  assert.equal(synced.length, 10);
  assert.ok(synced.every((row) => row.promotion.syncedAt === "2026-07-28"));
  assert.equal(
    synced.find((row) => row.listing === "DMOM1021").promotion.status,
    "SUBMITTED",
  );
  assert.equal(
    synced.find((row) => row.listing === "DMOM1000").promotion.status,
    "PARTIALLY_SUBMITTED",
  );
  assert.equal(
    synced.find((row) => row.listing === "DMOM1016").promotion.status,
    "SUBMITTED",
  );
  assert.deepEqual(
    synced.find((row) => row.listing === "DMOM1019").promotion.discountTiers,
    ["10%/15%"],
  );
  assert.deepEqual(
    synced.find((row) => row.listing === "DMOM1019").promotion.marginExceptionParts,
    [],
  );
});

test("exposes synced event, quantity and Part status in the operating-center UI", async () => {
  const [route, page, styles] = await Promise.all([
    readFile(new URL("../app/api/plan/progress/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(route, /SYNCED_AFTER_SUBMISSION/);
  assert.match(route, /AUGUST_QUANTITY_PROMOTION/);
  assert.match(route, /syncPromotionsToSalesPlan/);
  assert.match(route, /AUGUST_PROMOTION_PORTFOLIO/);
  assert.match(page, /SKU销量、利润与促销责任/);
  assert.match(page, /逐Part促销执行情况/);
  assert.match(page, /活动已提报/);
  assert.match(page, /暂缓/);
  assert.match(page, /B2B买2额外5%/);
  assert.match(page, /促销兼容广告预算/);
  assert.match(page, /原销售预算/);
  assert.match(page, /已审核并提报/);
  assert.match(page, /项目号/);
  assert.match(styles, /\.promotion-review-table/);
  assert.match(styles, /\.promotion-sync/);
  assert.match(styles, /\.promotion-budget-warning/);
});
