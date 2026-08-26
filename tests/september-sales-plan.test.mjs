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
  assert.equal(summary.expectedRevenue, 21636.4);
  assert.equal(summary.expectedGrossProfit, 7253.61);
  assert.equal(summary.projectedPostAdProfit, 6253.61);
  assert.equal(summary.projectedPostAdMargin, 0.289);
  assert.deepEqual(SEPTEMBER_SALES_PLAN_ROWS.map(({ listing, targetOrders }) => ({ listing, targetOrders })), [
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
  assert.deepEqual(
    SEPTEMBER_SALES_PLAN_ROWS.find((row) => row.listing === "DRCI1007"),
    {
      listing: "DRCI1007",
      targetOrders: 30,
      averageRevenuePerOrder: 114,
      preAdMarginRate: 0.2657,
      expectedRevenue: 3420,
      expectedGrossProfit: 908.69,
    },
  );
  assert.deepEqual(
    SEPTEMBER_SALES_PLAN_ROWS.find((row) => row.listing === "DMOM1027"),
    {
      listing: "DMOM1027",
      targetOrders: 5,
      averageRevenuePerOrder: 180,
      preAdMarginRate: 0.334,
      expectedRevenue: 900,
      expectedGrossProfit: 300.6,
    },
  );
});
