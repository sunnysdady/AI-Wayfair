import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUGUST_PROMOTION_EVENTS,
  AUGUST_PROMOTION_PLAN,
  promotionReviewSummary,
} from "../lib/august-promotion.mjs";

test("syncs the six open August events from the 2026-07-28 Partner Home snapshot", () => {
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
  assert.ok(AUGUST_PROMOTION_EVENTS.every((event) => event.status === "OPEN_FOR_SUBMISSION"));
  assert.ok(AUGUST_PROMOTION_EVENTS.every((event) => event.sourceAsOf === "2026-07-28"));

  const clearout = AUGUST_PROMOTION_EVENTS.find((event) => event.id === "clearout-august-2026");
  assert.deepEqual(
    {
      curationDeadline: clearout.curationDeadline,
      start: clearout.start,
      end: clearout.end,
      lengthDays: clearout.lengthDays,
      category: clearout.category,
      recommendedProducts: clearout.recommendedProducts,
    },
    {
      curationDeadline: "2026-07-25 23:00 EST",
      start: "2026-08-08 00:00 EDT",
      end: "2026-08-11 02:59 EDT",
      lengthDays: 4,
      category: "Clearance",
      recommendedProducts: 52,
    },
  );

  const laborDay = AUGUST_PROMOTION_EVENTS.at(-1);
  assert.equal(laborDay.start, "2026-08-24 00:00 EDT");
  assert.equal(laborDay.end, "2026-09-08 02:59 EDT");
  assert.equal(laborDay.lengthDays, 16);
});

test("maps every current August SKU to a review-required promotion or an explicit hold", () => {
  const expectedListings = [
    "DMOM1021",
    "DMOM1022",
    "DMOM1019",
    "DMOM1003",
    "DMOM1018",
    "DMOM1017",
    "DMOM1000",
    "DMOM1025",
    "DMOM1026",
    "DMOM1016",
    "DRCI1007",
  ];

  assert.deepEqual(AUGUST_PROMOTION_PLAN.map((item) => item.listing), expectedListings);
  assert.ok(AUGUST_PROMOTION_PLAN.every((item) => item.reviewStatus === "PENDING_REVIEW"));
  assert.ok(AUGUST_PROMOTION_PLAN.every((item) => item.canSubmitToZiniao === false));

  const candidates = AUGUST_PROMOTION_PLAN.filter((item) => item.action === "PROPOSE");
  assert.deepEqual(candidates.map((item) => item.listing), ["DMOM1021", "DMOM1003", "DMOM1000"]);
  assert.deepEqual(
    candidates.flatMap((item) => item.parts),
    ["LFC-2B-680", "LFC-2W-680", "4T-Kayak", "5T-1980-1200", "6T-2095-122"],
  );
  assert.ok(candidates.every((item) => item.requiredGates.includes("LIVE_INVENTORY_VERIFIED")));
  assert.ok(candidates.every((item) => item.requiredGates.includes("PROMO_MARGIN_AT_LEAST_20_PERCENT")));

  const thinMargin = AUGUST_PROMOTION_PLAN.find((item) => item.listing === "DMOM1022");
  assert.equal(thinMargin.action, "HOLD");
  assert.match(thinMargin.reason, /9\.6%/);

  const merged = AUGUST_PROMOTION_PLAN.find((item) => item.listing === "DRCI1007");
  assert.equal(merged.action, "EXCLUDE");
  assert.match(merged.reason, /已合并/);
});

test("keeps the Ziniao handoff locked until explicit user approval and all live gates pass", () => {
  const summary = promotionReviewSummary(AUGUST_PROMOTION_PLAN);

  assert.deepEqual(summary, {
    totalListings: 11,
    proposedListings: 3,
    proposedParts: 5,
    heldOrExcludedListings: 8,
    pendingReviewListings: 11,
    ziniaoReadyListings: 0,
    submissionLocked: true,
  });
});

test("exposes the August event list and SKU review plan in the operating-center UI", async () => {
  const [route, page, styles] = await Promise.all([
    readFile(new URL("../app/api/plan/progress/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(route, /AUGUST_PROMOTION_EVENTS/);
  assert.match(route, /AUGUST_PROMOTION_PLAN/);
  assert.match(route, /promotionReviewSummary/);
  assert.match(page, /8月活动清单/);
  assert.match(page, /SKU 促销审核方案/);
  assert.match(page, /审核前不可提报紫鸟/);
  assert.match(page, /OPEN_FOR_SUBMISSION/);
  assert.match(styles, /\.promotion-event-grid/);
  assert.match(styles, /\.promotion-review-table/);
});
