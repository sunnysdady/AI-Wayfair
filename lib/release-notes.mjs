const RELEASE_DATE = "2026-07-28";

export const RELEASE_NOTES = Object.freeze({
  version: "0.2.0",
  releaseDate: RELEASE_DATE,
  generatedAt: "2026-07-28T18:47:24+08:00",
  productionBaseline: "c80d48e",
  title: "2026-07-28 日终收尾",
  conclusion: "今日代码与生产发布已收口；Outlook 日报已刷新。业务闭环台仍有 42 项非终态记录，须按验收、复盘和失败重开流程继续处理。",
  git: {
    branch: "deploy",
    commits: 66,
    firstCommitAt: "2026-07-28T00:05:47+08:00",
    baselineReleasedAt: "2026-07-28T18:40:13+08:00",
  },
  production: {
    domain: "aiwayfair.sunnysdady.com",
    platform: "DigitalOcean Droplet · codex-calm-forge-8d48",
    health: "200 OK",
    anonymousHome: "401 Protected",
    scheduler: "RUNNING",
  },
  outlook: {
    syncedAt: "2026-07-28T18:47:24+08:00",
    total: 14,
    unread: 6,
    actionRequired: 14,
    highestPriority: "P1",
  },
  operations: {
    total: 45,
    closed: 3,
    pendingAcceptance: 11,
    pendingReview: 10,
    failed: 21,
  },
  highlights: [
    {
      area: "订单与日报",
      title: "订单、回款邮件改为结构化预览",
      detail: "补全商品明细、汇款信息与 Outlook 日报分类，日终快照已由服务器端同步。",
    },
    {
      area: "商品与库存",
      title: "库存完成态改为真实 Wayfair 回执",
      detail: "拒绝空回执和伪完成；完整构建 Part × Warehouse 基线，并补强同步完整性检查。",
    },
    {
      area: "Product Addition",
      title: "新产品 V2 流程进入受控闭环",
      detail: "实现 V2 客户端、状态轮询、批量上限、品牌命名空间与生产访问证据门禁。",
    },
    {
      area: "广告决策",
      title: "影子模型接入可审计成本与活动控制",
      detail: "继承 Campaign 定向，连接 SKU 成本，加入目录冲突、利润底线与 Canary 止损。",
    },
    {
      area: "8 月计划",
      title: "150 单利润组合与促销方案完成授权联动",
      detail: "活动提报、数量折扣、预算锁定与广告优化共享同一授权计划，避免重复或过度控制。",
    },
    {
      area: "闭环与安全",
      title: "操作任务必须有证据、验收和复盘",
      detail: "新增操作账本、终态回执和回滚路径；生产浏览器安全头、时间戳与瞬态读取重试同步加固。",
    },
  ],
  followUps: [
    "处理 6 封未读 Wayfair 邮件；14 项邮件待办的最高优先级为 P1。",
    "对 11 项 PENDING_ACCEPTANCE 补齐验收证据并决定是否进入 VERIFIED。",
    "完成 10 项 PENDING_REVIEW 的效果复盘，只有形成结论后才可关闭。",
    "逐项复核 21 项 FAILED：确认重开、回滚或保留失败证据，禁止批量改成已完成。",
  ],
});

export function validateReleaseNotes(release) {
  if (!release || typeof release !== "object") throw new Error("版本记录不能为空");
  if (!/^\d+\.\d+\.\d+$/.test(String(release.version || ""))) throw new Error("版本号必须使用 SemVer");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(release.releaseDate || ""))) throw new Error("发布日期无效");
  if (release.releaseDate !== RELEASE_DATE) throw new Error("日终版本日期不匹配");
  if (!/^[0-9a-f]{7,40}$/.test(String(release.productionBaseline || ""))) throw new Error("生产基线提交无效");
  for (const [label, value] of Object.entries({
    commits: release.git?.commits,
    outlookTotal: release.outlook?.total,
    operationTotal: release.operations?.total,
  })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label}必须是非负整数`);
  }
  const operationSum = Number(release.operations.closed)
    + Number(release.operations.pendingAcceptance)
    + Number(release.operations.pendingReview)
    + Number(release.operations.failed);
  if (operationSum !== release.operations.total) throw new Error("闭环任务状态合计不一致");
  if (!Array.isArray(release.highlights) || release.highlights.length < 1) throw new Error("版本亮点不能为空");
  if (!Array.isArray(release.followUps) || release.followUps.length < 1) throw new Error("后续待办不能为空");
  return release;
}
