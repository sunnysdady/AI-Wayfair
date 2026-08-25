import assert from "node:assert/strict";
import test from "node:test";

import {
  SEPTEMBER_SALES_PLAN,
  SEPTEMBER_SALES_PLAN_ROWS,
  summarizeSeptemberSalesPlan,
} from "../lib/september-sales-plan.mjs";

test("keeps the confirmed September target, total budget, and SKU ownership list", () => {
  const summary = summarizeSeptemberSalesPlan();

  assert.equal(SEPTEMBER_SALES_PLAN.month, "2026-09");
  assert.equal(SEPTEMBER_SALES_PLAN.status, "CONFIRMED");
  assert.equal(SEPTEMBER_SALES_PLAN.orderTarget, 180);
  assert.equal(SEPTEMBER_SALES_PLAN.adBudget, 1000);
  assert.equal(summary.targetOrders, 180);
  assert.equal(summary.listingCount, 11);
  assert.deepEqual(SEPTEMBER_SALES_PLAN_ROWS, [
    { listing: "DMOM1021", targetOrders: 45 },
    { listing: "DRCI1007", targetOrders: 30 },
    { listing: "DMOM1022", targetOrders: 20 },
    { listing: "DMOM1017", targetOrders: 15 },
    { listing: "DMOM1019", targetOrders: 15 },
    { listing: "DMOM1003", targetOrders: 15 },
    { listing: "DMOM1018", targetOrders: 15 },
    { listing: "DMOM1000", targetOrders: 10 },
    { listing: "DMOM1025", targetOrders: 5 },
    { listing: "DMOM1026", targetOrders: 5 },
    { listing: "DMOM1027", targetOrders: 5 },
  ]);
});
