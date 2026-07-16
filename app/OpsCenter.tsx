"use client";

import { useEffect, useMemo, useState } from "react";
import { invalidateClientCache, readClientCache, writeClientCache } from "../lib/client-cache";

type View = "daily" | "plan" | "inventory" | "ads" | "review" | "catalog" | "sources";

const NAV: { id: View; label: string; meta: string }[] = [
  { id: "daily", label: "日报", meta: "今天" },
  { id: "plan", label: "运营计划", meta: "本月" },
  { id: "inventory", label: "库存更新", meta: "Gate" },
  { id: "ads", label: "广告优化", meta: "每周" },
  { id: "review", label: "月度复盘", meta: "资料" },
  { id: "catalog", label: "商品数据", meta: "V2" },
  { id: "sources", label: "数据源", meta: "6/6" },
];

type OrderMetric = { revenue: number; orders: number; units: number; aov: number; advertisingBeforeGrossProfit: number; contributionAfterAds: number | null; advertisingSpend: number | null; advertisingCoverage: string; profitMode: "estimated" | "cost-covered"; costCoverage: number; marginRate: number };
type OrderSummary = {
  current: OrderMetric;
  previous: OrderMetric;
  daily: { date: string; revenue: number; orders: number; units: number }[];
  topSkus: { partNumber: string; revenue: number; units: number }[];
  sync: { syncedAt?: string; refreshed?: boolean; stale?: boolean; error?: string };
  error?: string;
};

type CatalogInsight = { insightId?: string; title?: string; explanation?: string; monthsInViolation?: number; expirationDate?: string; resolution?: { url?: string; description?: string } };
type CatalogItem = {
  supplierPartNumber: string;
  catalogItemStatus?: string;
  class?: { classId?: string; className?: string };
  marketContext?: { locale?: string; country?: string; brand?: string; channel?: string; segment?: string; location?: string };
  listings?: { listingId?: string }[];
  insights?: { problems?: CatalogInsight[]; warnings?: CatalogInsight[]; opportunities?: CatalogInsight[] };
  recent30d?: { units: number; revenue: number };
};
type CatalogResponse = { items?: CatalogItem[]; paginationInfo?: { page: number; totalPages: number; totalCount: number; hasNextPage: boolean }; error?: string };

type AdMetric = { impressions: number; clicks: number; spend: number; orders: number; units: number; wsc: number; ctr: number; cvr: number; wscRoas: number };
type AdListing = {
  listing: string; campaignId: string; campaignName: string; site: string; parts: string[]; bid: number; status: string;
  current: AdMetric; previous: AdMetric;
  plan: null | { budget: number; augustUnits?: number; julyTargetOrders?: number; role: string; gate: string; eligible: boolean; adRole: string; rating?: number; reviews?: number };
  economics: { marginRate: number; marginMode: string; breakEvenRoas: number };
  linkQuality: { rating: number | null; reviews: number | null; pass: boolean; source: string };
  inventory: { known: boolean; coverDays: number | null; quantityOnHand: number; snapshotAt: string | null };
  action: { type: string; label: string; recommendation: string; execution: string; confidence: string; reasons: string[]; blockers: string[]; warnings: string[]; before: Record<string, unknown>; proposed: Record<string, unknown> };
};
type AdAnalysis = {
  current: AdMetric; previous: AdMetric; history: ({ date: string } & AdMetric)[]; listings: AdListing[];
  range: { start: string; end: string; previousStart: string; previousEnd: string; asOf: string; matureThrough: string; mature: boolean };
  decisionRange: { start: string; end: string; previousStart: string; previousEnd: string; cadence: string; rule: string };
  runKey: string; generatedAt: string; attributionWindowDays: number; cache?: { hit?: boolean; layer?: string; updatedAt?: string }; safety: { reason: string }; error?: string;
};
type PlanProgress = {
  plan: { month: string; orderTarget: number; baselineOrders: number; floorOrders: number; stretchOrders: number; adBudget: number; estimatedNetProfit: number; source: string; sourceAsOf: string; scopeWarning: string };
  currentOperatingMonth: { month: string; targetStatus: string; note: string }; status: string; asOf: string;
  actual: { orders: number; units: number; revenue: number; adSpend: number | null; adCoverage: string; grossProfitBeforeAds: number; contributionAfterAds: number | null; costCoverage: number };
  progress: { elapsedDays: number; totalDays: number; timeProgress: number; orderCompletion: number; expectedOrders: number; paceGap: number; forecastOrders: number; remainingOrders: number; requiredDailyOrders: number };
  listings: { listing: string; parts: string[]; juneBaselineOrders: number; julyTargetOrders: number; actualOrders: number; actualUnits: number; actualRevenue: number; budget: number; estimatedNetProfit: number; role: string; gate: string; tactic?: string; sourceWarning?: string }[];
  events: { label: string; range: string; note: string }[];
  activity: { name: string; officialEventRange: string; canadaCoInvestRange: string; flashDealRange: string; flashConfirmationDeadline: string; catalogLockRange: string; strategyBudget: number; monthlyBudget: number; budgetNote: string; source: string; sourceAsOf: string; activePhase: string; phases: { id: string; label: string; range: string; budgetCap: number; bidRule: string; capRule: string; objective: string }[] };
  nextPlan: { plan: { unitTarget: number; baseAdBudget: number; hardAdCap: number; sourceAsOf: string; scopeWarning: string }; listings: { listing: string; parts: string[]; juneUnits: number; augustUnits: number; actualUnits: number; budget: number; role: string; gate: string }[]; milestones: { label: string; range: string; cumulative: number; note: string }[] };
  error?: string;
};

const presetOptions = [
  ["today", "今天"], ["yesterday", "昨天"], ["7d", "最近 7 天"], ["14d", "最近 14 天"],
  ["30d", "最近 30 天"], ["month", "本月"], ["lastMonth", "上个月"], ["custom", "自定义日期"],
] as const;

function dateText(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return dateText(date);
}

function rangeFor(preset: string) {
  const today = dateText(new Date());
  if (preset === "today") return { start: today, end: today };
  if (preset === "yesterday") { const day = shiftDate(today, -1); return { start: day, end: day }; }
  if (["7d", "14d", "30d"].includes(preset)) return { start: shiftDate(today, -(Number(preset.replace("d", "")) - 1)), end: today };
  const [year, month] = today.split("-").map(Number);
  if (preset === "month") return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: today };
  const lastMonth = new Date(Date.UTC(year, month - 2, 1, 12));
  const lastMonthEnd = new Date(Date.UTC(year, month - 1, 0, 12));
  return { start: dateText(lastMonth), end: dateText(lastMonthEnd) };
}

const adPresetOptions = [["matureWeek","成熟周（推荐）"],["7d","最近 7 天"],["14d","最近 14 天"],["month","本月"],["lastMonth","上月"],["custom","自定义"]] as const;

function adRangeFor(preset: string) {
  const today = dateText(new Date());
  if (preset === "matureWeek") { const end = shiftDate(today, -14); return { start: shiftDate(end, -6), end }; }
  if (preset === "7d") return { start: shiftDate(today, -6), end: today };
  if (preset === "14d") return { start: shiftDate(today, -13), end: today };
  if (preset === "month") return { start: `${today.slice(0, 7)}-01`, end: today };
  const [year, month] = today.split("-").map(Number);
  return { start: dateText(new Date(Date.UTC(year, month - 2, 1, 12))), end: dateText(new Date(Date.UTC(year, month - 1, 0, 12))) };
}

function money(value = 0) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function change(current = 0, previous = 0) {
  if (!previous) return current ? "新发生" : "无变化";
  const value = (current - previous) / previous * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}% 较前周期`;
}
type EvidenceReport = { title: string; file: string; kind: string; date?: string; summary: string; metrics?: string[][]; sections: string[][] };
type UploadedReport = { id: string; fileName: string; title: string; kind: string; contentType: string; createdAt: string };
const REPORTS: EvidenceReport[] = [
  { title: "7月推广计划 v3.1 真实基线", file: "Wayfair_7月推广计划_v3真实基线_20260623.html", kind: "当前计划", date: "2026/06/23", summary: "以6月真实基线制定7月128 Orders目标、$790广告预算、SKU责任和活动节奏。", metrics: [["主目标","128 Orders"],["真实基线","102 Orders"],["广告预算","$790"],["预计净利","$3,394"],["冲刺目标","145 Orders"]], sections: [["01","目标阶梯","保底112、主目标128、冲刺145；长尾激活待新产品SOP，不计入承诺目标。"],["02","SKU责任","10个Listing拆解128 Orders；系统用订单API关联实际订单与件数。"],["03","数据冲突","正文基线102、SKU表合计100；DMOM1022正文10单、表格5单，均保留待确认。"],["04","广告联动","月预算、SKU角色、利润与链接Gate直接约束当前广告动作。"]] },
  { title: "Black Friday in July 官宣与广告策略", file: "Wayfair 北美地区 Black Friday in July官宣定档！.pdf", kind: "活动", date: "2026/07/16", summary: "官方活动规则已转成独立阶段策略，活动预算包含在7月$790内。", metrics: [["北美主活动","07/23–07/28"],["Canada Co-Invest","07/23–07/27"],["Flash窗口","07/26–07/27"],["活动广告上限","$330"],["商品锁定","07/21–07/28"]], sections: [["01","资格与费用","Flash Deal须07/17前确认；受邀SKU上线收取$75固定费，必须计入利润。"],["02","投放节奏","资格确认、预热、Member Day衔接、主活动、Flash窗口、收尾六阶段独立预算。"],["03","价格与商品","普通折扣不叠加；Conditional Offer会叠加；商品编辑在07/21–07/28锁定。"],["04","执行护栏","促销、利润、库存、链接和历史ROAS全部通过后，才释放活动Bid与Cap。"]] },
  { title: "8月150单完整增长 Playbook", file: "YB店_8月150单完整增长Playbook.html", kind: "下一计划", date: "2026/07/15", summary: "SKU目标、渠道预算、Campaign、Offer利润、周节奏和Scorecard的下一月计划。", metrics: [["目标口径","150 Units"],["6月基线","90 Units"],["基础预算","$1,800"],["预算硬上限","$2,500"],["WSC ROAS","≥ 3.2×"]], sections: [["01","SKU责任","10个Listing拆解150 Units；DMOM1021/1022/1019承担101件。"],["02","预算结构","基础广告预算$1,800；Keyword $750、Product $650、B2B $150、Canada $50、机动$200。"],["03","周节奏","W1/W2/W3/W4累计目标30/65/105/150；未过Gate不得解锁预算。"],["04","经营护栏","WSC ROAS目标≥3.2×，放量≥4.0×；Fill Rate≥95%，月花费硬上限$2,500。"]] },
  { title: "2026年6月月度复盘总览", file: "index.html", kind: "REVIEW", summary: "6月经营基线、诊断结论和全部复盘证据索引。", sections: [["01","经营基线","6月SKU拆解基线90 Units，为8月150 Units计划提供增量基准。"],["02","核心矛盾","流量并非唯一瓶颈；库存、Catalog、Listing承接和广告结构共同限制增长。"],["03","证据边界","不同报告日期和口径必须保留来源，不用下一月目标冒充当前月目标。"],["04","进入计划","复盘结论已结构化为SKU责任、预算Gate和周里程碑。"]] },
  { title: "店铺诊断报告", file: "YB店_店铺诊断报告.html", kind: "诊断", summary: "店铺增长是否成立、主要瓶颈和优先级判断。", sections: [["01","增长判断","增长成立，但不能靠无差别增加广告预算。"],["02","结构问题","头部SKU贡献集中，长尾商品和低质量链接稀释效率。"],["03","优先级","先修库存与目录，再修链接承接，最后扩广告。"],["04","验收","每项诊断必须落到负责人、期限和可量化验收条件。"]] },
  { title: "SKU健康体检", file: "YB店_SKU健康体检.html", kind: "SKU", summary: "90个Part的销量、Sessions/CVR、评分评论、目录和整改证据。", sections: [["01","商品范围","覆盖90个Supplier Part，不再只展示Catalog当前状态。"],["02","质量维度","Sessions、CVR、评分评论、内容问题、图片和目录状态共同判断链接质量。"],["03","运营分组","区分主力、修复、自然观察和永久剔除池。"],["04","广告联动","链接质量不通过时，只生成整改任务，不允许加Bid或扩预算。"]] },
  { title: "SKU广告重构执行清单", file: "YB店_SKU广告重构执行清单_2026-07-15.html", kind: "广告", summary: "SKU到Campaign/Listing的执行映射、参数和人工动作。", sections: [["01","执行层级","父体用于运营审阅；精确Listing载荷才可进入API Dry-run。"],["02","API边界","Listing Bid/启停可API执行；Daily Cap、tROAS、关键词和否词为人工任务。"],["03","安全机制","一次只改变一个变量，保存前值、建议值、回滚值。"],["04","复查","D7只做安全止损；D21/D28用成熟归因评估结果。"]] },
  { title: "广告深度分析：商品+关键词", file: "YB店_广告深度分析_商品+关键词.html", kind: "广告", summary: "商品广告、关键词、搜索词与归因效率分析。", sections: [["01","历史证据","并列成熟7天、前7天、滚动28天和月累计。"],["02","漏斗","曝光→点击→转化→WSC ROAS逐层定位，不直接用订单数下结论。"],["03","盈利线","每个SKU按贡献毛利计算自己的保本ROAS。"],["04","数据成熟","14天归因未成熟的周期只观察，不进入执行审批。"]] },
  { title: "广告诊断报告", file: "YB店_广告诊断报告.html", kind: "广告", summary: "广告账户问题、止损对象和预算迁移机会。", sections: [["01","账户对账","Campaign与Listing花费需对账后才可信。"],["02","止损","成熟点击≥20且0单进入暂停或降Bid候选。"],["03","扩量","盈利、质量、库存、计划和预算余量全部通过才放量。"],["04","禁止项","计划预算为0或永久剔除对象禁止任何加价。"]] },
  { title: "150单SKU与广告预算分配论证", file: "YB店_150单SKU与广告预算分配论证_2026-07-15.html", kind: "预算", summary: "为什么给每个SKU目标与预算，以及释放边界。", sections: [["01","主力","DMOM1021目标50、预算$700；DMOM1022目标30、预算$340。"],["02","赢家","DMOM1019目标21、预算$290，以高效Keyword为主。"],["03","修复池","DMOM1018/1017/1000合计预算仅$50，严格Gate。"],["04","零预算池","DMOM1025/1026/1016与DRCI1007不得用广告救量。"]] },
  { title: "Conditional Offers 8月计划", file: "YB店_ConditionalOffers_8月150单增长计划.html", kind: "OFFER", summary: "Offer候选、利润底线、实验组与退出条件。", sections: [["01","盈利口径","WSC收入减出库成本、Offer Owed、广告和其他变动成本。"],["02","实验原则","A/B/C小流量验证；无增量或毛利<20%立即结束。"],["03","目标","Offer约20单，但不能以牺牲毛利换完成率。"],["04","归因","价格、Offer和广告同期变化必须记录，避免错误归因。"]] },
  { title: "新增四报前后对比", file: "YB店_新增四报前后对比.html", kind: "证据", summary: "新增报告对既有结论、目标和执行口径的修正。", sections: [["01","变化记录","保留旧结论和新证据，说明为什么修正。"],["02","数据冲突","冲突字段进入待确认，不选择性搬运。"],["03","影响范围","目标、预算、Campaign和SKU责任同步更新。"],["04","审计","每次计划变更保留时间、来源和责任人。"]] },
  { title: "店铺对标：类目均值", file: "YB店_店铺对标_类目均值.html", kind: "对标", summary: "店铺与类目均值在流量、转化和商品结构上的差异。", sections: [["01","用途","对标用于定位差距，不直接生成广告动作。"],["02","流量","曝光分位高但转化弱时，优先修承接。"],["03","转化","评分、评论、价格和内容是CVR诊断上下文。"],["04","目标","用类目基准校验计划是否可达，而非机械追平。"]] },
  { title: "运营ToDoList详细指引", file: "YB店_运营ToDoList_详细指引.html", kind: "任务", summary: "诊断结论到负责人、期限和验收物的运营任务。", sections: [["01","任务化","每项结论都有对象、负责人、截止日和验收物。"],["02","优先级","先处理影响业绩的P0/P1，再处理信息类待办。"],["03","跨模块","库存、商品、广告和月报共享同一任务状态。"],["04","闭环","完成后记录结果并进入下一次复盘证据。"]] },
  { title: "执行清单 XLSX", file: "YB店_SKU广告重构执行清单_2026-07-15.xlsx", kind: "表格", summary: "可下载、核对和执行的SKU广告参数账本。", sections: [["01","精确载荷","保存Listing、Campaign、当前Bid和建议Bid。"],["02","人工动作","Daily Cap、tROAS、关键词与否词分开列示。"],["03","回滚","每个动作保存原值和触发回滚的条件。"],["04","审批","个人测试阶段仅Dry-run，不执行生产写入。"]] },
];

function ShellHeader({ active, onNavigate }: { active: View; onNavigate: (view: View) => void }) {
  return <>
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("daily")}><span>W</span><strong>Wayfair AI</strong><small>运营中台</small></button>
      <div className="workspace"><span>店铺</span><strong>YB店</strong></div>
      <div className="workspace"><span>经营月</span><strong>2026年7月</strong></div>
      <div className="workspace"><span>下一计划</span><strong>2026年8月</strong></div>
      <div className="system"><i></i><span><strong>生产数据已连接</strong><small>写操作保留人工确认</small></span></div>
    </header>
    <nav className="nav" aria-label="主导航">
      {NAV.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onNavigate(item.id)}><span>{item.meta}</span>{item.label}</button>)}
    </nav>
  </>;
}

function Hero({ eyebrow, title, text, side }: { eyebrow: string; title: string; text: string; side?: React.ReactNode }) {
  return <header className="hero"><div><p>{eyebrow}</p><h1>{title}</h1><span>{text}</span></div>{side}</header>;
}

function Daily({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [checked, setChecked] = useState(false);
  const initialRange = rangeFor("today");
  const [preset, setPreset] = useState("today");
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [data, setData] = useState<OrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const cacheKey = `orders:${start}:${end}`;
    const cached = readClientCache<OrderSummary>(cacheKey);
    const controller = new AbortController();
    if (cached) queueMicrotask(()=>{if(!controller.signal.aborted){setData(cached);setLoading(false);setError("");}});
    fetch(`/api/orders/summary?start=${start}&end=${end}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as OrderSummary;
        if (!response.ok) throw new Error(body.error || "订单数据读取失败");
        return body;
      })
      .then((body) => { setData(body); writeClientCache(cacheKey, body); })
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "订单数据读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [start, end]);

  function selectPreset(next: string) {
    setPreset(next);
    if (next !== "custom") { const range = rangeFor(next); if (range.start !== start || range.end !== end) { setLoading(true); setError(""); setStart(range.start); setEnd(range.end); } }
  }

  const current = data?.current;
  const previous = data?.previous;
  const chartMax = Math.max(1, ...(data?.daily || []).map((item) => Number(item.revenue)));
  const rangeLabel = start === end ? start : `${start} — ${end}`;
  return <>
    <Hero eyebrow="ORDERS API · OPERATING BRIEF" title="经营日报" text={`${rangeLabel} · 订单业绩、邮件摘要和运营待办`} side={<div className="hero-side"><b>{loading ? "同步中" : error ? "需检查" : "已更新"}</b><span>{data?.sync.stale ? "正在使用最近缓存" : "Ops API（库存 + 订单）"}</span></div>} />
    <section className="date-console" aria-label="经营周期">
      <div className="preset-list">{presetOptions.map(([id, label]) => <button key={id} className={preset === id ? "active" : ""} onClick={() => selectPreset(id)}>{label}</button>)}</div>
      {preset === "custom" && <div className="custom-range"><label>开始<input type="date" value={start} max={end} onChange={(event) => {setLoading(true);setError("");setStart(event.target.value);}} /></label><label>结束<input type="date" value={end} min={start} onChange={(event) => {setLoading(true);setError("");setEnd(event.target.value);}} /></label></div>}
      <span className={error ? "sync-state error" : "sync-state"}>{error || (data?.sync.stale ? `同步失败，显示缓存：${data.sync.error}` : data?.sync.syncedAt ? `最近同步 ${new Date(data.sync.syncedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "正在连接订单数据")}</span>
    </section>
    <section className="stat-grid six order-kpis">
      {[
        [loading ? "—" : money(current?.revenue), "销售额", change(current?.revenue, previous?.revenue)],
        [loading ? "—" : String(current?.orders || 0), "订单", change(current?.orders, previous?.orders)],
        [loading ? "—" : String(current?.units || 0), "件数", change(current?.units, previous?.units)],
        [loading ? "—" : money(current?.aov), "客单价", change(current?.aov, previous?.aov)],
        [loading ? "—" : money(current?.advertisingBeforeGrossProfit), "广告前商品毛利", `成本覆盖 ${Math.round((current?.costCoverage || 0) * 100)}% · 未覆盖部分按 ${((current?.marginRate || .2826) * 100).toFixed(2)}%估算`],
        [loading ? "—" : current?.contributionAfterAds == null ? "待广告同步" : money(current.contributionAfterAds), "广告后店铺贡献", current?.advertisingSpend == null ? "先到广告优化同步相同周期，不能伪称净利润" : `已扣广告费 ${money(current.advertisingSpend)} · ${current.advertisingCoverage === 'FULL' ? '完整覆盖' : '部分覆盖'}`],
      ].map(([value,label,note]) => <article className={`stat ${/毛利|贡献/.test(label) ? "profit-stat" : ""}`} key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}
    </section>
    <section className="cadence">
      <button onClick={() => onNavigate("daily")}><b>每日</b><span>订单与邮件</span><small>经营日报不触发广告动作</small></button>
      <button onClick={() => onNavigate("ads")}><b>本周</b><span>广告优化</span><small>读取成熟归因周期并生成真实清单</small></button>
      <button onClick={() => onNavigate("review")}><b>本月</b><span>经营复盘</span><small>15 份证据已归档</small></button>
    </section>
    <section className="card order-performance">
      <div className="section-head"><div><span>ORDER PERFORMANCE</span><h2>{rangeLabel} 订单走势</h2></div><b>{data?.sync.refreshed ? "API 已刷新并写入缓存" : "15 分钟缓存 · 增量预载"}</b></div>
      <div className="order-performance-body">
        <div className="daily-bars">{(data?.daily || []).length ? data?.daily.map((item) => <div key={item.date} title={`${item.date} · ${money(item.revenue)} · ${item.orders} 单`}><span>{money(item.revenue)}</span><i style={{ height: `${Math.max(4, Number(item.revenue) / chartMax * 100)}%` }}></i><b>{item.date.slice(5)}</b></div>) : <p>{loading ? "正在拉取订单数据…" : "所选周期暂无订单"}</p>}</div>
        <aside className="top-skus"><span>TOP SKU · 所选周期</span>{(data?.topSkus || []).slice(0, 5).map((item, index) => <div key={item.partNumber}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.partNumber}</strong><small>{item.units} 件</small></span><em>{money(item.revenue)}</em></div>)}{!data?.topSkus?.length && <p>暂无 SKU 销售记录</p>}</aside>
      </div>
    </section>
    <div className="daily-grid">
      <article className="card feature-card">
        <span className="pill amber">需尽快处理 · PERFORMANCE</span>
        <h2>Supplier Scorecard 有 3 项黄色指标</h2>
        <p className="meta">Asia Supplier Service Desk · 2026-07-16 03:47 · 已读</p>
        <p>Wayfair 发送 2026/06 月度供应商绩效卡，需要运营侧审阅并制定整改。当前没有明确罚款或封禁，但库存准确率、首扫/揽收和入库履约需要快速复盘。</p>
        <div className="score-table">
          <div className="head"><b>指标</b><b>当前值</b><b>状态</b><b>目标</b></div>
          {[['DS – SP – OTS','1.96','Yellow','≤ 1.4'],['Induction Fill Rate','89.66%','Yellow','≥ 93%'],['Inventory Inaccuracy Rate','1.45%','Yellow','< 0.51%']].map(row => <div key={row[0]}>{row.map(cell => <span key={cell}>{cell}</span>)}</div>)}
        </div>
        <p><b>建议：</b>今天先定位库存准确率和揽收链路；发货事项转交履约同事，中台只跟踪结果。</p>
        <button className="text-link">在 Outlook 打开原邮件</button>
      </article>
      <aside className="side-stack">
        <article className="card risk-card"><h2>最高风险</h2><div className="risk-number"><strong>3</strong><span>项黄色指标</span></div><p>最高风险来自 Supplier Scorecard，而不是财务扣款或订单异常。优先级高于培训和市场资讯。</p><div className="soft-note"><b>当前无新增：</b>订单取消、退款、退货、扣款、账号权限、合规封禁或产品下架。</div></article>
        <article className="card todo-card"><h2>我的待办</h2><label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /><span><b>审阅 Supplier Scorecard 并制定整改</b><small>负责人：用户本人 · 建议 07-18 前完成</small></span></label><label><input type="checkbox" /><span><b>确认是否参加广告投放 Webinar</b><small>优先级 P3 · 可选待办</small></span></label></article>
      </aside>
    </div>
  </>;
}

function Plan({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [data,setData]=useState<PlanProgress|null>(null); const [error,setError]=useState('');
  const [tab,setTab]=useState<'july'|'bfij'|'august'>('july');
  useEffect(()=>{const cached=readClientCache<PlanProgress>('plan:progress');if(cached){queueMicrotask(()=>setData(cached));return;}fetch('/api/plan/progress').then(async r=>{const body=await r.json() as PlanProgress;if(!r.ok)throw new Error(body.error||'计划读取失败');return body;}).then(body=>{setData(body);writeClientCache('plan:progress',body);}).catch(e=>setError(e.message));},[]);
  const p=data?.progress; const actual=data?.actual;
  return <><Hero eyebrow="MONTHLY OPERATING PLAN" title="目标与执行" text="6月复盘 → 7月真实基线执行 → 8月下一阶段准备；目标、利润与广告共用同一套运营计划" side={<button className="hero-button" onClick={() => onNavigate("review")}>查看完整复盘证据</button>} />
    <section className="context-strip"><div><span>复盘月</span><b>2026-06</b><small>经营事实已归档</small></div><div className="active"><span>当前经营月</span><b>{data?.currentOperatingMonth.month||'2026-07'} · 128 Orders</b><small>{data?.currentOperatingMonth.note||'真实基线计划读取中'}</small></div><div><span>下一计划月</span><b>2026-08 · 150 Units</b><small>准备阶段，不与7月目标混算</small></div></section>
    {error&&<div className="inline-error">{error}</div>}
    <section className="stat-grid six plan-kpis">{[
      [`${actual?.orders||0} / 128`,"7月订单完成",`${((p?.orderCompletion||0)*100).toFixed(1)}% · ${actual?.units||0} 件`],
      [`${p?.expectedOrders||0}`,"截至今日应完成",`节奏差 ${p?.paceGap||0} Orders`],
      [`${p?.forecastOrders||0}`,"月末订单预测",`剩余 ${p?.remainingOrders??128} Orders`],
      [`${p?.requiredDailyOrders||0}`,"后续所需日均",`按剩余天数计算 · 截至 ${data?.asOf||'—'}`],
      [actual?.adSpend==null?'待广告同步':money(actual.adSpend),"7月广告实际",`月预算 $790 · ${actual?.adCoverage||'未覆盖'}`],
      [actual?.contributionAfterAds==null?'待广告同步':money(actual.contributionAfterAds),"广告后店铺贡献",`${actual?.adCoverage==='FULL'?'广告完整覆盖':'广告仅部分覆盖'} · 成本覆盖 ${Math.round((actual?.costCoverage||0)*100)}% · 计划预计净利 $3,394`],
    ].map(([value,label,note])=><article className="stat" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}</section>
    <div className="plan-tabs"><button className={tab==='july'?'active':''} onClick={()=>setTab('july')}>7月执行计划</button><button className={tab==='bfij'?'active':''} onClick={()=>setTab('bfij')}>BFIJ 活动广告策略</button><button className={tab==='august'?'active':''} onClick={()=>setTab('august')}>8月准备计划</button></div>
    {tab==='july'&&<><div className="plan-workspace">
      <article className="card target-card"><div className="section-head"><div><span>JULY SKU RESPONSIBILITY</span><h2>128 Orders责任拆解与订单API实际</h2></div><b>来源：真实基线 v3.1 · 2026-06-23</b></div><div className="plan-table july"><div className="plan-row head"><span>Listing / Part</span><span>6月基线</span><span>7月目标</span><span>实际订单 / 件</span><span>广告预算</span><span>策略与Gate</span></div>{(data?.listings||[]).map(item=><div className="plan-row" key={item.listing}><span><b>{item.listing}</b><small>{item.parts.join(' · ')}</small></span><span>{item.juneBaselineOrders}</span><span><b>{item.julyTargetOrders}</b></span><span><b>{item.actualOrders} / {item.actualUnits}</b><small>{money(item.actualRevenue)}</small></span><span>{money(item.budget)}<small>预计净利 {money(item.estimatedNetProfit)}</small></span><span><b>{item.role} · {item.tactic}</b><small>{item.gate}{item.sourceWarning?` · ${item.sourceWarning}`:''}</small></span></div>)}</div></article>
      <aside className="card milestone-card"><div className="section-head"><div><span>JULY EVENTS</span><h2>活动节奏</h2></div></div><div className="milestones">{(data?.events||[]).map(item=><div key={item.label}><b>{item.label}<small>{item.range}</small></b><strong>{item.range.includes('23')?'当前重点':'记录'}</strong><p>{item.note}</p></div>)}</div></aside>
    </div><div className="scope-alert"><b>来源口径冲突</b><span>{data?.plan.scopeWarning||'正在读取7月计划来源说明。'}</span></div></>}
    {tab==='bfij'&&<><section className="activity-brief card"><div><span>OFFICIAL EVENT · 2026</span><h2>{data?.activity.name||'Black Friday in July 广告策略'}</h2><p>北美主活动 {data?.activity.officialEventRange.replace('/',' → ')||'07/23 → 07/28'}；Canada Co-Invest {data?.activity.canadaCoInvestRange.replace('/',' → ')||'07/23 → 07/27'}。活动预算与7月月计划共用同一预算池。</p></div><div><small>活动窗口建议上限</small><strong>{money(data?.activity.strategyBudget||330)}</strong><span>/ 7月 {money(data?.activity.monthlyBudget||790)}</span></div></section>
      <section className="activity-facts"><article><span>07/17 前</span><b>确认 Flash Deal</b><small>只有收到邀请的SKU才进入；每个上线SKU固定费$75计入利润。</small></article><article><span>07/21–07/28</span><b>商品编辑锁定</b><small>Listing、折扣、媒体和变体必须在锁定前完成核查。</small></article><article><span>07/23–07/28</span><b>北美主活动</b><small>普通折扣不叠加；Conditional Offer会叠加，必须核算最终折扣。</small></article><article><span>14天后</span><b>归因复盘</b><small>活动当日只看预算、库存与异常，不用未成熟ROAS做结论。</small></article></section>
      <section className="card activity-plan"><div className="section-head"><div><span>ACTIVITY MEDIA PLAN</span><h2>六阶段广告执行表</h2></div><b>{data?.activity.budgetNote||'活动预算包含在7月总预算内'}</b></div><div className="phase-list"><div className="phase-head"><span>阶段</span><span>预算上限</span><span>Bid规则</span><span>Cap规则</span><span>运营目标</span></div>{(data?.activity.phases||[]).map(phase=><article className={data?.activity.activePhase===phase.id?'active':''} key={phase.id}><div><b>{phase.label}</b><small>{phase.range}</small></div><strong>{money(phase.budgetCap)}</strong><p>{phase.bidRule}</p><p>{phase.capRule}</p><p>{phase.objective}</p></article>)}</div></section>
      <div className="scope-alert"><b>官方事实与本店策略分开</b><span>活动日期、Flash费用、商品锁定与Co-Invest来自官宣PDF；$330阶段预算及Bid/Cap幅度是中台基于7月$790总预算制定的运营建议，仍需利润、库存、促销资格和链接Gate通过。</span></div></>}
    {tab==='august'&&<><div className="plan-workspace">
      <article className="card target-card"><div className="section-head"><div><span>AUGUST PREPARATION</span><h2>150 Units下一计划责任表</h2></div><b>来源：Playbook · {data?.nextPlan.plan.sourceAsOf||'2026-07-15'}</b></div><div className="plan-table"><div className="plan-row head"><span>Listing / Part</span><span>6月基线</span><span>8月目标</span><span>实际</span><span>广告预算</span><span>角色与Gate</span></div>{(data?.nextPlan.listings||[]).map(item=><div className="plan-row" key={item.listing}><span><b>{item.listing}</b><small>{item.parts.join(' · ')}</small></span><span>{item.juneUnits}</span><span><b>{item.augustUnits}</b></span><span>{item.actualUnits}</span><span>{money(item.budget)}</span><span><b>{item.role}</b><small>{item.gate}</small></span></div>)}</div></article>
      <aside className="card milestone-card"><div className="section-head"><div><span>WEEKLY GATES</span><h2>8月周里程碑</h2></div></div><div className="milestones">{(data?.nextPlan.milestones||[]).map(item=><div key={item.label}><b>{item.label}<small>{item.range}</small></b><strong>{item.cumulative?`${item.cumulative} Units`:'准备'}</strong><p>{item.note}</p></div>)}</div></aside>
    </div><div className="scope-alert"><b>8月口径待确认</b><span>{data?.nextPlan.plan.scopeWarning||'8月责任表按Units跟踪。'}</span></div></>}
  </>;
}

function Inventory() {
  type Preview={snapshotId?:string;sourceFile?:string;createdAt?:string;canPush?:boolean;summary?:{totalRows:number;supplierCount:number;zeroStockRows:number;missingCombinations:number;totalQuantityOnHand:number;ignoredStockRows:number};warnings?:{message:string}[];errors?:{message:string}[];error?:string};
  const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState<Preview|null>(null);const [state,setState]=useState("读取最近快照");const [busy,setBusy]=useState(false);const [confirmation,setConfirmation]=useState("");const [zeroConfirmed,setZeroConfirmed]=useState(false);const [message,setMessage]=useState("");
  useEffect(()=>{const controller=new AbortController();fetch('/api/inventory/preview',{signal:controller.signal}).then(async r=>await r.json() as Preview).then(body=>{if(body.snapshotId){setPreview(body);setState('最近快照可用');}else setState('等待库存文件');}).catch(()=>setState('等待库存文件'));return()=>controller.abort();},[]);
  async function validate(){if(!file)return;setBusy(true);setMessage('');setState('正在解析与校验');try{const form=new FormData();form.set('file',file);const response=await fetch('/api/inventory/preview',{method:'POST',body:form});const body=await response.json() as Preview;if(!response.ok)throw new Error(`${body.error||'库存校验失败'}${body.errors?.[0]?.message?`：${body.errors[0].message}`:''}`);setPreview(body);invalidateClientCache('ads:');setState('校验通过 · 已入库');setMessage(`已保存库存快照 ${body.snapshotId?.slice(0,8)}；广告放量Gate将在下次打开时自动读取。`);}catch(error){setState('校验未通过');setMessage(error instanceof Error?error.message:'库存校验失败');}finally{setBusy(false);}}
  async function push(dryRun:boolean){if(!preview?.snapshotId)return;setBusy(true);setMessage('');setState(dryRun?'正在执行Dry-run':'正在提交Wayfair');try{const response=await fetch('/api/inventory/push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshotId:preview.snapshotId,dryRun,confirmation,zeroStockConfirmed:zeroConfirmed})});const body=await response.json() as {error?:string;itemCount?:number;batchCount?:number;mode?:string};if(!response.ok)throw new Error(body.error||'库存推送失败');setState(dryRun?'Dry-run 已通过':'已提交Wayfair');setMessage(dryRun?`Dry-run完成：${body.itemCount}条记录，拆分${body.batchCount}个批次；尚未写入Wayfair。`:`正式库存已提交，共${body.itemCount}条。`);}catch(error){setState(dryRun?'Dry-run 失败':'正式推送被阻止');setMessage(error instanceof Error?error.message:'库存推送失败');}finally{setBusy(false);}}
  const metrics=[["可推送行",preview?.summary?.totalRows],["Supplier",preview?.summary?.supplierCount],["零库存",preview?.summary?.zeroStockRows],["未匹配组合",preview?.summary?.missingCombinations]];
  return <><Hero eyebrow="INVENTORY UPDATE · CONTROLLED WRITE" title="库存更新" text="真实解析领星库存、套用SKU/仓库映射、持久化快照，再执行Dry-run与受控推送" side={<div className="hero-side"><b>{state}</b><span>{preview?.sourceFile||'尚无库存快照'}</span></div>} />
    <div className="inventory-grid"><article className="card upload-card"><span className="step">STEP 01 · SOURCE & VALIDATION</span><h2>生成库存快照</h2><label className="drop"><input type="file" accept=".xlsx" onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);setState(next?'文件待校验':preview?'最近快照可用':'等待库存文件');setMessage('');}}/><b>{file?.name||preview?.sourceFile||"选择领星库存 XLSX"}</b><span>读取品名、SKU、仓库、可用量、锁定量、待到货与调拨在途；映射表已固化为当前生产版本</span></label><button className="primary" disabled={!file||busy} onClick={validate}>{busy&&state.includes('解析')?'校验中…':'校验并保存快照'}</button>{preview?.createdAt&&<div className="snapshot-note">最近快照 {new Date(preview.createdAt).toLocaleString('zh-CN')} · 库存合计 {preview.summary?.totalQuantityOnHand||0}</div>}</article><article className="card gate-card"><span className="step">STEP 02 · DRY-RUN & CONFIRMATION</span><h2>推送前检查</h2><div className="gate-metrics">{metrics.map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{value??'—'}</strong></div>)}</div>{preview?.warnings?.length?<div className="soft-note">{preview.warnings.map(item=>item.message).join('；')}</div>:<div className="soft-note">只有真实校验通过的D1快照可进入Dry-run；正式推送不会复用浏览器临时状态。</div>}<button className="primary" disabled={!preview?.canPush||busy} onClick={()=>push(true)}>执行 Wayfair API Dry-run</button><div className="live-confirm"><label>正式确认<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="输入：正式推送"/></label><label className="zero-check"><input type="checkbox" checked={zeroConfirmed} onChange={e=>setZeroConfirmed(e.target.checked)}/>确认零库存记录会改变可售状态</label><button className="primary dark" disabled={!preview?.canPush||busy||confirmation!=='正式推送'} onClick={()=>push(false)}>正式推送库存</button></div>{message&&<div className={state.includes('失败')||state.includes('阻止')||state.includes('未通过')?'inventory-message bad':'inventory-message good'}>{message}</div>}</article></div>
  </>;
}

function Ads() {
  const initial=adRangeFor('matureWeek');
  const [preset,setPreset]=useState('matureWeek');
  const [start,setStart]=useState(initial.start); const [end,setEnd]=useState(initial.end); const [requested,setRequested]=useState({start:initial.start,end:initial.end,refresh:false});
  const [data,setData]=useState<AdAnalysis|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const [queueState,setQueueState]=useState<Record<string,string>>({});
  useEffect(()=>{const cacheKey=`ads:${requested.start}:${requested.end}`;const cached=!requested.refresh&&readClientCache<AdAnalysis>(cacheKey);const controller=new AbortController();if(cached){queueMicrotask(()=>{if(!controller.signal.aborted){setData(cached);setLoading(false);setError('');}});return()=>controller.abort();}fetch(`/api/ads/analysis?start=${requested.start}&end=${requested.end}${requested.refresh?'&refresh=1':''}`,{signal:controller.signal}).then(async r=>{const body=await r.json() as AdAnalysis;if(!r.ok)throw new Error(body.error||'广告分析失败');return body;}).then(body=>{setData(body);writeClientCache(cacheKey,body);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[requested]);
  function selectAdPreset(next:string){setPreset(next);if(next==='custom')return;const range=adRangeFor(next);setStart(range.start);setEnd(range.end);setLoading(true);setError('');setRequested({...range,refresh:false});}
  async function queueAction(row:AdListing){const key=`${row.campaignId}:${row.listing}`;setQueueState(value=>({...value,[key]:'saving'}));try{const response=await fetch('/api/ads/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runKey:data?.runKey,listing:row.listing,campaignId:row.campaignId,actionType:row.action.type,before:row.action.before,proposed:row.action.proposed})});const body=await response.json() as {message?:string;error?:string};if(!response.ok)throw new Error(body.error||'执行单保存失败');setQueueState(value=>({...value,[key]:'saved'}));}catch(reason){setQueueState(value=>({...value,[key]:reason instanceof Error?reason.message:'保存失败'}));}}
  const trendMax=Math.max(1,...(data?.history||[]).map(x=>x.spend));
  const ready=data?.listings.filter(x=>x.action.recommendation==='READY').length||0;
  const needsInput=data?.listings.filter(x=>x.action.execution==='NEEDS_INPUT').length||0;
  const noChange=data?.listings.filter(x=>x.action.recommendation==='NO_CHANGE').length||0;
  return <><Hero eyebrow="WEEKLY AI AD OPTIMIZATION" title="广告周优化" text="每周自动用成熟7天数据生成SKU动作；最近7/14天用于观察，不再因为归因窗口让整张清单失去操作性" side={<div className="hero-side"><b>{loading?'同步中':error?'需检查':'本周建议已生成'}</b><span>{data?.cache?.layer==='ADVERTISING_API'?'Advertising API已入库':'D1数据库直接读取'} · 生产写入需确认</span></div>} />
    <section className="ai-cadence"><article><span>01 · 每周触发</span><b>打开中台自动检查</b><small>同一成熟周只生成一版决策快照</small></article><i>→</i><article><span>02 · 成熟归因</span><b>{data?.decisionRange.start||'—'} → {data?.decisionRange.end||'—'}</b><small>T-14滚动7天，与前一成熟周比较</small></article><i>→</i><article><span>03 · AI建议</span><b>{ready}项调整 · {noChange}项保持</b><small>历史、利润、链接与月计划共同判断</small></article><i>→</i><article><span>04 · 执行单</span><b>人工确认后执行</b><small>Bid/启停走API；Cap等生成后台任务</small></article></section>
    <section className="period-bar ad-period"><div>{adPresetOptions.map(([id,label])=><button key={id} className={preset===id?'active':''} onClick={()=>selectAdPreset(id)}>{label}</button>)}</div>{preset==='custom'&&<><label>开始<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束<input type="date" value={end} max={dateText(new Date())} onChange={e=>setEnd(e.target.value)}/></label><button disabled={loading||start>end} onClick={()=>{setLoading(true);setError('');setRequested({start,end,refresh:false});}}>读取</button></>}<button disabled={loading} onClick={()=>{setLoading(true);setError('');setRequested({start,end,refresh:true});}}>刷新底层数据</button><span>{error||`展示 ${requested.start} → ${requested.end} · 决策固定使用成熟周 ${data?.decisionRange.start||'—'} → ${data?.decisionRange.end||'—'}`}</span></section>
    {error&&<div className="inline-error">{error}；系统未展示任何静态替代建议。</div>}
    <section className="stat-grid six ad-kpis">{[
      [loading?'—':money(data?.current.spend),"所选周期花费",change(data?.current.spend,data?.previous.spend)],
      [loading?'—':String(data?.current.orders||0),"所选周期归因订单",change(data?.current.orders,data?.previous.orders)],
      [loading?'—':`${(data?.current.wscRoas||0).toFixed(2)}×`,"所选周期ROAS",`前周期 ${(data?.previous.wscRoas||0).toFixed(2)}×`],
      [loading?'—':String(ready),"AI调整建议",`基于成熟周，不受展示周期影响`],
      [loading?'—':String(needsInput),"需补条件",`建议仍可读，可加入补数待办`],
      [loading?'—':String(noChange),"本周保持",`不是阻断，是明确的不调整结论`],
    ].map(([value,label,note])=><article className="stat" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}</section>
    <section className="ad-decision-grid">
      <article className="card decision-card"><span>所选周期观察</span><h2>花费与归因走势</h2><div className="ad-history">{(data?.history||[]).filter(x=>x.date>=requested.start&&x.date<=requested.end).map(x=><div key={x.date} title={`${x.date} · ${money(x.spend)} · ${x.orders}单`}><i style={{height:`${Math.max(3,x.spend/trendMax*100)}%`}}></i><small>{x.date.slice(5)}</small></div>)}</div><p>{data?.range.mature?'所选周期已成熟，可用于复盘；本周动作仍统一使用上方成熟周。':'这是观察窗口，转化仍在回补；AI不会拿未成熟订单直接加减Bid。'}</p></article>
      <article className="card evidence-card"><span>每周决策规则</span><h2>14天归因不等于14天才操作一次</h2><ul><li><b>调整频率：</b>每周执行一次，固定读取截至T-14的最近7天成熟数据。</li><li><b>加预算：</b>至少2单、CVR≥2%、ROAS高于保本线与4×，且计划、链接、库存、利润通过。</li><li><b>降Bid：</b>成熟点击≥20且0单，或花费≥$20且ROAS低于保本线，下调10%。</li><li><b>保持：</b>没有触发增减条件时明确保持，不再显示成“被阻断”。</li><li><b>数据库：</b>日级报表与每周决策快照持久化；切换模块直接复用，不重复拉取。</li></ul></article>
    </section>
    <section className="card action-ledger"><div className="section-head"><div><span>WEEKLY ACTION PLAN</span><h2>SKU / Listing 本周执行单</h2></div><b>建议自动生成 · 人工确认 · 保存前值与回滚值</b></div>
      <div className="group-switch"><span>排序：需要调整优先，其次按成熟周花费；建议结论与执行Gate分开。</span></div>
      <div className="action-list rich"><div className="action-head"><span>Listing / Campaign</span><span>成熟周证据</span><span>利润 · 链接 · 库存 · 计划</span><span>AI建议与依据</span><span>执行</span></div>{(data?.listings||[]).map(row=>{const key=`${row.campaignId}:${row.listing}`;const queued=queueState[key];return <article key={key}><div><strong>{row.listing}</strong><small>Campaign {row.campaignId} · {row.parts.join(' / ')||'Part未映射'}</small></div><p><b>{money(row.current.spend)} · {row.current.clicks}点击 · {row.current.orders}单</b><br/>ROAS {row.current.wscRoas.toFixed(2)}× · 前周 {row.previous.wscRoas.toFixed(2)}×</p><p><b>保本：</b>{row.economics.breakEvenRoas.toFixed(2)}×（{row.economics.marginMode==='PLAN_SKU'?'SKU毛利':'店铺估算'}）<br/><b>链接：</b>{row.linkQuality.rating??'缺失'}分 / {row.linkQuality.reviews??'—'}评<br/><b>库存：</b>{row.inventory.known?`${row.inventory.quantityOnHand}件 · ${row.inventory.coverDays}天`:'未入库'}<br/><b>计划：</b>{row.plan?`${row.plan.role} · ${money(row.plan.budget)}`:'未建档'}</p><div><span className={row.action.recommendation==='READY'?'recommend-ready':'recommend-hold'}>{row.action.recommendation==='READY'?'建议调整':'建议保持'} · {row.action.confidence}</span><b>{row.action.label}</b><small>{row.action.reasons.join('；')}</small>{row.action.blockers.length?<small className="gate-warning">执行前补：{row.action.blockers.join('；')}</small>:null}</div><div><em className={row.action.execution==='READY_FOR_PLAN'?'good':row.action.execution==='NEEDS_INPUT'?'warn':'neutral'}>{row.action.execution==='READY_FOR_PLAN'?'可加入执行单':row.action.execution==='NEEDS_INPUT'?'需补条件':'本周不调整'}</em><button disabled={row.action.type==='HOLD'||queued==='saving'||queued==='saved'} onClick={()=>queueAction(row)}>{queued==='saving'?'保存中':queued==='saved'?'已加入':row.action.execution==='NEEDS_INPUT'?'加入补数待办':'加入本周执行单'}</button>{queued&&!['saving','saved'].includes(queued)&&<small className="bad">{queued}</small>}</div></article>})}{!loading&&!data?.listings.length&&<p className="empty-state">成熟周没有Listing广告数据</p>}</div>
    </section>
    <div className="scope-alert"><b>本阶段执行边界</b><span>AI每周自动算建议并持久化；点击后进入周执行单。Listing Bid与启停可生成API载荷，Campaign Cap等生成Partner Home人工任务。正式写入仍保留一次人工确认和回滚。</span></div>
  </>;
}

function Review() {
  const [report,setReport]=useState(0);const [uploads,setUploads]=useState<UploadedReport[]>([]);const [uploading,setUploading]=useState(false);const [uploadMessage,setUploadMessage]=useState('');
  useEffect(()=>{const controller=new AbortController();fetch('/api/reports',{signal:controller.signal}).then(async r=>await r.json() as {reports?:UploadedReport[]}).then(body=>setUploads(body.reports||[])).catch(()=>{});return()=>controller.abort();},[]);
  const allReports=useMemo(()=>[...REPORTS.map(item=>({...item,assetUrl:`/reports/${encodeURIComponent(item.file)}`,uploaded:false})),...uploads.map(item=>({title:item.title,file:item.fileName,kind:item.kind,date:new Date(item.createdAt).toLocaleDateString('zh-CN'),summary:'用户补充的复盘证据，原文件已持久化保存。',sections:[],assetUrl:`/api/reports/file?id=${encodeURIComponent(item.id)}`,uploaded:true}))],[uploads]);
  const selected=allReports[Math.min(report,allReports.length-1)];const spreadsheet=selected.file.endsWith('.xlsx');
  async function uploadReport(file:File|null){if(!file)return;setUploading(true);setUploadMessage('');try{const form=new FormData();form.set('file',file);const response=await fetch('/api/reports',{method:'POST',body:form});const body=await response.json() as UploadedReport&{error?:string};if(!response.ok)throw new Error(body.error||'报告上传失败');setUploads(value=>[body,...value]);setReport(REPORTS.length);setUploadMessage('报告已保存并加入资料库。');}catch(error){setUploadMessage(error instanceof Error?error.message:'报告上传失败');}finally{setUploading(false);}}
  return <><Hero eyebrow="MONTHLY REVIEW · FULL REPORTS" title="月度复盘" text="直接阅读完整原报告，不再用四个摘要框代替正文" side={<label className="hero-button upload-report">{uploading?'上传中…':'补充复盘资料'}<input type="file" accept=".html,.htm,.pdf,.xlsx" disabled={uploading} onChange={e=>uploadReport(e.target.files?.[0]||null)}/></label>} />
    <section className="review-context"><div><span>复盘事实月</span><b>2026-06 · 已归档</b></div><i>→</i><div><span>当前经营月</span><b>2026-07 · 128 Orders执行中</b></div><i>→</i><div><span>下一计划月</span><b>2026-08 · 150 Units准备中</b></div></section>
    {uploadMessage&&<div className="upload-message">{uploadMessage}</div>}
    <div className="review-grid full-reader"><aside className="card report-list"><div><span>EVIDENCE LIBRARY</span><h2>完整复盘资料</h2><b>{allReports.length}</b></div>{allReports.map((x,i)=><button className={report===i?'active':''} onClick={()=>setReport(i)} key={`${x.uploaded?'upload':'builtin'}:${x.file}`}><strong>{x.title}</strong><small>{x.kind} · {x.date||'2026/07/15'}</small></button>)}</aside><article className="card report-reader"><header><div><span>{selected.kind} · 完整原报告</span><h2>{selected.title}</h2><p>{selected.summary}</p></div><a href={selected.assetUrl} target="_blank" rel="noreferrer">{spreadsheet?'下载原表格':'在新窗口打开'}</a></header>{spreadsheet?<div className="sheet-download"><b>执行清单为 XLSX 原表格</b><p>点击右上角下载完整文件；同一内容的可读版请在左侧打开“SKU广告重构执行清单”。</p><a href={selected.assetUrl} download>下载 {selected.file}</a></div>:<iframe key={selected.assetUrl} title={selected.title} src={selected.assetUrl} sandbox={selected.uploaded?'':'allow-same-origin allow-scripts allow-popups'} />}</article></div>
  </>;
}

function Catalog() {
  const [query,setQuery]=useState(''); const [submitted,setSubmitted]=useState(''); const [status,setStatus]=useState('');
  const [page,setPage]=useState(1); const [refresh,setRefresh]=useState(0); const [data,setData]=useState<CatalogResponse | null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [selected,setSelected]=useState<CatalogItem | null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({page:String(page),pageSize:'20'}); if(submitted)params.set('q',submitted); if(status)params.set('status',status);
    const cacheKey=`catalog:${params}`;const cached=refresh===0?readClientCache<CatalogResponse>(cacheKey):null;if(cached){queueMicrotask(()=>{if(!controller.signal.aborted){setData(cached);setSelected(cached.items?.[0]||null);setLoading(false);}});return()=>controller.abort();}
    fetch(`/api/catalog/items?${params}`,{signal:controller.signal}).then(async response=>{const body=await response.json() as CatalogResponse;if(!response.ok)throw new Error(body.error||'商品数据读取失败');return body;}).then(body=>{setData(body);setSelected(body.items?.[0]||null);writeClientCache(cacheKey,body);}).catch(reason=>{if(reason.name!=='AbortError')setError(reason.message||'商品数据读取失败');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[submitted,status,page,refresh]);
  const pages=data?.paginationInfo;
  const insights=selected?.insights;
  const insightTotal=(insights?.problems?.length||0)+(insights?.warnings?.length||0)+(insights?.opportunities?.length||0);
  function submit(){setLoading(true);setError('');setPage(1);setSubmitted(query.trim().toUpperCase());setRefresh(value=>value+1);}
  return <><Hero eyebrow="CATALOG READ V2 · ORDER JOIN" title="商品数据" text="Catalog 商品事实与近 30 天订单表现合并为 SKU 360° 视图" side={<div className="hero-side"><b>{loading?'同步中':error?'需检查':'已连接'}</b><span>Catalog Read V2 · {pages?.totalCount||0} 个商品</span></div>} />
    <section className="card catalog-card"><div className="filters"><label>Supplier Part #<input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submit();}} placeholder="精确输入，如 DMOM1022"/></label><label>商品状态<select value={status} onChange={e=>{setLoading(true);setError('');setStatus(e.target.value);setPage(1);}}><option value="">全部状态</option><option value="LIVE">LIVE</option><option value="NOT_LIVE">NOT LIVE</option><option value="LAUNCHING">LAUNCHING</option></select></label><button className="primary" onClick={submit}>查询商品</button></div>
      {error&&<div className="inline-error">{error}</div>}
      <div className="catalog-layout"><div className="catalog-results"><div className="catalog-row catalog-head"><span>SKU / Listing</span><span>状态</span><span>品牌 · 类目</span><span>市场</span><span>诊断</span><span>近 30 天</span></div>{(data?.items||[]).map(item=>{const issues=(item.insights?.problems?.length||0)+(item.insights?.warnings?.length||0);return <button className={`catalog-row ${selected?.supplierPartNumber===item.supplierPartNumber?'selected':''}`} key={item.supplierPartNumber} onClick={()=>setSelected(item)}><span><strong>{item.supplierPartNumber}</strong><small>{item.listings?.length||0} 个 Listing</small></span><em className={item.catalogItemStatus==='LIVE'?'good':'bad'}>{item.catalogItemStatus?.replace('_',' ')||'—'}</em><span><b>{item.marketContext?.brand||'—'}</b><small>{item.class?.className||'未分类'}</small></span><span><b>{item.marketContext?.country||'—'} · {item.marketContext?.locale||'—'}</b><small>{item.marketContext?.channel||'—'} / {item.marketContext?.segment||'—'}</small></span><span><b>{issues} 问题</b><small>{item.insights?.opportunities?.length||0} 机会</small></span><span><b>{item.recent30d?.units||0} 件</b><small>{money(item.recent30d?.revenue||0)}</small></span></button>})}{!loading&&!data?.items?.length&&<p className="empty-state">没有符合条件的商品</p>} {loading&&<p className="empty-state">正在读取 Catalog…</p>}
        <div className="pagination"><span>第 {pages?.page||1} / {pages?.totalPages||1} 页 · 共 {pages?.totalCount||0} 个</span><button disabled={page<=1} onClick={()=>{setLoading(true);setError('');setPage(page-1);}}>上一页</button><button disabled={!pages?.hasNextPage} onClick={()=>{setLoading(true);setError('');setPage(page+1);}}>下一页</button></div></div>
        <aside className="product-detail">{selected?<><span>SKU 360°</span><h2>{selected.supplierPartNumber}</h2><div className="product-facts"><div><small>商品状态</small><b>{selected.catalogItemStatus?.replace('_',' ')}</b></div><div><small>Listing</small><b>{selected.listings?.length||0}</b></div><div><small>近 30 天销售</small><b>{money(selected.recent30d?.revenue||0)}</b></div><div><small>诊断信号</small><b>{insightTotal}</b></div></div><section><h3>市场与标识</h3><p>{selected.marketContext?.brand||'—'} · {selected.class?.className||'未分类'} · {selected.marketContext?.country||'—'} / {selected.marketContext?.channel||'—'}</p><div className="listing-tags">{selected.listings?.map(item=><i key={item.listingId}>{item.listingId}</i>)}</div></section><section><h3>Catalog 诊断</h3>{([['问题',insights?.problems],['警告',insights?.warnings],['机会',insights?.opportunities]] as [string,CatalogInsight[]|undefined][]).map(([label,list])=>list?.map(item=><article className="insight" key={item.insightId||item.title}><b>{label} · {item.title||'未命名信号'}</b><p>{item.explanation||'Catalog 未提供详细解释。'}</p>{item.monthsInViolation? <small>已持续 {item.monthsInViolation} 个月</small>:null}{item.resolution?.url&&/^https:\/\//.test(item.resolution.url)&&<a href={item.resolution.url} target="_blank" rel="noreferrer">查看 Wayfair 处理指引</a>}</article>))}{!insightTotal&&<p className="empty-insight">当前没有 Catalog 问题、警告或机会。</p>}</section><section className="linkage-note"><h3>跨模块联动</h3><p>订单表现已关联；库存写入前进入 Inventory Gate，广告动作在周度父体清单统一审批。</p></section></>:<p>选择左侧商品查看完整信息。</p>}</aside></div>
    </section></>;
}

function Sources() {
  const sources=[['Outlook 邮件日报','已同步','2026-07-16','风险与待办'],['Ops API · 库存 + 订单','生产','同一套 OAuth 应用','库存写 · 订单读'],['Advertising API','生产','官方报表已连接','Campaign / Listing历史报表 · 写关闭'],['Catalog Read V2','生产','双版本权限','商品、Listing 与诊断'],['月度报告资料库','已同步','15+ 份报告','6月复盘 · 7月执行 · BFIJ · 8月准备'],['运营数据库','运行中','D1 + R2 持久化','订单、广告、商品、库存、执行单与补充报告']];
  return <><Hero eyebrow="DATA SOURCES · PERMISSION CONTROL" title="数据源" text="库存与订单共用 Ops 应用；每个连接只承担明确的数据职责" /><div className="source-grid">{sources.map(x=><article className="card source-card" key={x[0]}><span className="connected">{x[1]}</span><h2>{x[0]}</h2><p>{x[2]}</p><small>{x[3]}</small></article>)}</div></>;
}

export default function OpsCenter() {
  const [view,setView]=useState<View>('daily');
  useEffect(()=>{window.scrollTo(0,0);const frame=requestAnimationFrame(()=>window.scrollTo(0,0));return()=>cancelAnimationFrame(frame);},[view]);
  const page=useMemo(()=>({daily:<Daily onNavigate={setView}/>,plan:<Plan onNavigate={setView}/>,inventory:<Inventory/>,ads:<Ads/>,review:<Review/>,catalog:<Catalog/>,sources:<Sources/>})[view],[view]);
  return <div className="app"><ShellHeader active={view} onNavigate={setView}/><main>{page}</main><footer><span>Wayfair AI 运营中台 · 个人测试阶段</span><span>写操作均保留确认与审计</span></footer></div>;
}
