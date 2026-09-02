import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUGUST_SALES_MILESTONES,
  AUGUST_SALES_PLAN,
  AUGUST_SALES_PLAN_ROWS,
  summarizeAugustSalesPlan,
} from "../lib/august-sales-plan.mjs";

test("allocates the August stretch target as 150 orders across the active SKU portfolio", () => {
  const summary = summarizeAugustSalesPlan(AUGUST_SALES_PLAN_ROWS);

  assert.equal(AUGUST_SALES_PLAN.targetMetric, "ORDERS");
  assert.equal(AUGUST_SALES_PLAN.orderTarget, 150);
  assert.equal(summary.targetOrders, 150);
  assert.equal(AUGUST_SALES_PLAN_ROWS.length, 10);
  assert.ok(AUGUST_SALES_PLAN_ROWS.every((row) => row.targetOrders > 0));
  assert.ok(!AUGUST_SALES_PLAN_ROWS.some((row) => row.listing === "DRCI1007"));
  assert.deepEqual(
    AUGUST_SALES_PLAN_ROWS.map((row) => row.listing),
    [
      "DMOM1021",
      "DMOM1022",
      "DMOM1003",
      "DMOM1017",
      "DMOM1019",
      "DMOM1000",
      "DMOM1018",
      "DMOM1025",
      "DMOM1026",
      "DMOM1016",
    ],
  );
});

test("uses a profit-and-volume portfolio instead of one margin rule for every SKU", () => {
  const roles = new Set(AUGUST_SALES_PLAN_ROWS.map((row) => row.role));
  const summary = summarizeAugustSalesPlan(AUGUST_SALES_PLAN_ROWS);

  assert.ok(roles.has("VOLUME_CORE"));
  assert.ok(roles.has("PROFIT_POOL"));
  assert.ok(roles.has("CONTROLLED_GROWTH"));
  assert.ok(roles.has("REPAIR_ORGANIC"));
  assert.ok(summary.roleMix.VOLUME_CORE.targetOrders > 0);
  assert.ok(summary.roleMix.PROFIT_POOL.targetOrders > 0);
  assert.ok(new Set(AUGUST_SALES_PLAN_ROWS.map((row) => row.targetOrders)).size > 4);

  const volumeCore = AUGUST_SALES_PLAN_ROWS.find((row) => row.listing === "DMOM1021");
  const profitPool = AUGUST_SALES_PLAN_ROWS.find((row) => row.listing === "DMOM1003");
  assert.equal(volumeCore.role, "VOLUME_CORE");
  assert.equal(profitPool.role, "PROFIT_POOL");
  assert.ok(profitPool.preAdMarginRate > volumeCore.preAdMarginRate);
});

test("holds the store profit pool between 10% and 15% after the full advertising reserve", () => {
  const summary = summarizeAugustSalesPlan(AUGUST_SALES_PLAN_ROWS);

  assert.equal(summary.baseAdBudget, 1800);
  assert.equal(summary.performanceReserve, 61.1);
  assert.equal(summary.plannedAdBudget, 1861.1);
  assert.equal(summary.hardAdCap, 2019.57);
  assert.ok(summary.projectedPostAdMargin >= AUGUST_SALES_PLAN.marginFloor);
  assert.ok(summary.hardAdCap > summary.plannedAdBudget);
  assert.ok(summary.projectedPostAdProfit > 0);
});

test("keeps ad execution locked and gives every SKU a measurable release or stop gate", () => {
  assert.equal(AUGUST_SALES_PLAN.canExecuteAds, false);
  assert.ok(AUGUST_SALES_PLAN_ROWS.every((row) => row.gate.length >= 20));
  assert.ok(AUGUST_SALES_PLAN_ROWS.every((row) => row.stopRule.length >= 20));

  const unknownCost = AUGUST_SALES_PLAN_ROWS.find((row) => row.listing === "DMOM1016");
  assert.equal(unknownCost.marginMode, "STORE_ESTIMATE");
  assert.equal(unknownCost.baseAdBudget, 0);
  assert.equal(unknownCost.performanceReserve, 0);
  assert.match(unknownCost.gate, /成本/);
});

test("sets weekly order milestones that add up to the 150-order goal", () => {
  assert.equal(AUGUST_SALES_MILESTONES.at(-1).cumulativeOrders, 150);
  assert.equal(
    AUGUST_SALES_MILESTONES.reduce((sum, milestone) => sum + milestone.weekOrders, 0),
    150,
  );
  assert.ok(
    AUGUST_SALES_MILESTONES.every(
      (milestone, index, rows) =>
        index === 0 || milestone.cumulativeOrders > rows[index - 1].cumulativeOrders,
    ),
  );
});

test("marks the confirmed sales plan ready for promotion rebuilding without unlocking execution", async () => {
  assert.equal(AUGUST_SALES_PLAN.reviewStatus, "APPROVED");
  assert.equal(AUGUST_SALES_PLAN.reviewedAt, "2026-07-28");
  assert.equal(AUGUST_SALES_PLAN.canBuildPromotionPlan, true);
  assert.equal(AUGUST_SALES_PLAN.canExecuteAds, false);
});

test("preserves the August promotion workspace as a read-only archive", async () => {
  const [route, page, styles] = await Promise.all([
    readFile(new URL("../app/api/plan/progress/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(route, /AUGUST_SALES_PLAN_ROWS/);
  assert.match(route, /summarizeAugustSalesPlan/);
  assert.match(route, /SYNCED_AFTER_SUBMISSION/);
  assert.match(route, /augustArchive/);
  assert.match(page, /8月执行状态/);
  assert.match(page, /2026年8月 · 已归档/);
  assert.match(page, /150 Orders/);
  assert.match(page, /利润款.*跑量款/);
  assert.match(page, /8月目标与执行控制项保留为只读历史资料/);
  assert.match(page, /SKU 执行优先级/);
  assert.match(page, /只看这 4 条红线/);
  assert.match(page, /8月作战节奏/);
  assert.match(page, /完整 Listing 执行表/);
  assert.match(page, /逐 Part 折扣与利润明细/);
  assert.match(page, /tab === "august" && \(/);
  assert.match(page, /查看8月归档计划/);
  assert.doesNotMatch(page, /8月活动审核/);
  assert.doesNotMatch(page, /PAUSED · SALES PLAN FIRST/);
  assert.doesNotMatch(page, /销售计划审核后再重算促销/);
  assert.doesNotMatch(page, /className="card listing-policy-card"/);
  assert.match(styles, /\.execution-context/);
  assert.match(styles, /\.august-operating-grid/);
  assert.match(styles, /\.august-detail/);
});
