export const SEPTEMBER_SALES_PLAN = Object.freeze({
  id: "yb-2026-09-user-confirmed-sales-plan",
  month: "2026-09",
  status: "CONFIRMED",
  targetMetric: "ORDERS",
  orderTarget: 180,
  adBudget: 1000,
  source: "运营负责人确认的 2026 年 9 月销售计划",
  sourceAsOf: "2026-08-25",
  financialSource: "2026-06-16 至 2026-07-13 的订单收入与采购成本快照",
  financialSourceAsOf: "2026-07-27",
  financialLookbackDays: 28,
  note: "广告月预算为店铺总预算，尚未按 SKU 分摊。",
  executionNote: "SKU 的可售、库存与投放资格须在执行前核验。",
  profitScopeNote: "采购利润已扣采购成本；广告后贡献利润再扣店铺广告预算，未扣退货、履约物流、平台扣点及促销费用。",
});

export const SEPTEMBER_SALES_PLAN_ROWS = Object.freeze([
  { listing: "DMOM1021", targetOrders: 45, forecastRevenue: 5686.2, forecastProcurementProfit: 2219.4, executionStatus: "ACTIVE" },
  { listing: "DRCI1007", targetOrders: 30, forecastRevenue: 2860, forecastProcurementProfit: 760, executionStatus: "HARD_STOP" },
  { listing: "DMOM1022", targetOrders: 20, forecastRevenue: 3150, forecastProcurementProfit: 818.57, executionStatus: "ACTIVE" },
  { listing: "DMOM1017", targetOrders: 15, forecastRevenue: 945, forecastProcurementProfit: 300, executionStatus: "ACTIVE" },
  { listing: "DMOM1019", targetOrders: 15, forecastRevenue: 2025, forecastProcurementProfit: 695.63, executionStatus: "ACTIVE" },
  { listing: "DMOM1003", targetOrders: 15, forecastRevenue: 1869, forecastProcurementProfit: 744, executionStatus: "ACTIVE" },
  { listing: "DMOM1018", targetOrders: 15, forecastRevenue: 1771.88, forecastProcurementProfit: 640.88, executionStatus: "ACTIVE" },
  { listing: "DMOM1000", targetOrders: 10, forecastRevenue: 910.5, forecastProcurementProfit: 385.5, executionStatus: "ACTIVE" },
  { listing: "DMOM1025", targetOrders: 5, forecastRevenue: 658.75, forecastProcurementProfit: 206.35, executionStatus: "ACTIVE" },
  { listing: "DMOM1026", targetOrders: 5, forecastRevenue: 540, forecastProcurementProfit: 143.25, executionStatus: "ACTIVE" },
  { listing: "DMOM1027", targetOrders: 5, forecastRevenue: 850, forecastProcurementProfit: 283.9, executionStatus: "ACTIVE" },
].map((row) => Object.freeze(row)));

export function summarizeSeptemberSalesPlan(rows = SEPTEMBER_SALES_PLAN_ROWS) {
  const toMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const targetOrders = rows.reduce((total, row) => total + row.targetOrders, 0);
  const forecastRevenue = toMoney(rows.reduce((total, row) => total + row.forecastRevenue, 0));
  const forecastProcurementProfit = toMoney(rows.reduce(
    (total, row) => total + row.forecastProcurementProfit,
    0,
  ));
  const executableRows = rows.filter((row) => row.executionStatus === "ACTIVE");
  const executableTargetOrders = executableRows.reduce((total, row) => total + row.targetOrders, 0);
  const executableRevenue = toMoney(executableRows.reduce((total, row) => total + row.forecastRevenue, 0));
  const executableProcurementProfit = toMoney(executableRows.reduce(
    (total, row) => total + row.forecastProcurementProfit,
    0,
  ));
  const transferTarget = rows.find((row) => row.listing === "DMOM1021");
  const blockedTarget = rows.find((row) => row.executionStatus === "HARD_STOP");
  const conditionalTransferRevenue = toMoney(transferTarget && blockedTarget
    ? executableRevenue + (transferTarget.forecastRevenue / transferTarget.targetOrders) * blockedTarget.targetOrders
    : executableRevenue);
  const conditionalTransferProcurementProfit = toMoney(transferTarget && blockedTarget
    ? executableProcurementProfit + (transferTarget.forecastProcurementProfit / transferTarget.targetOrders) * blockedTarget.targetOrders
    : executableProcurementProfit);

  return Object.freeze({
    listingCount: rows.length,
    targetOrders,
    adBudget: SEPTEMBER_SALES_PLAN.adBudget,
    forecastRevenue,
    forecastProcurementProfit,
    forecastContributionAfterAd: toMoney(forecastProcurementProfit - SEPTEMBER_SALES_PLAN.adBudget),
    forecastProcurementMargin: forecastRevenue ? forecastProcurementProfit / forecastRevenue : 0,
    executableBaseline: Object.freeze({
      targetOrders: executableTargetOrders,
      forecastRevenue: executableRevenue,
      forecastProcurementProfit: executableProcurementProfit,
      forecastContributionAfterAd: toMoney(executableProcurementProfit - SEPTEMBER_SALES_PLAN.adBudget),
    }),
    conditionalTransfer: Object.freeze({
      from: blockedTarget?.listing || null,
      to: transferTarget?.listing || null,
      targetOrders,
      forecastRevenue: conditionalTransferRevenue,
      forecastProcurementProfit: conditionalTransferProcurementProfit,
      forecastContributionAfterAd: toMoney(conditionalTransferProcurementProfit - SEPTEMBER_SALES_PLAN.adBudget),
    }),
  });
}
