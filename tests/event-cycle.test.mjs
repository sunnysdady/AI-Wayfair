import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { recommendCpcAction } from "../lib/makeace-cpc-plan.mjs";
import {
  assessEventRelatedVolatility,
  effectiveStackedDiscount,
  eventCycleForDate,
} from "../lib/event-cycle.mjs";

test("keeps BFIJ active through July 28 instead of calling the event finished early", () => {
  const context = eventCycleForDate("2026-07-27");

  assert.equal(context.mode, "ACTIVE_PEAK");
  assert.deepEqual(context.activeEvents.map((event) => event.id), ["bfij-2026"]);
  assert.equal(context.endedEvents.length, 0);
  assert.match(context.strategyNote, /活动仍在进行/);
});

test("recognizes the BFIJ to Q3 Extended Discounts transition and 14-day attribution window", () => {
  const context = eventCycleForDate("2026-08-05");

  assert.equal(context.mode, "POST_PEAK_TRANSITION");
  assert.deepEqual(context.activeEvents.map((event) => event.id), ["q3-extended-discounts-2026"]);
  assert.deepEqual(context.endedEvents.map((event) => event.id), ["bfij-2026"]);
  assert.equal(context.attributionMaturesOn, "2026-08-11");
  assert.match(context.strategyNote, /峰值活动结束/);
  assert.match(context.strategyNote, /长周期折扣仍在/);
});

test("returns to always-on promotion mode after BFIJ attribution matures", () => {
  const context = eventCycleForDate("2026-08-12");

  assert.equal(context.mode, "ALWAYS_ON_PROMOTION");
  assert.deepEqual(context.activeEvents.map((event) => event.id), ["q3-extended-discounts-2026"]);
  assert.equal(context.endedEvents.length, 0);
});

test("treats an early-August decline as an event-end hypothesis, not proven causation", () => {
  const result = assessEventRelatedVolatility({
    asOf: "2026-08-05",
    baselineValue: 140,
    currentValue: 100,
  });

  assert.equal(result.changeRate, -0.2857);
  assert.equal(result.classification, "EVENT_END_POSSIBLE");
  assert.equal(result.confidence, "MEDIUM");
  assert.match(result.explanation, /不能单独证明因果/);
});

test("calculates stacked discounts multiplicatively", () => {
  assert.equal(effectiveStackedDiscount(0.1, 0.05), 0.145);
  assert.equal(effectiveStackedDiscount(0.15, 0.08), 0.218);
});

test("holds non-safety ad scaling during the post-peak attribution transition", () => {
  const context = eventCycleForDate("2026-08-05");
  const recommendation = recommendCpcAction({
    listing: "DMOM1021",
    campaignStatus: "ACTIVE",
    parts: ["LFC-2B-680"],
    currentBid: 0.68,
    current: { clicks: 100, spend: 50, orders: 5, cvr: 0.05, wscRoas: 6 },
    rolling28d: { clicks: 300, spend: 150, orders: 15, cvr: 0.05, wscRoas: 5 },
    breakEvenRoas: 2.9,
    adRole: "scale",
    eventPhase: "post_event",
    eventContext: context,
  });

  assert.equal(recommendation.actionType, "HOLD");
  assert.match(recommendation.label, /活动归因/);
  assert.ok(recommendation.reasons.some((reason) => /长周期折扣/.test(reason)));
});

test("exposes the shared event-cycle context through the plan API and August workspace", async () => {
  const [route, page, ads] = await Promise.all([
    readFile(new URL("../app/api/plan/progress/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /eventCycleForDate/);
  assert.match(route, /eventCycle[:,]/);
  assert.match(page, /活动周期判断/);
  assert.match(page, /活动峰值回落/);
  assert.match(ads, /eventContext/);
});
