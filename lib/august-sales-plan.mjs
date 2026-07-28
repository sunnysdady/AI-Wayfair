const roundMoney = (value) => Number(value.toFixed(2));
const roundRate = (value) => Number(value.toFixed(4));

export const AUGUST_SALES_PLAN = Object.freeze({
  id: "yb-2026-08-order-profit-portfolio",
  month: "2026-08",
  status: "PREPARATION",
  targetMetric: "ORDERS",
  orderTarget: 150,
  baselineAsOf: "2026-07-28",
  baselineMappedOrders: 48,
  currentStoreOrders: 51,
  currentForecastOrders: 56.5,
  marginFloor: 0.1,
  marginTarget: 0.12,
  marginCeiling: 0.15,
  reviewStatus: "APPROVED",
  reviewedAt: "2026-07-28",
  canExecuteAds: false,
  canBuildPromotionPlan: true,
  source: "生产订单、SKU成本、库存与Wayfair广告分析",
  sourceAsOf: "2026-07-28",
  strategy:
    "利润款与跑量款共用店铺利润池：先释放基础预算，只有达到各SKU Gate的赢家才能使用机动预算；店铺广告后利润率低于10%立即停止扩量。",
  riskNote:
    "150单是相对当前56.5单月末预测约2.65倍的挑战目标。计划用周Gate管理，不把目标数字当作无条件烧广告指令。",
});

const rows = [
  {
    listing: "DMOM1021",
    parts: ["LFC-2B-680", "LFC-2W-680"],
    role: "VOLUME_CORE",
    targetOrders: 46,
    julyOrders: 16,
    juneOrders: 27,
    inventoryOnHand: 1624,
    averageRevenuePerOrder: 118.03,
    preAdMarginRate: 0.388,
    marginMode: "ORDER_ACTUAL",
    baseAdBudget: 1400,
    performanceReserve: 250,
    tactic: "主力跑量；Keyword收割、Product发现与B2B分池，不抬Bid抢量。",
    gate: "7天WSC ROAS≥3.2、广告订单CPA≤$35且库存覆盖≥21天，才解锁机动预算。",
    stopRule: "连续20击0单，或7天WSC ROAS<2.8，立即降Cap并暂停低效搜索词。",
  },
  {
    listing: "DMOM1022",
    parts: ["MFC-D3-B", "MFC-D3-W"],
    role: "CONTROLLED_GROWTH",
    targetOrders: 22,
    julyOrders: 6,
    juneOrders: 5,
    inventoryOnHand: 92,
    averageRevenuePerOrder: 174.3,
    preAdMarginRate: 0.2538,
    marginMode: "ORDER_ACTUAL",
    baseAdBudget: 350,
    performanceReserve: 150,
    tactic: "自然转化承接为主；只放大可归因搜索词，避免薄毛利SKU承担全店冲量。",
    gate: "实时可售库存≥35件、7天WSC ROAS≥3.5且广告订单CPA≤$23，才解锁机动预算。",
    stopRule: "累计10击0单，或广告订单CPA>$27，立即停止加预算并回到自然承接。",
  },
  {
    listing: "DMOM1003",
    parts: ["4T-Kayak"],
    role: "PROFIT_POOL",
    targetOrders: 18,
    julyOrders: 6,
    juneOrders: 11,
    inventoryOnHand: 32,
    averageRevenuePerOrder: 124.35,
    preAdMarginRate: 0.3992,
    marginMode: "ORDER_ACTUAL",
    baseAdBudget: 300,
    performanceReserve: 100,
    tactic: "季节利润款；优先自然与活动流量，用高毛利补贴两条跑量主力。",
    gate: "库存不少于18件、链接转化修复通过且首10击至少1单，才释放后续预算。",
    stopRule: "库存降至12件或连续15击0单，立即冻结广告扩量，保留自然销售。",
  },
  {
    listing: "DMOM1017",
    parts: ["3T-B", "3T-W"],
    role: "VOLUME_CORE",
    targetOrders: 20,
    julyOrders: 8,
    juneOrders: 7,
    inventoryOnHand: 738,
    averageRevenuePerOrder: 62.77,
    preAdMarginRate: 0.3127,
    marginMode: "ORDER_ACTUAL",
    baseAdBudget: 250,
    performanceReserve: 100,
    tactic: "低客单高效率跑量；保留已出单组，靠Cap递增而不是提高CPC。",
    gate: "7天WSC ROAS≥4.0、广告订单CPA≤$18且评分不下降，才解锁机动预算。",
    stopRule: "7天WSC ROAS<3.2或广告订单CPA>$20，立即回撤20% Cap并清理低效词。",
  },
  {
    listing: "DMOM1019",
    parts: ["VFC-3B", "VFC-3W"],
    role: "PROFIT_POOL",
    targetOrders: 17,
    julyOrders: 5,
    juneOrders: 8,
    inventoryOnHand: 1333,
    averageRevenuePerOrder: 115.85,
    preAdMarginRate: 0.3435,
    marginMode: "ORDER_ACTUAL",
    baseAdBudget: 350,
    performanceReserve: 150,
    tactic: "高评分利润款；补齐投放覆盖，以Keyword为主、Product仅做发现。",
    gate: "获得稳定曝光后，首12击至少1单且WSC ROAS≥3.4，才解锁机动预算。",
    stopRule: "连续15击0单或广告订单CPA>$30，立即停止该流量组并复核可见性。",
  },
  {
    listing: "DMOM1000",
    parts: ["5T-1600-800", "5T-1830-1200", "5T-1830-900", "5T-1980-1200", "6T-2095-122"],
    role: "PROFIT_POOL",
    targetOrders: 12,
    julyOrders: 2,
    juneOrders: 2,
    inventoryOnHand: 1757,
    averageRevenuePerOrder: 106.28,
    preAdMarginRate: 0.4654,
    marginMode: "ORDER_ACTUAL",
    baseAdBudget: 150,
    performanceReserve: 200,
    tactic: "DMOM1000五变体分层承接：5T-1600-800、5T-1830-1200、5T-1980-1200和6T款承担利润，5T-1830-900低库存不做促销与广告扩量。",
    gate: "利润款首10击至少1单、逐Part广告后毛利不低于12%；5T-1830-900作为保护款，库存恢复至60件以上再单独评估活动和广告。",
    stopRule: "任一Part库存低于12件或累计12击0单即暂停该Part；不因单个低库存变体停掉整组健康利润款。",
  },
  {
    listing: "DMOM1018",
    parts: ["LFC-2B", "LFC-2W"],
    role: "REPAIR_ORGANIC",
    targetOrders: 5,
    julyOrders: 1,
    juneOrders: 3,
    inventoryOnHand: 437,
    averageRevenuePerOrder: 118.13,
    preAdMarginRate: 0.3429,
    marginMode: "ORDER_ACTUAL",
    baseAdBudget: 0,
    performanceReserve: 150,
    tactic: "修复后小额重测；未过链接Gate只承接自然与活动流量。",
    gate: "链接质量通过、价格正常且重测首10击至少1单，才允许从机动池释放预算。",
    stopRule: "未通过链接Gate保持$0；重测累计12击0单则再次暂停，不为目标硬烧。",
  },
  {
    listing: "DMOM1025",
    parts: ["LFC-3B", "LFC-3W"],
    role: "REPAIR_ORGANIC",
    targetOrders: 4,
    julyOrders: 2,
    juneOrders: 3,
    inventoryOnHand: 693,
    averageRevenuePerOrder: 137.95,
    preAdMarginRate: 0.3497,
    marginMode: "ORDER_ACTUAL",
    baseAdBudget: 0,
    performanceReserve: 100,
    tactic: "自然利润补充；修复Listing后仅做低价重测。",
    gate: "链接质量通过且前10击产生订单，才从机动池释放最多$100。",
    stopRule: "10击0单或WSC ROAS<3.2，立即停止重测并继续自然观察。",
  },
  {
    listing: "DMOM1026",
    parts: ["VFC-2B", "VFC-2W"],
    role: "REPAIR_ORGANIC",
    targetOrders: 4,
    julyOrders: 2,
    juneOrders: 2,
    inventoryOnHand: 457,
    averageRevenuePerOrder: 90,
    preAdMarginRate: 0.2653,
    marginMode: "ORDER_ACTUAL",
    baseAdBudget: 0,
    performanceReserve: 50,
    tactic: "薄毛利自然款；只做已验证精准词，不承担店铺冲量。",
    gate: "逐Part成本与实时售价复核后，首8击至少1单才允许使用机动预算。",
    stopRule: "广告订单CPA>$14或8击0单立即停投，禁止用薄毛利补广告亏损。",
  },
  {
    listing: "DMOM1016",
    parts: ["5T-wangge"],
    role: "REPAIR_ORGANIC",
    targetOrders: 2,
    julyOrders: 0,
    juneOrders: 0,
    inventoryOnHand: 696,
    averageRevenuePerOrder: 72,
    preAdMarginRate: 0.2826,
    marginMode: "STORE_ESTIMATE",
    baseAdBudget: 0,
    performanceReserve: 0,
    tactic: "高库存货架恢复款；已按B2C 8%/B2B 13%进入活动，并配置购买2件额外5%，先用自然与活动流量验证。",
    gate: "成本$45、Partner Base $80和链接LIVE已确认；活动期首10次有效访问至少1单且叠加后毛利不低于20%，才进入下一轮广告评估。",
    stopRule: "首10次有效访问0单、叠加后毛利低于20%或退货异常时停止加码；当前继续保持$0广告预算。",
  },
];

export const AUGUST_SALES_PLAN_ROWS = Object.freeze(
  rows.map((row) => {
    const expectedRevenue = roundMoney(row.targetOrders * row.averageRevenuePerOrder);
    const expectedGrossProfit = roundMoney(expectedRevenue * row.preAdMarginRate);
    const plannedAdBudget = roundMoney(row.baseAdBudget + row.performanceReserve);
    const projectedPostAdProfit = roundMoney(expectedGrossProfit - plannedAdBudget);
    return Object.freeze({
      ...row,
      expectedRevenue,
      expectedGrossProfit,
      plannedAdBudget,
      projectedPostAdProfit,
      projectedPostAdMargin: roundRate(projectedPostAdProfit / expectedRevenue),
    });
  }),
);

export const AUGUST_SALES_MILESTONES = Object.freeze([
  {
    label: "W1",
    range: "08/01–08/07",
    weekOrders: 25,
    cumulativeOrders: 25,
    note: "先跑基础预算；链接未过Gate的修复款保持$0，日均3.6单。",
  },
  {
    label: "W2",
    range: "08/08–08/14",
    weekOrders: 34,
    cumulativeOrders: 59,
    note: "承接72 Hour与Summer Markdowns；只给达标赢家解锁第一段机动预算。",
  },
  {
    label: "W3",
    range: "08/15–08/21",
    weekOrders: 39,
    cumulativeOrders: 98,
    note: "Four Day Flash主冲量周；每日检查SKU利润池、CPA和库存。",
  },
  {
    label: "W4",
    range: "08/22–08/28",
    weekOrders: 38,
    cumulativeOrders: 136,
    note: "Labor Day窗口启动；利润率低于12%先停低效流量，低于10%停止扩量。",
  },
  {
    label: "收口",
    range: "08/29–08/31",
    weekOrders: 14,
    cumulativeOrders: 150,
    note: "仅成熟赢家冲刺，禁止为补目标突破全店$4,403广告硬上限。",
  },
]);

export function summarizeAugustSalesPlan(planRows = AUGUST_SALES_PLAN_ROWS) {
  const summary = planRows.reduce(
    (result, row) => {
      result.targetOrders += row.targetOrders;
      result.projectedRevenue += row.expectedRevenue;
      result.projectedGrossProfit += row.expectedGrossProfit;
      result.baseAdBudget += row.baseAdBudget;
      result.performanceReserve += row.performanceReserve;
      const role = result.roleMix[row.role] || {
        targetOrders: 0,
        projectedRevenue: 0,
        projectedGrossProfit: 0,
        plannedAdBudget: 0,
      };
      role.targetOrders += row.targetOrders;
      role.projectedRevenue += row.expectedRevenue;
      role.projectedGrossProfit += row.expectedGrossProfit;
      role.plannedAdBudget += row.plannedAdBudget;
      result.roleMix[row.role] = role;
      return result;
    },
    {
      targetOrders: 0,
      projectedRevenue: 0,
      projectedGrossProfit: 0,
      baseAdBudget: 0,
      performanceReserve: 0,
      roleMix: {},
    },
  );
  const plannedAdBudget = summary.baseAdBudget + summary.performanceReserve;
  const projectedPostAdProfit = summary.projectedGrossProfit - plannedAdBudget;
  const hardAdCap =
    summary.projectedGrossProfit - summary.projectedRevenue * AUGUST_SALES_PLAN.marginFloor;
  return {
    ...summary,
    projectedRevenue: roundMoney(summary.projectedRevenue),
    projectedGrossProfit: roundMoney(summary.projectedGrossProfit),
    baseAdBudget: roundMoney(summary.baseAdBudget),
    performanceReserve: roundMoney(summary.performanceReserve),
    plannedAdBudget: roundMoney(plannedAdBudget),
    projectedPostAdProfit: roundMoney(projectedPostAdProfit),
    projectedPostAdMargin: roundRate(projectedPostAdProfit / summary.projectedRevenue),
    hardAdCap: roundMoney(hardAdCap),
    roleMix: Object.fromEntries(
      Object.entries(summary.roleMix).map(([role, values]) => [
        role,
        {
          ...values,
          projectedRevenue: roundMoney(values.projectedRevenue),
          projectedGrossProfit: roundMoney(values.projectedGrossProfit),
          plannedAdBudget: roundMoney(values.plannedAdBudget),
        },
      ]),
    ),
  };
}
