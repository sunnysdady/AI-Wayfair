export const NEW_PRODUCT_PROMOTION_RULE_ID = "NEW_PRODUCT_PROMOTION_V1";

const MINIMUM_IMAGE_COUNT = 3;
const MISSING_IMAGE_PATTERN = /missing\s+(?:product\s+)?images?|images?\s+(?:are\s+)?missing|缺图|图片(?:缺失|不全)/i;
const MISSING_ATTRIBUTE_PATTERN = /missing\s+required\s+(?:info|information|attributes?)|required\s+(?:info|information|attributes?).*missing|缺少.*(?:必填|必要).*(?:信息|属性)|(?:必填|必要).*(?:信息|属性).*缺失/i;

function catalogSignals(insights = {}) {
  return ["problems", "warnings", "opportunities"]
    .flatMap((group) => Array.isArray(insights?.[group]) ? insights[group] : [])
    .map((item) => [
      item?.title,
      item?.explanation,
      item?.insightTypeId,
      item?.resolution?.description,
    ].filter(Boolean).join(" "));
}

function normalizedCoverage(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1 ? numeric / 100 : numeric;
}

function contentReadiness(item, signals) {
  const imageCount = Number(item?.contentHealth?.imageCount);
  const attributeCoverage = normalizedCoverage(
    item?.contentHealth?.requiredAttributeCoverage,
  );
  const hasExplicitImageCount = Number.isFinite(imageCount);
  const hasExplicitAttributeCoverage = attributeCoverage !== null;
  const hasMissingImageIssue = signals.some((signal) => MISSING_IMAGE_PATTERN.test(signal));
  const hasMissingAttributeIssue = signals.some((signal) => MISSING_ATTRIBUTE_PATTERN.test(signal));

  return {
    imagesComplete: hasExplicitImageCount
      ? imageCount >= MINIMUM_IMAGE_COUNT && !hasMissingImageIssue
      : !hasMissingImageIssue,
    attributesComplete: hasExplicitAttributeCoverage
      ? attributeCoverage >= 1 && !hasMissingAttributeIssue
      : !hasMissingAttributeIssue,
    imageCount: hasExplicitImageCount ? imageCount : null,
    requiredAttributeCoverage: hasExplicitAttributeCoverage ? attributeCoverage : null,
    contentEvidence: hasExplicitImageCount && hasExplicitAttributeCoverage
      ? "EXPLICIT_CONTENT_METRICS"
      : "CATALOG_NO_MISSING_ISSUES_PROXY",
  };
}

function promotionSteps() {
  return [
    {
      order: 1,
      action: "VERIFY_AND_SEND_SAMPLE",
      label: "送测",
      dependsOn: [],
      instruction: "由运营 Agent 核对库存、毛利、合规与平台合规送测/免费样品项目资格；通过后提交送测，并把送测订单与自然订单分开标记。",
      acceptance: "保存平台项目资格、提交记录与送测状态；不得私下激励、操纵或影响客户评价。",
    },
    {
      order: 2,
      action: "LAUNCH_GUARDED_AD_TEST",
      label: "投广告",
      dependsOn: ["VERIFY_AND_SEND_SAMPLE"],
      instruction: "送测步骤已获平台接受或完成后，再通过库存、利润、Catalog 与广告资格 Gate，建立新品独立小预算广告测试。",
      acceptance: "记录 Campaign、Listing、起始 Bid、Daily Cap、保本 ROAS 与 7/14 天复查日期；本规则不自动写入广告。",
    },
    {
      order: 3,
      action: "REVIEW_NEW_PRODUCT_RESULTS",
      label: "复查推广",
      dependsOn: ["LAUNCH_GUARDED_AD_TEST"],
      instruction: "按 7 天观察、14 天成熟窗口复查曝光、点击、转化、广告订单、WSC ROAS、自然订单与库存消耗。",
      acceptance: "送测订单、自然订单和广告归因订单分开记账；达到止损线时暂停扩量并回到 Listing 修复。",
    },
  ];
}

export function evaluateNewProductPromotionSop(item = {}) {
  const signals = catalogSignals(item.insights);
  const evidence = contentReadiness(item, signals);
  const units30d = Number(item?.recent30d?.units || 0);
  const status = String(item?.catalogItemStatus || "").toUpperCase();
  const listingCount = Array.isArray(item?.listings) ? item.listings.length : 0;
  const catalogProblems = Array.isArray(item?.insights?.problems)
    ? item.insights.problems.length
    : 0;
  const blockers = [];

  if (units30d > 0) {
    return {
      ruleId: NEW_PRODUCT_PROMOTION_RULE_ID,
      ruleVersion: 1,
      targetAgent: "OPERATIONS_AGENT",
      priority: "P1",
      status: "NOT_APPLICABLE",
      recommendation: "该商品近 30 天已有销量，不进入零销量新品推新 SOP。",
      evidence: { ...evidence, units30d, catalogStatus: status, listingCount, catalogProblems },
      blockers: ["近 30 天已有销量，不属于零销量新品候选"],
      steps: [],
      automaticExecution: false,
    };
  }

  if (status !== "LIVE") blockers.push("商品尚未达到 LIVE 状态");
  if (listingCount < 1) blockers.push("商品尚无可推广 Listing");
  if (!evidence.imagesComplete) blockers.push(`图片未齐全：至少需要 ${MINIMUM_IMAGE_COUNT} 张合格图片且无 Missing Images 信号`);
  if (!evidence.attributesComplete) blockers.push("属性未齐全：Required Attribute Coverage 必须为 100% 且无 Missing Required Info 信号");
  if (catalogProblems > 0) blockers.push(`Catalog 仍有 ${catalogProblems} 个问题，需先解除合规或上线风险`);

  return {
    ruleId: NEW_PRODUCT_PROMOTION_RULE_ID,
    ruleVersion: 1,
    targetAgent: "OPERATIONS_AGENT",
    priority: "P1",
    status: blockers.length ? "BLOCKED" : "RECOMMENDED",
    recommendation: blockers.length
      ? "先补齐商品上线与内容条件，再进入推新。"
      : "图片与属性已齐全，建议运营 Agent 先走平台合规送测，再通过广告 Gate 启动新品推广。",
    evidence: { ...evidence, units30d, catalogStatus: status, listingCount, catalogProblems },
    blockers,
    steps: blockers.length ? [] : promotionSteps(),
    automaticExecution: false,
  };
}
