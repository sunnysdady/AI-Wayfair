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
  assert.equal(summary.forecastRevenue, 21266.33);
  assert.equal(summary.forecastProcurementProfit, 7197.48);
  assert.equal(summary.forecastContributionAfterAd, 6197.48);
  assert.equal(summary.executableBaseline.targetOrders, 150);
  assert.equal(summary.executableBaseline.forecastRevenue, 18406.33);
  assert.equal(summary.executableBaseline.forecastProcurementProfit, 6437.48);
  assert.equal(summary.executableBaseline.forecastContributionAfterAd, 5437.48);
  assert.deepEqual(
    SEPTEMBER_SALES_PLAN_ROWS.map(({ listing, targetOrders, executionStatus }) => ({ listing, targetOrders, executionStatus })),
    [
      { listing: "DMOM1021", targetOrders: 45, executionStatus: "ACTIVE" },
      { listing: "DRCI1007", targetOrders: 30, executionStatus: "HARD_STOP" },
      { listing: "DMOM1022", targetOrders: 20, executionStatus: "ACTIVE" },
      { listing: "DMOM1017", targetOrders: 15, executionStatus: "ACTIVE" },
      { listing: "DMOM1019", targetOrders: 15, executionStatus: "ACTIVE" },
      { listing: "DMOM1003", targetOrders: 15, executionStatus: "ACTIVE" },
      { listing: "DMOM1018", targetOrders: 15, executionStatus: "ACTIVE" },
      { listing: "DMOM1000", targetOrders: 10, executionStatus: "ACTIVE" },
      { listing: "DMOM1025", targetOrders: 5, executionStatus: "ACTIVE" },
      { listing: "DMOM1026", targetOrders: 5, executionStatus: "ACTIVE" },
      { listing: "DMOM1027", targetOrders: 5, executionStatus: "ACTIVE" },
    ],
  );
});
