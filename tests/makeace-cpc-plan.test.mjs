import assert from "node:assert/strict";
import test from "node:test";

import {
  MAKEACE_CPC_PLAN,
  benchmarkForListing,
  recommendCpcAction,
} from "../lib/makeace-cpc-plan.mjs";

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

test("blocks BFIJ expansion when July demand would consume August's reserved stock", () => {
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

  assert.equal(result.actionType, "HOLD");
  assert.match(result.blockers.join("；"), /8月.*预留库存/);
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

test("never proposes pausing a listing; exclusions remain visible as a hold decision", () => {
  const result = recommendCpcAction({
    listing: "DRCI1007", currentBid: 0.20,
    current: { spend: 0, clicks: 0, orders: 0, cvr: 0, wscRoas: 0 },
    rolling28d: { orders: 0, wscRoas: 0 }, breakEvenRoas: 3.54,
    adRole: "exclude", eventPhase: "event", julyPaceGap: -10,
    qualityPass: false, marginKnown: false, inventoryKnown: true,
    inventoryCoverDays: 999, inventoryQuantity: 100, julyRemainingUnits: 0, augustReserveUnits: 0,
  });
  assert.equal(result.actionType, "HOLD");
  assert.doesNotMatch(result.label, /暂停/);
});
