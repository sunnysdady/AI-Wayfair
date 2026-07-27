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

const LISTING_REPAIR_PROFILES = Object.freeze({
  DMOM1000: {
    focus: "变体资格与页面承接",
    diagnosis: "DMOM1000 的成熟流量已越过止损线；现有证据同时显示部分 Part 曾处于 Rejected / Wayfair Reviewing，先按变体资格与页面承接问题排查，不直接认定产品本身失效。",
    steps: [
      "逐一核对 5T-1600-800、5T-1830-900、5T-1830-1200、5T-1980-1200、6T-2095-122 的 Live / Catalog 状态；移除 Rejected 或 Reviewing 变体。",
      "核对 Campaign 内 Part 与落地页变体一一对应，避免点击落到错误尺寸或颜色。",
      "复核主图、颜色名、尺寸与承重描述；重点消除黑色与深灰色的展示偏差。",
    ],
    acceptance: [
      "参与投放的 Part 均为 Live 且通过 Catalog 投放资格；不合格变体已从 Campaign 移除。",
      "页面主图、颜色、尺寸、承重与所选变体一致，并保存逐项核验记录。",
    ],
  },
  DMOM1022: {
    focus: "Part 映射与移动柜卖点",
    diagnosis: "DMOM1022 有历史自然转化，但当前广告流量未转化；优先核查 MFC-D3-W / MFC-D3-B 的精确 Part 映射、价格和页面承接。",
    steps: [
      "确认 Campaign 使用带连字符的 MFC-D3-W / MFC-D3-B，且两款均为 Live 并落到正确变体。",
      "对齐广告展示价、落地页价格与可售库存，记录异常价格或缺货变体。",
      "在主图和首屏明确 3 抽、带锁、可移动、适配文件尺寸及关键外形尺寸。",
    ],
    acceptance: [
      "两个 Part 均通过 Live / Catalog 核验，Campaign 与页面变体映射无误。",
      "价格、库存和 3 抽移动柜核心信息在广告入口与页面保持一致。",
    ],
  },
  DMOM1018: {
    focus: "黑白变体承接差异",
    diagnosis: "DMOM1018 的成熟流量持续 0 单；历史黑色变体有转化而白色变体无转化，应先定位黑白变体在图片、价格、库存与内容上的差异。",
    steps: [
      "分别打开 LFC-2B 与 LFC-2W，核对 Live 状态、价格、库存、主图和落地页选择是否正确。",
      "对比两种颜色的图片数量与内容完整度，补齐尺寸、抽屉行程、文件适配和防倾倒信息。",
      "拆分查看两个 Part 的广告点击与 Search Terms，停止把无转化变体继续混投。",
    ],
    acceptance: [
      "LFC-2B / LFC-2W 均完成页面差异清单；白色变体缺失项已修复或已退出测试。",
      "参与复测的 Part 为 Live、可售且页面内容完整，Campaign 可单独识别其效果。",
    ],
  },
  DMOM1025: {
    focus: "低分变体与产品承接",
    diagnosis: "DMOM1025 的 LFC-3W 存在低分承接风险，历史反馈集中在板材偏薄、运输凹损、抽屉卡顿与顶部承重；广告恢复前需完成产品和页面整改。",
    steps: [
      "检查抽屉轨道、开合顺畅度与装配公差，形成抽检记录并处理卡顿批次。",
      "加强边角和面板包装防护，验证运输后无凹痕、变形或表面损伤。",
      "在页面明确顶部承重、抽屉使用边界、防倾倒与安装要求，避免超预期使用。",
    ],
    acceptance: [
      "抽屉与包装整改均有质检证据，问题批次已隔离或完成返工。",
      "LFC-3W 页面整改完成；评分恢复至 4.0 以上前只允许小流量验证，不恢复常规投放。",
    ],
  },
  DMOM1019: {
    focus: "搜索流量相关性",
    diagnosis: "DMOM1019 页面评分和库存没有显示已确认的产品缺陷，当前更像投放流量相关性问题；应先清理搜索词并校正广告结构。",
    steps: [
      "导出 Search Terms / 搜索词报告，标记与 3 drawer vertical filing cabinet 意图无关的流量。",
      "暂停无关词和宽泛流量，将 vertical file cabinet、3 drawer file cabinet 等高相关词拆入 Exact 小组。",
      "复核 VFC-3B / VFC-3W 的 Campaign 映射、Live 状态以及落地页标题和主图的一致性。",
    ],
    acceptance: [
      "搜索词清单已完成保留、否定与暂停标记，复测组只含高相关词或相关商品定向。",
      "两个 Part 均可售且映射正确；未发现页面硬伤时不得写成产品缺陷已确认。",
    ],
  },
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
    input.eventContext?.strategyNote || "活动周期信息未接入，本次建议仅按成熟广告数据判断",
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

function repairPlanFor(input) {
  const profile = LISTING_REPAIR_PROFILES[input.listing];
  const parts = Array.isArray(input.parts) && input.parts.length ? input.parts.join(" / ") : `${input.listing} 的投放 Part`;
  const diagnosis = profile?.diagnosis
    || `${input.listing} 的成熟流量已越过止损线；目前只能确认广告未有效转化，需先核验投放资格、页面承接和流量相关性，不能凭 0 单直接断言具体产品缺陷。`;
  const steps = profile?.steps || [
    `逐一确认 ${parts} 为 Live、可售且具备 Catalog 投放资格；不合格 Part 从 Campaign 移除。`,
    "核对主图、标题、价格、尺寸、颜色和变体选择，确保广告入口与落地页信息一致。",
    "导出 Search Terms / 定向明细，暂停无关流量，并把高相关流量单独建立复测组。",
  ];
  const acceptance = profile?.acceptance || [
    "参与复测的 Part 均为 Live、可售并通过 Catalog 资格核验。",
    "页面与流量检查表已完成，发现的问题有修改记录或移除记录。",
  ];
  return {
    focus: profile?.focus || "资格、页面与流量复核",
    diagnosis,
    steps,
    acceptance,
    retest: `修复验收后以不高于当前 Bid $${Number(input.currentBid || 0).toFixed(2)} 的小预算单独复测；累计 20 个成熟点击，CVR≥2% 且 WSC ROAS≥保本线 ${Number(input.breakEvenRoas || 0).toFixed(2)}× 才恢复常规投放，否则继续暂停。`,
  };
}

export function recommendCpcAction(input) {
  const benchmark = benchmarkForListing(input.listing);
  const result = baseResult(input, benchmark);

  if (/inactive|paused/i.test(String(input.campaignStatus || ""))) {
    return {
      ...result,
      label: "Campaign 已暂停，无需重复修改 Listing",
      reasons: [
        `Campaign 当前状态为 ${input.campaignStatus}`,
        "Wayfair 不接受对已暂停 Campaign 的 Listing Bid 或启停写入",
      ],
      warnings: [],
    };
  }

  if (input.listing === "DRCI1007") {
    return {
      ...result,
      actionType: "SET_LISTING_ACTIVE",
      label: "暂停全部投放",
      proposed: { active: false },
      reasons: [
        "MFC-D2-B / MFC-D2-W 已被 Wayfair 合并，无法承接新订单",
        "历史点击、订单与 ROAS 仅作复盘证据，不得触发放量",
        "DRCI1007 在所有关联 Campaign 中必须停用",
      ],
      warnings: [],
    };
  }

  const rollingNoOrder = input.rolling28d.clicks >= 20 && input.rolling28d.orders === 0;
  const catastrophicRollingWaste = input.rolling28d.clicks >= 40
    && input.rolling28d.spend >= 20
    && input.rolling28d.wscRoas < input.breakEvenRoas * 0.5;
  if (rollingNoOrder || catastrophicRollingWaste) {
    const repairPlan = repairPlanFor(input);
    return {
      ...result,
      actionType: "SET_LISTING_ACTIVE",
      label: `暂停投放；先修复${repairPlan.focus}`,
      proposed: { active: false },
      repairPlan,
      reasons: [
        ...result.reasons,
        rollingNoOrder
          ? `成熟28天累计${input.rolling28d.clicks}次点击、0单，已越过强制止损线`
          : `成熟28天累计${input.rolling28d.clicks}次点击、${input.rolling28d.orders}单，ROAS ${input.rolling28d.wscRoas.toFixed(2)}×严重低于保本 ${input.breakEvenRoas.toFixed(2)}×`,
        "跨周累计止损优先于月度角色和旧复盘结论",
      ],
      warnings: [...result.warnings, "恢复前必须完成Listing承接与投放资格复核"],
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

  if (input.eventContext?.mode === "POST_PEAK_TRANSITION" || input.eventContext?.mode === "POST_EVENT_ATTRIBUTION") {
    return {
      ...result,
      label: "保持当前设置，等待活动归因成熟",
      reasons: [
        ...result.reasons,
        `活动峰值回落需与常规期分开判断；归因成熟日 ${input.eventContext.attributionMaturesOn || "待确认"}`,
      ],
      warnings: [...result.warnings, "活动后窗口不使用峰值日表现追量，也不把自然回落直接归因于广告失效"],
    };
  }

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
  const weeklyLoss = input.current.spend >= 20;
  const rollingLoss = input.rolling28d.spend >= 20;
  const belowProfit = (weeklyLoss || rollingLoss)
    && input.current.wscRoas < input.breakEvenRoas
    && input.rolling28d.wscRoas < input.breakEvenRoas;
  if (weakNoOrder || belowProfit) {
    const revenueProducing = input.current.orders > 0 || input.rolling28d.orders > 0;
    const rate = weakNoOrder ? 0.15 : revenueProducing ? 0.10 : 0.15;
    return stagedBid(input, result, rate, weakNoOrder
      ? `成熟数据${input.current.clicks}次点击0单，单次最多下调15%`
      : rollingLoss && !weeklyLoss
        ? `成熟28天累计花费$${input.rolling28d.spend.toFixed(0)}且当前周与28天均低于保本线，单次最多下调${Math.round(rate * 100)}%`
        : `当前周和成熟28天均低于保本线，单次最多下调${Math.round(rate * 100)}%`);
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
