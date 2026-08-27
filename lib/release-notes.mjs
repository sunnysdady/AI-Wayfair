const RELEASE_DATE = "2026-08-27";

export const RELEASE_NOTES = Object.freeze({
  version: "0.3.0",
  releaseDate: RELEASE_DATE,
  generatedAt: "2026-08-27T14:48:12+08:00",
  productionBaseline: "ea625249033f5c4c1847aa18513b28011f70906d",
  title: "产品属性评分工作台与规则修复 · 2026-08-27",
  conclusion: "产品属性信息、Wayfair 规则完成度评分、缺失项提示和证据闭环已进入生产；刷新状态规则问题已修复。全量测试、构建和生产健康检查通过，正式 Product Addition 写入继续默认关闭。",
  git: {
    branch: "codex/assistant-intent-query",
    commits: 4,
    firstCommitAt: "2026-08-27T13:46:35+08:00",
    baselineReleasedAt: "2026-08-27T14:40:12+08:00",
  },
  systemSummary: {
    featureAreas: 3,
    logicUpgrades: 4,
    commits: 4,
    tests: 364,
  },
  managementBrief: {
    completed: [
      "上线商品属性详情与 Wayfair 属性规则发现能力，支持按 SKU 查看必填、推荐、数据类型、候选值和当前值。",
      "上线属性完成度评分、问题分级与修复提示，明确区分硬阻断项和建议完善项。",
      "将评分结果写入操作闭环，保存 assessment ID、规则指纹、载荷指纹和各阶段证据。",
      "修复 SKU 刷新状态在 React 更新器内二次更新的问题，并完成统一版面优化。",
    ],
    results: [
      "全量测试 364/364 通过，Next.js 生产构建通过。",
      "源码 ESLint 为 0 个错误；仅保留 2 个既有警告。",
      "DigitalOcean Web、Scheduler 和 PostgreSQL 正常，公开健康检查返回 200。",
      "匿名首页、产品评分页和 Product Addition API 均返回 401，访问保护生效。",
    ],
    blockers: [
      "Wayfair Product Addition V2 正式生产提交仍受环境 Gate 保护，本版本未开启自动写入。",
      "首期单次评分最多 100 个商品，并要求同一批商品属于同一 Class。",
      "条件属性的最终判定仍以 Wayfair validateOnly 回执为准，本地评分不替代官方校验。",
    ],
    assistance: [
      "当前无需新增授权即可使用属性查看、系统评分和问题提示。",
      "如需开启 Product Addition 正式写入，必须另行批准生产 Gate，并先通过 validateOnly 与回读验收。",
      "如 Wayfair 调整类目规则或权限，需要重新发现规则并生成新的规则指纹后再评分。",
    ],
    tomorrow: [
      "持续观察属性规则发现、评分和闭环写入在真实 SKU 上的稳定性。",
      "补充更多 Class 的规则样本，核对候选值、数据类型和推荐属性提示。",
      "在不打开正式写入的前提下，继续验证 validateOnly、状态轮询和异常回执。",
      "跟踪 Wayfair Product Addition V2 生产权限同步结果，并保留工单证据。",
    ],
  },
  systemUpgrades: [
    {
      area: "01 · 属性信息",
      title: "商品属性与 Wayfair 规则同屏展示",
      detail: "工作台按 SKU 展示当前属性值，并关联 Wayfair 类目规则中的必填性、推荐性、数据类型、多值限制和候选值要求。",
      outcome: "运营人员可以直接看到商品已填内容、规则要求和缺失位置，不必在多个页面之间比对。",
    },
    {
      area: "02 · 合规评分",
      title: "属性完成度评分与修复建议",
      detail: "系统按必填完整度 60%、可观察值有效性 25%、推荐完整度 10% 和身份字段完整度 5% 计算完成度，并输出问题级别与建议。",
      outcome: "每个问题都包含 attributeId、原因和修复提示；缺失必填、类型错误和非法候选值会形成硬阻断。",
    },
    {
      area: "03 · 关联闭环",
      title: "评分、证据与操作状态形成闭环",
      detail: "评分动作保存 assessment ID、规则指纹、载荷指纹和操作事件，并按发现、评估、待处理、验证与关闭阶段留痕。",
      outcome: "页面结论可以追溯到规则和输入，不再出现评分、操作和验收相互脱节。",
    },
  ],
  logicUpgrades: [
    {
      title: "评分口径与 Wayfair 官方校验分离",
      before: "页面容易把内部完成度理解为 Wayfair 官方评分或批准结果。",
      after: "明确标注为系统评估；正式合规结论仍以 Wayfair validateOnly 和状态回执为准。",
      impact: "避免用内部评分替代官方校验或误触生产提交。",
    },
    {
      title: "必填缺失与推荐缺失分级处理",
      before: "所有缺失项可能被同等展示，无法判断是否阻断提交。",
      after: "必填缺失、类型错误和非法值进入硬阻断；推荐缺失只降低评分并给出改进提示。",
      impact: "运营人员能先处理影响提交的关键问题，再补充优化项。",
    },
    {
      title: "评分结论绑定规则与载荷指纹",
      before: "属性或规则更新后，旧评分缺少可验证的输入版本。",
      after: "每次评估生成稳定 ID，并同时记录规则指纹和载荷指纹。",
      impact: "规则变化、商品变化和重复评估均可审计、可比较。",
    },
    {
      title: "刷新状态只在事件边界更新",
      before: "SKU 刷新完成状态在 React 状态更新器内部再次更新，触发规则检查问题。",
      after: "刷新状态清理移动到点击事件的 finally 阶段，状态更新器保持纯函数。",
      impact: "消除渲染期副作用风险，保持刷新交互和页面状态稳定。",
    },
  ],
  production: {
    domain: "aiwayfair.sunnysdady.com",
    platform: "DigitalOcean Droplet · codex-calm-forge-8d48",
    health: "200 OK",
    anonymousHome: "401 Protected",
    protectedProductPage: "401 Protected",
    protectedProductAdditionApi: "401 Protected",
    web: "HEALTHY",
    scheduler: "RUNNING",
    database: "HEALTHY",
    imageTag: "ea625249033f",
  },
  verification: {
    testsPassed: 364,
    testsFailed: 0,
    build: "PASS",
    lintErrors: 0,
    lintWarnings: 2,
    logs: "No fatal, uncaught, unhandled or error events",
  },
  guardrails: {
    liveSubmit: "OFF (default)",
    assessmentWriteScope: "仅写操作闭环，不写 Wayfair 商品",
    maxProductsPerAssessment: 100,
    classScope: "首期仅支持同一 Class 的商品批次",
  },
  followUps: [
    "观察真实 SKU 的规则发现与评分结果，优先修复硬阻断项并保留前后评分证据。",
    "继续用 validateOnly 验证条件属性和 Wayfair 服务端规则，不以本地高分直接推断可提交。",
    "正式 Product Addition 写入继续保持关闭，待生产权限、dry-run、回读和回滚方案全部验收后再单独批准。",
    "每次 Wayfair 规则变化后重新生成规则指纹，防止旧评分覆盖新规则。",
  ],
});

export function validateReleaseNotes(release) {
  if (!release || typeof release !== "object") throw new Error("版本记录不能为空");
  if (!/^\d+\.\d+\.\d+$/.test(String(release.version || ""))) throw new Error("版本号必须使用 SemVer");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(release.releaseDate || ""))) throw new Error("发布日期无效");
  if (release.releaseDate !== RELEASE_DATE) throw new Error("版本日期不匹配");
  if (!/^[0-9a-f]{7,40}$/.test(String(release.productionBaseline || ""))) throw new Error("功能汇总基线提交无效");
  for (const [label, value] of Object.entries({
    commits: release.git?.commits,
    featureAreas: release.systemSummary?.featureAreas,
    logicUpgrades: release.systemSummary?.logicUpgrades,
    tests: release.systemSummary?.tests,
    testsPassed: release.verification?.testsPassed,
    testsFailed: release.verification?.testsFailed,
    lintErrors: release.verification?.lintErrors,
    lintWarnings: release.verification?.lintWarnings,
    maxProductsPerAssessment: release.guardrails?.maxProductsPerAssessment,
  })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label}必须是非负整数`);
  }
  if (release.systemSummary.commits !== release.git.commits) throw new Error("系统摘要与 Git 提交数不一致");
  if (release.systemSummary.tests !== release.verification.testsPassed) throw new Error("系统摘要与通过测试数不一致");
  if (release.systemUpgrades?.length !== release.systemSummary.featureAreas) throw new Error("系统功能模块数量不一致");
  if (release.logicUpgrades?.length !== release.systemSummary.logicUpgrades) throw new Error("核心逻辑升级数量不一致");
  for (const [label, items] of Object.entries(release.managementBrief || {})) {
    if (!Array.isArray(items) || !items.length || items.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`${label}管理摘要不能为空`);
    }
  }
  if (Object.keys(release.managementBrief || {}).length !== 5) throw new Error("管理摘要必须包含五个部分");
  for (const [groupLabel, group] of Object.entries({
    production: release.production,
    verification: release.verification,
    guardrails: release.guardrails,
  })) {
    if (!group || Object.values(group).some((value) => value === "" || value === null || value === undefined)) {
      throw new Error(`${groupLabel}记录不完整`);
    }
  }
  if (!Array.isArray(release.followUps) || release.followUps.length < 1) throw new Error("后续待办不能为空");
  return release;
}
