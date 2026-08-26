import assert from "node:assert/strict";
import test from "node:test";

import {
  SEPTEMBER_SALES_PLAN,
  SEPTEMBER_SALES_PLAN_ROWS,
  summarizeSeptemberSalesPlan,
} from "../lib/september-sales-plan.mjs";

test("keeps the confirmed September sales and profit forecast auditable", () => {
  const summary = summarizeSeptemberSalesPlan();

  assert.equal(SEPTEMBER_SALES_PLAN.month, "2026-09");
  assert.equal(summary.targetOrders, 180);
  assert.equal(summary.listingCount, 11);
  assert.equal(summary.expectedRevenue, 21636.4);
  assert.equal(summary.expectedGrossProfit, 7253.61);
  assert.equal(summary.projectedPostAdProfit, 6253.61);
  assert.equal(summary.projectedPostAdMargin, 0.289);
  assert.equal(SEPTEMBER_SALES_PLAN_ROWS.find((row) => row.listing === "DRCI1007")?.expectedRevenue, 3420);
  assert.equal(SEPTEMBER_SALES_PLAN_ROWS.find((row) => row.listing === "DMOM1027")?.expectedGrossProfit, 300.6);
});
