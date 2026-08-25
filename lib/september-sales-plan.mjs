export const SEPTEMBER_SALES_PLAN = Object.freeze({
  id: "yb-2026-09-user-confirmed-sales-plan",
  month: "2026-09",
  status: "CONFIRMED",
  targetMetric: "ORDERS",
  orderTarget: 180,
  adBudget: 1000,
  source: "运营负责人确认的 2026 年 9 月销售计划",
  sourceAsOf: "2026-08-25",
  note: "广告月预算为店铺总预算，尚未按 SKU 分摊。",
  executionNote: "SKU 的可售、库存与投放资格须在执行前核验。",
});

export const SEPTEMBER_SALES_PLAN_ROWS = Object.freeze([
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
].map((row) => Object.freeze(row)));

export function summarizeSeptemberSalesPlan(rows = SEPTEMBER_SALES_PLAN_ROWS) {
  return Object.freeze({
    listingCount: rows.length,
    targetOrders: rows.reduce((total, row) => total + row.targetOrders, 0),
    adBudget: SEPTEMBER_SALES_PLAN.adBudget,
  });
}
