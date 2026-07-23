import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAKEACE_CPC_PLAN,
  benchmarkForListing,
  executionGateForAction,
  recommendCpcAction,
} from "../lib/makeace-cpc-plan.mjs";

test("gates only budget increases and never blocks Bid optimization by plan membership", () => {
  assert.deepEqual(executionGateForAction({
    actionType: "SET_LISTING_BID",
    strategyBlockers: ["未进入月度计划", "缺库存快照"],
    hasMonthlyPlan: false,
    goalEvidenceReliable: false,
  }), []);

  assert.deepEqual(executionGateForAction({
    actionType: "INCREASE_DAILY_CAP",
    strategyBlockers: ["缺库存快照"],
    hasMonthlyPlan: false,
    goalEvidenceReliable: false,
  }), ["增加预算需运营确认"]);

  assert.deepEqual(executionGateForAction({
    actionType: "HOLD",
    strategyBlockers: ["缺库存快照"],
    hasMonthlyPlan: false,
    goalEvidenceReliable: false,
  }), []);
});

test("scales a mature profitable listing even when the monthly plan does not prioritize it", () => {
  const result = recommendCpcAction({
    listing: "DMOM1042",
    currentBid: 0.45,
    current: { spend: 60, clicks: 70, orders: 4, cvr: 0.057, wscRoas: 5.5 },
    rolling28d: { orders: 9, wscRoas: 4.9 },
    breakEvenRoas: 3.54,
    adRole: "observe",
    eventPhase: "closed",
    julyPaceGap: 8,
    qualityPass: false,
    marginKnown: true,
    inventoryKnown: false,
    inventoryCoverDays: 0,
    inventoryQuantity: 0,
    julyRemainingUnits: 0,
    augustReserveUnits: 0,
  });

  assert.equal(result.actionType, "INCREASE_DAILY_CAP");
  assert.deepEqual(result.proposed, { change: "+20%", manual: true });
  assert.match(result.reasons.join("；"), /月度计划仅作辅助/);
});

test("uses Makeace page 22 BM CPC as a July-August category anchor, never as a literal bid", () => {
  assert.equal(MAKEACE_CPC_PLAN.sourcePage, 22);
  assert.deepEqual(MAKEACE_CPC_PLAN.appliesTo, ["2026-07", "2026-08"]);
  assert.equal(MAKEACE_CPC_PLAN.benchmarkMeaning, "CPC_NOT_BID");
  assert.deepEqual(MAKEACE_CPC_PLAN.categoryBenchmarks, {
    "Filing Cabinets": 0.53,
    "Garage Storage Cabinets": 0.88,
    "Bed Frames": 0.50,
    "Lockers": 0.56,
    "Bike And Sport Racks": 0.57,
    "Dressers & Chests": 0.40,
    "Pantry Cabinets": 0.34,
  });
});

test("maps active listings to their real class and refuses to borrow an unrelated benchmark", () => {
  assert.deepEqual(benchmarkForListing("DMOM1021"), {
    listing: "DMOM1021",
    category: "Filing Cabinets",
    cpc: 0.53,
    targetBid: 0.55,
    hardBidCap: 0.58,
  });
  assert.deepEqual(benchmarkForListing("DMOM1003"), {
    listing: "DMOM1003",
    category: "Bike And Sport Racks",
    cpc: 0.57,
    targetBid: 0.55,
    hardBidCap: 0.60,
  });
  assert.equal(benchmarkForListing("DMOM1000").category, "Shelving & Racks");
  assert.equal(benchmarkForListing("DMOM1000").cpc, null);
});

test("uses campaign cap instead of raising bid for a proven BFIJ winner while July is behind pace", () => {
  const result = recommendCpcAction({
    listing: "DMOM1021",
    currentBid: 0.68,
    current: { spend: 80, clicks: 90, orders: 4, cvr: 0.044, wscRoas: 5.2 },
    rolling28d: { orders: 8, wscRoas: 4.8 },
    breakEvenRoas: 2.89,
    adRole: "protect",
    eventPhase: "prepare",
    julyPaceGap: -12,
    qualityPass: true,
    marginKnown: true,
    inventoryKnown: true,
    inventoryCoverDays: 42,
    inventoryQuantity: 90,
    julyRemainingUnits: 10,
    augustReserveUnits: 50,
  });

  assert.equal(result.actionType, "INCREASE_DAILY_CAP");
  assert.deepEqual(result.proposed, { change: "+20%", manual: true });
  assert.equal(result.beforeBid, 0.68);
  assert.match(result.label, /保持 Bid/);
});

test("does not let plan inventory reservations override mature profitable ad evidence", () => {
  const result = recommendCpcAction({
    listing: "DMOM1021",
    currentBid: 0.68,
    current: { spend: 80, clicks: 90, orders: 4, cvr: 0.044, wscRoas: 5.2 },
    rolling28d: { orders: 8, wscRoas: 4.8 },
    breakEvenRoas: 2.89,
    adRole: "protect",
    eventPhase: "event",
    julyPaceGap: -12,
    qualityPass: true,
    marginKnown: true,
    inventoryKnown: true,
    inventoryCoverDays: 42,
    inventoryQuantity: 55,
    julyRemainingUnits: 10,
    augustReserveUnits: 50,
  });

  assert.equal(result.actionType, "INCREASE_DAILY_CAP");
  assert.deepEqual(result.blockers, []);
});

test("moves a weak listing toward the CPC anchor in stages instead of applying the final bid at once", () => {
  const result = recommendCpcAction({
    listing: "DMOM1022",
    currentBid: 0.60,
    current: { spend: 27, clicks: 39, orders: 0, cvr: 0, wscRoas: 0 },
    rolling28d: { orders: 2, wscRoas: 1.37 },
    breakEvenRoas: 3.54,
    adRole: "hold",
    eventPhase: "confirm",
    julyPaceGap: -12,
    qualityPass: true,
    marginKnown: false,
    inventoryKnown: true,
    inventoryCoverDays: 60,
    inventoryQuantity: 200,
    julyRemainingUnits: 4,
    augustReserveUnits: 30,
  });

  assert.equal(result.actionType, "SET_LISTING_BID");
  assert.deepEqual(result.proposed, { bid: 0.51 });
  assert.equal(result.benchmark.cpc, 0.53);
  assert.equal(result.benchmark.targetBid, 0.42);
});

test("pauses a listing when zero-order waste accumulates across mature weeks", () => {
  const result = recommendCpcAction({
    listing: "DMOM1018",
    currentBid: 0.51,
    current: { spend: 12, clicks: 15, orders: 0, cvr: 0, wscRoas: 0 },
    rolling28d: { spend: 49.35, clicks: 64, orders: 0, cvr: 0, wscRoas: 0 },
    breakEvenRoas: 3.54,
    adRole: "scale",
    eventPhase: "event",
    julyPaceGap: -10,
    qualityPass: false,
    marginKnown: false,
    inventoryKnown: false,
    inventoryCoverDays: 0,
    inventoryQuantity: 0,
    julyRemainingUnits: 4,
    augustReserveUnits: 9,
  });

  assert.equal(result.actionType, "SET_LISTING_ACTIVE");
  assert.deepEqual(result.proposed, { active: false });
  assert.match(result.reasons.join("；"), /28天.*64.*0单/);
  assert.match(result.label, /修复/);
  assert.equal(typeof result.repairPlan?.diagnosis, "string");
  assert.ok(result.repairPlan.diagnosis.length > 10);
  assert.ok(result.repairPlan.steps.length >= 3);
  assert.ok(result.repairPlan.acceptance.length >= 2);
  assert.match(result.repairPlan.retest, /点击|预算|Bid/);
});

test("pauses catastrophic rolling waste even when one attributed order exists", () => {
  const result = recommendCpcAction({
    listing: "DMOM1000",
    currentBid: 0.72,
    current: { spend: 18, clicks: 17, orders: 0, cvr: 0, wscRoas: 0 },
    rolling28d: { spend: 94.73, clicks: 85, orders: 1, cvr: 1 / 85, wscRoas: 0.85 },
    breakEvenRoas: 2.60,
    adRole: "hold",
    eventPhase: "event",
    julyPaceGap: -10,
    qualityPass: false,
    marginKnown: true,
    inventoryKnown: false,
    inventoryCoverDays: 0,
    inventoryQuantity: 0,
    julyRemainingUnits: 2,
    augustReserveUnits: 6,
  });

  assert.equal(result.actionType, "SET_LISTING_ACTIVE");
  assert.deepEqual(result.proposed, { active: false });
  assert.match(result.reasons.join("；"), /严重低于保本/);
  assert.match(result.repairPlan.steps.join("；"), /变体|Part|主图|颜色/);
  assert.match(result.repairPlan.acceptance.join("；"), /Live|Catalog|页面/);
});

test("gives DMOM1025 a product-specific drawer and packaging repair plan", () => {
  const result = recommendCpcAction({
    listing: "DMOM1025",
    currentBid: 0.39,
    current: { spend: 7, clicks: 12, orders: 0, cvr: 0, wscRoas: 0 },
    rolling28d: { spend: 45, clicks: 84, orders: 0, cvr: 0, wscRoas: 0 },
    breakEvenRoas: 3.54,
    qualityPass: false,
    inventoryKnown: true,
    inventoryQuantity: 836,
    inventoryCoverDays: 999,
  });

  assert.equal(result.actionType, "SET_LISTING_ACTIVE");
  assert.match(result.repairPlan.diagnosis, /LFC-3W|低分|承接/);
  assert.match(result.repairPlan.steps.join("；"), /抽屉|轨道/);
  assert.match(result.repairPlan.steps.join("；"), /包装|凹/);
  assert.match(result.repairPlan.acceptance.join("；"), /4\.0|整改/);
});

test("treats DMOM1019 as a traffic relevance repair instead of inventing a listing defect", () => {
  const result = recommendCpcAction({
    listing: "DMOM1019",
    currentBid: 0.53,
    current: { spend: 23, clicks: 43, orders: 0, cvr: 0, wscRoas: 0 },
    rolling28d: { spend: 60, clicks: 70, orders: 0, cvr: 0, wscRoas: 0 },
    breakEvenRoas: 3.54,
    qualityPass: true,
    inventoryKnown: true,
    inventoryQuantity: 1459,
    inventoryCoverDays: 999,
  });

  assert.equal(result.actionType, "SET_LISTING_ACTIVE");
  assert.match(result.repairPlan.diagnosis, /流量|投放/);
  assert.match(result.repairPlan.steps.join("；"), /Search Term|搜索词|关键词/);
  assert.doesNotMatch(result.repairPlan.diagnosis, /产品缺陷已确认/);
});

test("AI workbench renders the structured repair plan for paused listings", async () => {
  const source = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");
  assert.match(source, /row\.action\.repairPlan/);
  assert.match(source, /修复清单/);
  assert.match(source, /验收后重测/);
});

test("hard stop overrides an inconclusive prior review", () => {
  const result = recommendCpcAction({
    listing: "DMOM1018",
    currentBid: 0.51,
    current: { spend: 8, clicks: 9, orders: 0, cvr: 0, wscRoas: 0 },
    rolling28d: { spend: 35, clicks: 30, orders: 0, cvr: 0, wscRoas: 0 },
    breakEvenRoas: 3.54,
    adRole: "scale",
    priorReview: { verdict: "INCONCLUSIVE", summary: "上次样本不足" },
  });

  assert.equal(result.actionType, "SET_LISTING_ACTIVE");
  assert.deepEqual(result.proposed, { active: false });
});

test("uses rolling spend to catch distributed losses before the weekly spend threshold", () => {
  const result = recommendCpcAction({
    listing: "DMOM1018",
    currentBid: 0.35,
    current: { spend: 12, clicks: 12, orders: 1, cvr: 0.083, wscRoas: 1.2 },
    rolling28d: { spend: 45, clicks: 38, orders: 2, cvr: 0.053, wscRoas: 1.5 },
    breakEvenRoas: 3.54,
    adRole: "hold",
  });

  assert.equal(result.actionType, "SET_LISTING_BID");
  assert.deepEqual(result.proposed, { bid: 0.32 });
  assert.match(result.reasons.join("；"), /28天累计花费/);
});

test("limits a revenue-producing bid correction to ten percent to protect sales", () => {
  const result = recommendCpcAction({
    listing: "DMOM1003",
    currentBid: 0.75,
    current: { spend: 62, clicks: 71, orders: 3, cvr: 0.042, wscRoas: 3.61 },
    rolling28d: { orders: 5, wscRoas: 3.8 },
    breakEvenRoas: 2.90,
    adRole: "scale",
    eventPhase: "confirm",
    julyPaceGap: -8,
    qualityPass: true,
    marginKnown: true,
    inventoryKnown: true,
    inventoryCoverDays: 40,
    inventoryQuantity: 60,
    julyRemainingUnits: 8,
    augustReserveUnits: 18,
  });

  assert.equal(result.actionType, "SET_LISTING_BID");
  assert.deepEqual(result.proposed, { bid: 0.68 });
  assert.match(result.reasons.join("；"), /单次最多下调10%/);
});

test("pauses every DRCI1007 placement even when historical performance looks profitable", () => {
  const result = recommendCpcAction({
    listing: "DRCI1007", currentBid: 0.30,
    current: { spend: 3, clicks: 10, orders: 2, cvr: 0.2, wscRoas: 100.6 },
    rolling28d: { orders: 4, wscRoas: 25.06 }, breakEvenRoas: 3.54,
    adRole: "exclude", eventPhase: "event", julyPaceGap: -10,
    qualityPass: false, marginKnown: false, inventoryKnown: true,
    inventoryCoverDays: 999, inventoryQuantity: 100, julyRemainingUnits: 0, augustReserveUnits: 0,
  });
  assert.equal(result.actionType, "SET_LISTING_ACTIVE");
  assert.deepEqual(result.proposed, { active: false });
  assert.match(result.label, /暂停全部投放/);
  assert.match(result.reasons.join("；"), /Wayfair.*合并|合并.*Wayfair/);
});

test("does not create a redundant Listing write for an inactive Campaign", async () => {
  const result = recommendCpcAction({
    listing: "DRCI1007", campaignStatus: "INACTIVE", currentBid: 0.30,
    current: { spend: 3, clicks: 10, orders: 2, cvr: 0.2, wscRoas: 100.6 },
    rolling28d: { orders: 4, wscRoas: 25.06 }, breakEvenRoas: 3.54,
    adRole: "exclude", eventPhase: "event", julyPaceGap: -10,
    qualityPass: false, marginKnown: false, inventoryKnown: true,
    inventoryCoverDays: 999, inventoryQuantity: 100, julyRemainingUnits: 0, augustReserveUnits: 0,
  });

  assert.equal(result.actionType, "HOLD");
  assert.deepEqual(result.proposed, {});
  assert.match(result.label, /Campaign.*暂停.*无需/);

  const analysisSource = await readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8");
  assert.match(analysisSource, /campaignStatus:\s*current\.latest\.campaign_status/);
});
