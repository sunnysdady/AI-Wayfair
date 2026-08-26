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
  forecastNote:
    "销售额按各 SKU 目标单量乘以已审计订单均价或 WSC 估算；预估利润为广告前利润合计扣除 $1,000 店铺广告预算。",
  executionNote: "SKU 的可售、库存与投放资格须在执行前核验。",
});

const roundMoney = (value) => Number(value.toFixed(2));
const roundRate = (value) => Number(value.toFixed(4));

const rows = [
  { listing: "DMOM1021", targetOrders: 45, averageRevenuePerOrder: 118.03, preAdMarginRate: 0.388 },
  { listing: "DRCI1007", targetOrders: 30, averageRevenuePerOrder: 114, preAdMarginRate: 0.2657 },
  { listing: "DMOM1022", targetOrders: 20, averageRevenuePerOrder: 174.3, preAdMarginRate: 0.2538 },
  { listing: "DMOM1017", targetOrders: 15, averageRevenuePerOrder: 62.77, preAdMarginRate: 0.3127 },
  { listing: "DMOM1019", targetOrders: 15, averageRevenuePerOrder: 115.85, preAdMarginRate: 0.3435 },
  { listing: "DMOM1003", targetOrders: 15, averageRevenuePerOrder: 124.35, preAdMarginRate: 0.3992 },
  { listing: "DMOM1018", targetOrders: 15, averageRevenuePerOrder: 118.13, preAdMarginRate: 0.3429 },
  { listing: "DMOM1000", targetOrders: 10, averageRevenuePerOrder: 106.28, preAdMarginRate: 0.4654 },
  { listing: "DMOM1025", targetOrders: 5, averageRevenuePerOrder: 137.95, preAdMarginRate: 0.3497 },
  { listing: "DMOM1026", targetOrders: 5, averageRevenuePerOrder: 90, preAdMarginRate: 0.2653 },
  { listing: "DMOM1027", targetOrders: 5, averageRevenuePerOrder: 180, preAdMarginRate: 0.334 },
];

export const SEPTEMBER_SALES_PLAN_ROWS = Object.freeze(
  rows.map((row) => {
    const expectedRevenue = roundMoney(
      row.targetOrders * row.averageRevenuePerOrder,
    );
    return Object.freeze({
      ...row,
      expectedRevenue,
      expectedGrossProfit: roundMoney(expectedRevenue * row.preAdMarginRate),
    });
  }),
);

export function summarizeSeptemberSalesPlan(rows = SEPTEMBER_SALES_PLAN_ROWS) {
  const expectedRevenue = roundMoney(
    rows.reduce((total, row) => total + row.expectedRevenue, 0),
  );
  const expectedGrossProfit = roundMoney(
    rows.reduce((total, row) => total + row.expectedGrossProfit, 0),
  );
  const projectedPostAdProfit = roundMoney(
    expectedGrossProfit - SEPTEMBER_SALES_PLAN.adBudget,
  );
  return Object.freeze({
    listingCount: rows.length,
    targetOrders: rows.reduce((total, row) => total + row.targetOrders, 0),
    adBudget: SEPTEMBER_SALES_PLAN.adBudget,
    expectedRevenue,
    expectedGrossProfit,
    projectedPostAdProfit,
    projectedPostAdMargin: roundRate(projectedPostAdProfit / expectedRevenue),
  });
}
