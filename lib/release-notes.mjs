const RELEASE_DATE = "2026-07-28";

export const RELEASE_NOTES = Object.freeze({
  version: "0.2.2",
  releaseDate: RELEASE_DATE,
  generatedAt: "2026-07-29T18:25:52+08:00",
  productionBaseline: "2ac14c5",
  title: "系统功能与逻辑升级日报 · 2026-07-28",
  conclusion: "昨日完成 6 个系统模块和 6 组核心判断逻辑升级；本次重跑已补齐财务汇款明细、今日经营快照和最新生产验证。系统现在能直接呈现可核对的金额、扣款、发票和任务终态，同时继续约束高风险写入。",
  git: {
    branch: "deploy",
    commits: 88,
    firstCommitAt: "2026-07-28T00:05:47+08:00",
    baselineReleasedAt: "2026-07-29T18:25:52+08:00",
  },
  systemSummary: {
    featureAreas: 6,
    logicUpgrades: 6,
    commits: 88,
    tests: 316,
  },
  systemUpgrades: [
    {
      area: "01 · 邮件与订单情报",
      title: "订单、回款和日报改为结构化信息",
      detail: "订单邮件提取订单号、SKU、商品、数量和金额；回款 CSV 提取实际汇款、付款日期、方式、发票原值和各类扣款；服务器每两小时生成 Outlook 日报快照。",
      outcome: "财务摘要可直接核对 USD 565.88 实际汇款及 5 张发票，不再停留在“待邮件同步”。",
    },
    {
      area: "02 · 商品经营与上新",
      title: "商品审计与 Product Addition V2 进入生产工作台",
      detail: "新增版本化商品经营审计、角色分层、生产访问证据，以及 Product Addition V2 的类目属性、批量限制、品牌命名空间和状态轮询。",
      outcome: "新品只有在图片、必填属性、Catalog 状态和生产访问证据完整时才进入下一步。",
    },
    {
      area: "03 · 库存与数据完整性",
      title: "库存更新从文件成功升级为 Wayfair 终态成功",
      detail: "建立完整 Part × Warehouse TRUE_UP 基线，补齐缺失零库存行，并修正 dry-run 回执解析，将批次提交、处理中、终态回执和生效回读拆开记录。",
      outcome: "HTTP 200、空回执或部分批次不再被误判为库存已更新。",
    },
    {
      area: "04 · 广告决策模型",
      title: "广告影子模型接入真实成本、定向和实时安全信号",
      detail: "模型按 Campaign/Listing 粒度继承定向，使用认证 USD 成本、成熟归因窗口、库存覆盖、Catalog 证据和近期异常信号。",
      outcome: "系统能区分观察、修复、降价、暂停和放量候选，同时禁止把短期波动直接转成生产动作。",
    },
    {
      area: "05 · 8 月经营计划",
      title: "150 单利润组合、促销提报和广告预算形成一套计划",
      detail: "完成 Part 级促销复核、数量折扣、周里程碑、阶段广告上限、Listing 预算和特殊毛利例外，并同步后台已提交状态。",
      outcome: "促销、广告和 SKU 目标共享同一授权来源，避免预算重复计算和活动重复控制。",
    },
    {
      area: "06 · 闭环与生产安全",
      title: "操作账本、终态验收和生产防护统一落地",
      detail: "新增操作状态机、事件账本、执行证据、验收人、复盘结论和回滚链接；补充广告手工验收提交、转发 Origin 识别和服务器日报生成兜底。",
      outcome: "任务不能仅凭按钮点击关闭；日报、执行结果和验收证据都能在生产服务器上持续追溯。",
    },
  ],
  logicUpgrades: [
    {
      title: "完成态必须来自终态回执",
      before: "请求成功或返回空批次时可能被视为完成。",
      after: "只有所有批次形成 Wayfair 成功终态，并通过数量与状态校验，才标记完成。",
      impact: "消除库存和执行任务的伪完成。",
    },
    {
      title: "完整基线优先于差量猜测",
      before: "只处理文件中出现的库存行，容易遗漏仓库或零库存组合。",
      after: "先构建全部活跃 Part × Warehouse 基线，缺失组合明确补零，再计算差量。",
      impact: "避免历史库存残留和仓库漂移。",
    },
    {
      title: "证据新鲜度进入缓存与执行判断",
      before: "旧 Catalog、库存或活动缓存可能继续影响新决策。",
      after: "证据按作用域设置新鲜度 SLA，映射和活动授权变化会主动失效相关分析缓存。",
      impact: "降低旧证据覆盖新事实的概率。",
    },
    {
      title: "目录、利润和 Canary 亏损改为硬 Gate",
      before: "高销量或高历史 ROAS 可能掩盖目录冲突与利润不足。",
      after: "Catalog 冲突一律 fail closed；贡献底线和最大增量亏损在模型与执行层同时校验。",
      impact: "增长目标不能绕过可售资格和利润底线。",
    },
    {
      title: "授权计划成为唯一控制源",
      before: "促销、数量折扣和广告模型可能各自生成互相冲突的控制。",
      after: "广告优化只读取已验证的 8 月授权计划，并识别已执行、已暂停和不可重复控制状态。",
      impact: "避免整组误停、重复暂停和预算过度收紧。",
    },
    {
      title: "执行闭环从勾选升级为状态机",
      before: "本地勾选或“已执行”文字可以掩盖缺少证据和复盘的问题。",
      after: "任务必须依次经过执行、待验收、已验证、待复盘和关闭；失败、重开与回滚均保留事件。",
      impact: "完成、失败和待复盘不再混为一类。",
    },
  ],
  production: {
    domain: "aiwayfair.sunnysdady.com",
    platform: "DigitalOcean Droplet · codex-calm-forge-8d48",
    health: "200 OK",
    anonymousHome: "401 Protected",
    scheduler: "RUNNING",
  },
  outlook: {
    syncedAt: "2026-07-29T10:25:52.582Z",
    total: 5,
    unread: 2,
    actionRequired: 5,
    highestPriority: "P1",
  },
  finance: {
    remittanceId: "10002005965230",
    currency: "USD",
    actualAmount: 565.88,
    paymentDate: "2026-07-31",
    paymentMethod: "Bank transfer",
    grossInvoiceValue: 602,
    qualityDeduction: -24.08,
    earlyPayDiscount: -12.04,
    serviceFee: 0,
    invoiceCount: 5,
  },
  dailyRun: {
    generatedAt: "2026-07-29T10:25:52.582Z",
    orders: 2,
    units: 2,
    revenue: 171,
    adSpend: 0.59,
    contributionAfterAds: 56.51,
    monthOrders: 53,
    completedManualAds: 10,
    remainingManualAds: 0,
    adsDataLayer: "POSTGRESQL_REPORT_ROWS",
  },
  operations: {
    total: 25,
    closed: 10,
    pendingAcceptance: 15,
    pendingReview: 0,
    failed: 0,
  },
  followUps: [
    "复核 PostgreSQL 持久快照中的 6 个广告风险 Campaign；当前数据层并非新鲜广告 API 回读，不能据此直接改 Bid。",
    "广告写入 Gate 已按授权开启，但每次真实 Bid 调整仍须提供动作清单、dry-run、校验规则和独立确认。",
    "继续处理 15 项非终态任务并补齐证据，但不把业务任务数量作为系统升级日报的主指标。",
    "持续核对 Scheduler、订单、广告、Catalog、库存和日报同步，确认新逻辑在真实数据下保持 fail closed。",
  ],
});

export function validateReleaseNotes(release) {
  if (!release || typeof release !== "object") throw new Error("版本记录不能为空");
  if (!/^\d+\.\d+\.\d+$/.test(String(release.version || ""))) throw new Error("版本号必须使用 SemVer");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(release.releaseDate || ""))) throw new Error("发布日期无效");
  if (release.releaseDate !== RELEASE_DATE) throw new Error("日终版本日期不匹配");
  if (!/^[0-9a-f]{7,40}$/.test(String(release.productionBaseline || ""))) throw new Error("功能汇总基线提交无效");
  for (const [label, value] of Object.entries({
    commits: release.git?.commits,
    featureAreas: release.systemSummary?.featureAreas,
    logicUpgrades: release.systemSummary?.logicUpgrades,
    tests: release.systemSummary?.tests,
    outlookTotal: release.outlook?.total,
    outlookUnread: release.outlook?.unread,
    outlookActionRequired: release.outlook?.actionRequired,
    invoiceCount: release.finance?.invoiceCount,
    dailyOrders: release.dailyRun?.orders,
    dailyUnits: release.dailyRun?.units,
    monthOrders: release.dailyRun?.monthOrders,
    completedManualAds: release.dailyRun?.completedManualAds,
    remainingManualAds: release.dailyRun?.remainingManualAds,
    operationTotal: release.operations?.total,
  })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label}必须是非负整数`);
  }
  if (release.systemSummary.commits !== release.git.commits) throw new Error("系统摘要与 Git 提交数不一致");
  if (release.systemUpgrades?.length !== release.systemSummary.featureAreas) throw new Error("系统功能模块数量不一致");
  if (release.logicUpgrades?.length !== release.systemSummary.logicUpgrades) throw new Error("核心逻辑升级数量不一致");
  for (const [label, value] of Object.entries({
    actualAmount: release.finance?.actualAmount,
    grossInvoiceValue: release.finance?.grossInvoiceValue,
    qualityDeduction: release.finance?.qualityDeduction,
    earlyPayDiscount: release.finance?.earlyPayDiscount,
    serviceFee: release.finance?.serviceFee,
    dailyRevenue: release.dailyRun?.revenue,
    dailyAdSpend: release.dailyRun?.adSpend,
    contributionAfterAds: release.dailyRun?.contributionAfterAds,
  })) {
    if (!Number.isFinite(value)) throw new Error(`${label}必须是有效数字`);
  }
  const operationSum = Number(release.operations.closed)
    + Number(release.operations.pendingAcceptance)
    + Number(release.operations.pendingReview)
    + Number(release.operations.failed);
  if (operationSum !== release.operations.total) throw new Error("闭环任务状态合计不一致");
  if (!Array.isArray(release.followUps) || release.followUps.length < 1) throw new Error("后续待办不能为空");
  return release;
}
