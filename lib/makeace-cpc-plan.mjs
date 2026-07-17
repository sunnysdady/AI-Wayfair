const CATEGORY_BENCHMARKS = Object.freeze({
  "Filing Cabinets": 0.53,
  "Garage Storage Cabinets": 0.88,
  "Bed Frames": 0.50,
  "Lockers": 0.56,
  "Bike And Sport Racks": 0.57,
  "Dressers & Chests": 0.40,
  "Pantry Cabinets": 0.34,
});

const LISTING_PROFILES = Object.freeze({
  DMOM1020: { category: "Filing Cabinets", targetBid: 0.53, hardBidCap: 0.58 },
  DMOM1021: { category: "Filing Cabinets", targetBid: 0.55, hardBidCap: 0.58 },
  DMOM1022: { category: "Filing Cabinets", targetBid: 0.42, hardBidCap: 0.48 },
  DMOM1019: { category: "Filing Cabinets", targetBid: 0.38, hardBidCap: 0.45 },
  DMOM1029: { category: "Filing Cabinets", targetBid: 0.45, hardBidCap: 0.53 },
  DMOM1018: { category: "Filing Cabinets", targetBid: 0.30, hardBidCap: 0.40 },
  DMOM1025: { category: "Filing Cabinets", targetBid: 0.30, hardBidCap: 0.40 },
  DMOM1003: { category: "Bike And Sport Racks", targetBid: 0.55, hardBidCap: 0.60 },
  DMOM1042: { category: "Pantry Cabinets", targetBid: 0.30, hardBidCap: 0.34 },
  DMOM1000: { category: "Shelving & Racks", targetBid: 0.40, hardBidCap: 0.50 },
  DMOM1017: { category: "Aquariums & Bowls", targetBid: 0.18, hardBidCap: 0.22 },
  DRCI1007: { category: "Filing Cabinets", targetBid: null, hardBidCap: null },
});

export const MAKEACE_CPC_PLAN = Object.freeze({
  id: "makeace-2026-06-bm-cpc-anchor",
  sourceFile: "254723 MAKEACE Business Review 2026.07.pdf",
  sourcePage: 22,
  reportingMonth: "2026-06",
  appliesTo: ["2026-07", "2026-08"],
  benchmarkMeaning: "CPC_NOT_BID",
  categoryBenchmarks: CATEGORY_BENCHMARKS,
  juneAccountFacts: { adSpend: 12352, attributedOrders: 553, attributedWsc: 95027, accountWsc: 129783, wspWscRoas: 7.87 },
  operatingRule: "BM CPC只作为点击成本锚；Bid按Listing成熟归因、利润、链接、库存及月度角色分阶段调整。",
  revenueGuardrail: "有成熟订单的Listing单次Bid下调不超过10%；活动放量优先加Cap，不抬Bid。",
  augustGuardrail: "完成7月剩余目标后仍需覆盖8月责任库存，才允许BFIJ扩量。",
});

function roundBid(value) {
  return Math.max(0.05, Number(value.toFixed(2)));
}

export function benchmarkForListing(listing) {
  const profile = LISTING_PROFILES[listing];
  if (!profile) return { listing, category: "未映射", cpc: null, targetBid: null, hardBidCap: null };
  return {
    listing,
    category: profile.category,
    cpc: CATEGORY_BENCHMARKS[profile.category] ?? null,
    targetBid: profile.targetBid,
    hardBidCap: profile.hardBidCap,
  };
}

export function executionGateForAction({ actionType }) {
  return actionType === "INCREASE_DAILY_CAP" ? ["增加预算需运营确认"] : [];
}

function baseResult(input, benchmark) {
  const actualCpc = input.current.clicks ? Number((input.current.spend / input.current.clicks).toFixed(2)) : null;
  const reasons = [
    benchmark.cpc === null
      ? `${benchmark.category}在Makeace第22页未提供BM CPC，不借用其他类目`
      : `${benchmark.category} BM CPC $${benchmark.cpc.toFixed(2)}；当前实际CPC ${actualCpc === null ? "样本不足" : `$${actualCpc.toFixed(2)}`}`,
    "该锚点同时用于7月与8月计划，但不是直接写入的Bid",
  ];
  return {
    actionType: "HOLD",
    label: "保持当前 Bid",
    proposed: {},
    beforeBid: input.currentBid,
    benchmark,
    actualCpc,
    reasons,
    blockers: [],
    warnings: benchmark.cpc === null ? ["类目无BM CPC，只能按内部成熟数据判断"] : [],
  };
}

function stagedBid(input, result, rate, reason) {
  const target = result.benchmark.targetBid ?? 0.05;
  const nextBid = roundBid(Math.max(target, input.currentBid * (1 - rate)));
  if (nextBid >= input.currentBid) return result;
  result.actionType = "SET_LISTING_BID";
  result.proposed = { bid: nextBid };
  result.label = `Listing Bid 从 $${input.currentBid.toFixed(2)} 分阶段调至 $${nextBid.toFixed(2)}`;
  result.reasons.push(reason);
  result.reasons.push(`最终参考Bid $${target.toFixed(2)}，下一成熟周再判断是否继续靠近`);
  return result;
}

export function recommendCpcAction(input) {
  const benchmark = benchmarkForListing(input.listing);
  const result = baseResult(input, benchmark);

  if (input.adRole === "exclude") {
    return {
      ...result,
      actionType: "HOLD",
      label: "计划外 Listing，不生成广告写入动作",
      proposed: {},
      reasons: [...result.reasons, "该Listing不属于7月或8月销售目标池；仅在广告管理器展示，不进入AI执行批次"],
      warnings: [...result.warnings, "如需启停Campaign，由运营在广告管理器单独处理"],
    };
  }

  if (input.priorReview && ["PENDING", "INCONCLUSIVE", "HARMFUL"].includes(input.priorReview.verdict)) {
    return {
      ...result,
      label: "保持当前 Bid，等待周度复盘闭环",
      reasons: [...result.reasons, input.priorReview.summary],
      warnings: [...result.warnings, `上次调整校验：${input.priorReview.verdict}`],
    };
  }
  if (input.priorReview?.verdict === "EFFECTIVE") result.reasons.push(`上次调整已验证有效：${input.priorReview.summary}`);

  const matureWinner = input.current.orders >= 2
    && input.current.cvr >= 0.02
    && input.current.wscRoas >= Math.max(input.breakEvenRoas, 4)
    && input.rolling28d.orders >= 3
    && input.rolling28d.wscRoas >= input.breakEvenRoas;
  if (matureWinner) {
    return {
      ...result,
      actionType: "INCREASE_DAILY_CAP",
      label: `保持 Bid $${input.currentBid.toFixed(2)}，Campaign Cap 增加20%`,
      proposed: { change: "+20%", manual: true },
      reasons: [
        ...result.reasons,
        `成熟周${input.current.orders}单、ROAS ${input.current.wscRoas.toFixed(2)}×，成熟28天${input.rolling28d.orders}单、ROAS ${input.rolling28d.wscRoas.toFixed(2)}×`,
        `当前与成熟28天ROAS均高于保本线 ${input.breakEvenRoas.toFixed(2)}×，具备增量证据`,
        "月度计划仅作辅助，不限制已验证有效的广告放量",
        "活动窗口优先增加Cap，不上调Bid，避免抬高CPC",
      ],
    };
  }

  const weakNoOrder = input.current.clicks >= 20 && input.current.orders === 0;
  const belowProfit = input.current.spend >= 20
    && input.current.wscRoas < input.breakEvenRoas
    && input.rolling28d.wscRoas < input.breakEvenRoas;
  if (weakNoOrder || belowProfit) {
    return stagedBid(input, result, 0.15, weakNoOrder
      ? `成熟数据${input.current.clicks}次点击0单，单次最多下调15%`
      : "当前周和成熟28天均低于保本线，单次最多下调15%");
  }

  const aboveHardCap = benchmark.hardBidCap !== null && input.currentBid > benchmark.hardBidCap;
  if (input.adRole === "reduce" || aboveHardCap) {
    const revenueProducing = input.current.orders > 0;
    return stagedBid(
      input,
      result,
      revenueProducing ? 0.10 : 0.15,
      revenueProducing
        ? "该Listing仍在产出订单，为保护销售额，单次最多下调10%"
        : "当前Bid高于运营上限且没有成熟订单，单次最多下调15%",
    );
  }

  result.reasons.push("当前Bid、成熟ROAS与销售贡献未触发调整线");
  return result;
}
