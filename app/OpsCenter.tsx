"use client";

import { useEffect, useMemo, useState } from "react";
import { CLIENT_CACHE_RETENTION_MS, invalidateClientCache, readClientCache, writeClientCache } from "../lib/client-cache";
import { canRemoveAction, executionResultForAction, filterAdActions, isBulkApprovable, queuedActionState } from "../lib/ad-action-queue.mjs";
import { nextSort, sortRows } from "../lib/table-sort.mjs";
import legacyOperatingDataSource from "../data/dmom-operating-2026-06.json";

type View = "dashboard" | "ads" | "planning" | "products" | "sources" | "help";
type AdsTab = "manager" | "listings" | "ai";
type PlanningTab = "plan" | "review" | "history";
type ProductTab = "inventory" | "catalog" | "performance";
type PlanSection = "july" | "bfij" | "august";
type SubView = AdsTab | PlanningTab | ProductTab;

const PRIMARY_NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "ads", label: "广告" },
  { id: "planning", label: "计划与复盘" },
  { id: "products", label: "商品与库存" },
];

const SYSTEM_NAV: { id: View; label: string }[] = [
  { id: "sources", label: "数据源" },
  { id: "help", label: "帮助" },
];

const SUB_NAV: Partial<Record<View, { id: SubView; label: string }[]>> = {
  ads: [{ id: "manager", label: "广告管理器" }, { id: "listings", label: "Listing 表现" }, { id: "ai", label: "AI 优化" }],
  planning: [{ id: "plan", label: "运营计划" }, { id: "review", label: "复盘资料" }, { id: "history", label: "历史月度" }],
  products: [{ id: "inventory", label: "库存更新" }, { id: "catalog", label: "商品数据" }, { id: "performance", label: "SKU 经营" }],
};

type LegacySku = { "Supplier Part Number":string;"Wayfair Sku":string;"Product Name":string;"Class Name":string;"Total Revenue":number;Sessions:number;CVR:number;rating:number;review_count:number;tag_pct:number;wsc:number;cogs:number;my_profit:number;my_margin:number;wf_space:number;grade:string;cn_name:string|null };
type LegacyOperatingData = { meta:{store:string;biz_month:string};skus:LegacySku[];trend:{months:string[];revenue:Array<number|null>;orders:Array<number|null>;sessions:Array<number|null>;cvr:Array<number|null>;sp_spend:Array<number|null>};acct_monthly:Array<{m:number;orders:number;ad_orders:number;spend:number;rev:number}> };
const LEGACY_OPERATING_DATA=legacyOperatingDataSource as unknown as LegacyOperatingData;

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

type AdMetric = { impressions: number; clicks: number; spend: number; orders: number; units: number; retail: number; wsc: number; ctr: number; cvr: number; cpa: number; retailRoas: number; wscRoas: number };
type AdCampaign = AdMetric & { campaignId: string; name: string; targetingType: string; site: string; status: string; isActive: string; isB2b: string; dailyCap: string; lifetimeBudget: string; startDate: string; endDate: string; strategy: string; targetRoas: string };
type AdListing = {
  listing: string; campaignId: string; campaignName: string; site: string; productName: string; className: string; isB2b: string; campaignStatus: string; parts: string[]; bid: number; status: string;
  current: AdMetric; previous: AdMetric;
  plan: null | { budget: number; augustUnits?: number; julyTargetOrders?: number; role: string; gate: string; eligible: boolean; adRole: string; rating?: number; reviews?: number };
  nextPlan: null | { budget: number; augustUnits?: number; role: string; gate: string; eligible: boolean; adRole: string };
  economics: { marginRate: number; marginMode: string; breakEvenRoas: number };
  linkQuality: { rating: number | null; reviews: number | null; pass: boolean; source: string };
  inventory: { known: boolean; coverDays: number | null; quantityOnHand: number; snapshotAt: string | null };
  cpcBaseline: { category: string; cpc: number | null; targetBid: number | null; hardBidCap: number | null; actualCpc: number | null; source: string; appliesTo: string[] };
  goalGuardrail: { julyPaceGap: number; eventPhase: string; julyRemainingUnits: number; augustReserveUnits: number };
  action: { type: string; label: string; recommendation: string; execution: string; confidence: string; reasons: string[]; blockers: string[]; warnings: string[]; before: Record<string, unknown>; proposed: Record<string, unknown> };
};
type AdAnalysis = {
  current: AdMetric; previous: AdMetric; history: ({ date: string } & AdMetric)[]; campaigns: AdCampaign[]; listings: AdListing[];
  range: { start: string; end: string; previousStart: string; previousEnd: string; asOf: string; matureThrough: string; mature: boolean };
  decisionRange: { start: string; end: string; previousStart: string; previousEnd: string; cadence: string; rule: string };
  runKey: string; generatedAt: string; attributionWindowDays: number; cache?: { hit?: boolean; layer?: string; updatedAt?: string }; safety: { reason: string }; error?: string;
};
type SortState = { key: string; direction: "asc" | "desc" };
type AdHistoryWeek = { run_key:string; decision_start:string; decision_end:string; created_at:string; actions:Array<QueuedAdAction>; reviews:Array<{actionId?:string;listing:string;campaignId:string;verdict:string;summary?:string;orderDelta?:number;revenueDelta?:number;roasDelta?:number;evaluatedAt?:string}> };
type EmailBrief = { briefDate:string; syncedAt:string; source:string; summary:{total:number;unread:number;actionRequired:number;highestPriority:string}; items:Array<{id:string;subject:string;sender:string;receivedAt:string;unread:boolean;priority:string;summary:string;owner:string;status:string;webLink:string}>; tasks:Array<{id:string;title:string;owner:string;dueDate:string;priority:string;status:string}>; error?:string };
type QueuedAdAction = {
  id: string; run_key: string; listing: string; campaign_id: string; action_type: string;
  before_payload: string; proposed_payload: string; status: string; created_at: string; updated_at: string;
  result_event_type?: string; result_payload?: string; result_at?: string;
};
type AdQueueCache = { actions: QueuedAdAction[]; liveEnabled: boolean };
let dashboardSnapshot: OrderSummary | null = null;
let emailBriefSnapshot: EmailBrief | null = null;
type PlanProgress = {
  plan: { month: string; orderTarget: number; baselineOrders: number; floorOrders: number; stretchOrders: number; adBudget: number; estimatedNetProfit: number; source: string; sourceAsOf: string; scopeWarning: string };
  currentOperatingMonth: { month: string; targetStatus: string; note: string }; status: string; asOf: string;
  actual: { orders: number; units: number; revenue: number; adSpend: number | null; adCoverage: string; grossProfitBeforeAds: number; contributionAfterAds: number | null; costCoverage: number };
  progress: { elapsedDays: number; totalDays: number; timeProgress: number; orderCompletion: number; expectedOrders: number; paceGap: number; forecastOrders: number; remainingOrders: number; requiredDailyOrders: number };
  listings: { listing: string; parts: string[]; juneBaselineOrders: number; julyTargetOrders: number; actualOrders: number; actualUnits: number; actualRevenue: number; budget: number; estimatedNetProfit: number; role: string; gate: string; tactic?: string; sourceWarning?: string }[];
  events: { label: string; range: string; note: string }[];
  activity: { name: string; officialEventRange: string; canadaCoInvestRange: string; flashDealRange: string; flashConfirmationDeadline: string; catalogLockRange: string; strategyBudget: number; monthlyBudget: number; budgetNote: string; source: string; sourceAsOf: string; activePhase: string; phases: { id: string; label: string; range: string; budgetCap: number; bidRule: string; capRule: string; objective: string }[] };
  cpcPlan: { sourcePage: number; appliesTo: string[]; benchmarkMeaning: string; categoryBenchmarks: Record<string,number>; operatingRule: string; revenueGuardrail: string; augustGuardrail: string; juneAccountFacts: { adSpend: number; attributedOrders: number; attributedWsc: number; accountWsc: number; wspWscRoas: number } };
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
function money2(value = 0) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function metricCpc(metric?: AdMetric) { return metric?.clicks ? metric.spend / metric.clicks : 0; }
function adBudgetValue(value?: string) { const numeric=Number(value); return value&&Number.isFinite(numeric)?money2(numeric):value||"—"; }
function actionPayloadText(action: QueuedAdAction) {
  try {
    const before = JSON.parse(action.before_payload || "{}") as { bid?: number; active?: boolean };
    const proposed = JSON.parse(action.proposed_payload || "{}") as { bid?: number; active?: boolean; change?: string };
    if (action.action_type === "SET_LISTING_BID") return `Bid $${Number(before.bid || 0).toFixed(2)} → $${Number(proposed.bid || 0).toFixed(2)}`;
    if (action.action_type === "SET_LISTING_ACTIVE") return `${before.active === false ? "暂停" : "启用"} → ${proposed.active === false ? "暂停" : "启用"}`;
    return `Campaign Cap ${proposed.change || "待人工设置"}`;
  } catch { return "执行载荷解析失败"; }
}
function change(current = 0, previous = 0) {
  if (!previous) return current ? "新发生" : "无变化";
  const value = (current - previous) / previous * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}% 较前周期`;
}
function adDailySignal(row: { spend: number; orders: number; wscRoas: number }) {
  if (row.spend >= 20 && row.orders === 0) return { label: "无订单消耗", tone: "bad" };
  if (row.orders > 0 && row.wscRoas >= 4) return { label: "高效产出", tone: "good" };
  if (row.orders > 0) return { label: "有单观察", tone: "watch" };
  return { label: "样本较少", tone: "neutral" };
}
function SortHeader({ label, field, sort, onSort }: { label:string; field:string; sort:SortState; onSort:(field:string)=>void }) {
  const active=sort.key===field;
  return <button className={`sort-header ${active?'active':''}`} onClick={()=>onSort(field)} aria-label={`${label}，${active?(sort.direction==='desc'?'降序':'升序'):'点击排序'}`}>{label}<i>{active?(sort.direction==='desc'?'↓':'↑'):'↕'}</i></button>;
}
type EvidenceReport = { title: string; file: string; kind: string; date?: string; summary: string; metrics?: string[][]; sections: string[][] };
type UploadedReport = { id: string; fileName: string; title: string; kind: string; contentType: string; createdAt: string };
const REPORTS: EvidenceReport[] = [
  { title: "7月推广计划 v3.1 真实基线", file: "Wayfair_7月推广计划_v3真实基线_20260623.html", kind: "当前计划", date: "2026/06/23", summary: "以6月真实基线制定7月128 Orders目标、$790广告预算、SKU责任和活动节奏。", metrics: [["主目标","128 Orders"],["真实基线","102 Orders"],["广告预算","$790"],["预计净利","$3,394"],["冲刺目标","145 Orders"]], sections: [["01","目标阶梯","保底112、主目标128、冲刺145；长尾激活待新产品SOP，不计入承诺目标。"],["02","SKU责任","10个Listing拆解128 Orders；系统用订单API关联实际订单与件数。"],["03","数据冲突","正文基线102、SKU表合计100；DMOM1022正文10单、表格5单，均保留待确认。"],["04","广告联动","月预算、SKU角色、利润与链接Gate直接约束当前广告动作。"]] },
  { title: "Black Friday in July 官宣与广告策略", file: "Wayfair 北美地区 Black Friday in July官宣定档！.pdf", kind: "活动", date: "2026/07/16", summary: "官方活动规则已转成独立阶段策略，活动预算包含在7月$790内。", metrics: [["北美主活动","07/23-07/28"],["Canada Co-Invest","07/23-07/27"],["Flash窗口","07/26-07/27"],["活动广告上限","$330"],["商品锁定","07/21-07/28"]], sections: [["01","资格与费用","Flash Deal须07/17前确认；受邀SKU上线收取$75固定费，必须计入利润。"],["02","投放节奏","资格确认、预热、Member Day衔接、主活动、Flash窗口、收尾六阶段独立预算。"],["03","价格与商品","普通折扣不叠加；Conditional Offer会叠加；商品编辑在07/21-07/28锁定。"],["04","执行护栏","促销、利润、库存、链接和历史ROAS全部通过后，才释放活动Bid与Cap。"]] },
  { title: "8月150单完整增长 Playbook", file: "YB店_8月150单完整增长Playbook.html", kind: "下一计划", date: "2026/07/15", summary: "SKU目标、渠道预算、Campaign、Offer利润、周节奏和Scorecard的下一月计划。", metrics: [["目标口径","150 Units"],["6月基线","90 Units"],["基础预算","$1,800"],["预算硬上限","$2,500"],["WSC ROAS","≥ 3.2×"]], sections: [["01","SKU责任","10个Listing拆解150 Units；DMOM1021/1022/1019承担101件。"],["02","预算结构","基础广告预算$1,800；Keyword $750、Product $650、B2B $150、Canada $50、机动$200。"],["03","周节奏","W1/W2/W3/W4累计目标30/65/105/150；未过Gate不得解锁预算。"],["04","经营护栏","WSC ROAS目标≥3.2×，放量≥4.0×；Fill Rate≥95%，月花费硬上限$2,500。"]] },
  { title: "2026年6月月度复盘总览", file: "index.html", kind: "REVIEW", summary: "6月经营基线、诊断结论和全部复盘证据索引。", sections: [["01","经营基线","6月SKU拆解基线90 Units，为8月150 Units计划提供增量基准。"],["02","核心矛盾","流量并非唯一瓶颈；库存、Catalog、Listing承接和广告结构共同限制增长。"],["03","证据边界","不同报告日期和口径必须保留来源，不用下一月目标冒充当前月目标。"],["04","进入计划","复盘结论已结构化为SKU责任、预算Gate和周里程碑。"]] },
  { title: "店铺诊断报告", file: "YB店_店铺诊断报告.html", kind: "诊断", summary: "店铺增长是否成立、主要瓶颈和优先级判断。", sections: [["01","增长判断","增长成立，但不能靠无差别增加广告预算。"],["02","结构问题","头部SKU贡献集中，长尾商品和低质量链接稀释效率。"],["03","优先级","先修库存与目录，再修链接承接，最后扩广告。"],["04","验收","每项诊断必须落到负责人、期限和可量化验收条件。"]] },
  { title: "SKU健康体检", file: "YB店_SKU健康体检.html", kind: "SKU", summary: "90个Part的销量、Sessions/CVR、评分评论、目录和整改证据。", sections: [["01","商品范围","覆盖90个Supplier Part，不再只展示Catalog当前状态。"],["02","质量维度","Sessions、CVR、评分评论、内容问题、图片和目录状态共同判断链接质量。"],["03","运营分组","区分主力、修复、自然观察和永久剔除池。"],["04","广告联动","链接质量不通过时，只生成整改任务，不允许加Bid或扩预算。"]] },
  { title: "SKU广告重构执行清单", file: "YB店_SKU广告重构执行清单_2026-07-15.html", kind: "广告", summary: "SKU到Campaign/Listing的执行映射、参数和人工动作。", sections: [["01","执行层级","父体用于运营审阅；精确Listing载荷才可进入API Dry-run。"],["02","API边界","只有 Listing Bid 可由中台执行；Campaign状态、Daily Cap、tROAS、关键词和否词均不自动写入。"],["03","安全机制","一次只改变一个变量，保存前值、建议值、回滚值。"],["04","复查","D7只做安全止损；D21/D28用成熟归因评估结果。"]] },
  { title: "广告深度分析：商品+关键词", file: "YB店_广告深度分析_商品+关键词.html", kind: "广告", summary: "商品广告、关键词、搜索词与归因效率分析。", sections: [["01","历史证据","并列成熟7天、前7天、滚动28天和月累计。"],["02","漏斗","曝光→点击→转化→WSC ROAS逐层定位，不直接用订单数下结论。"],["03","盈利线","每个SKU按贡献毛利计算自己的保本ROAS。"],["04","数据成熟","14天归因未成熟的周期只观察，不进入执行审批。"]] },
  { title: "广告诊断报告", file: "YB店_广告诊断报告.html", kind: "广告", summary: "广告账户问题、止损对象和预算迁移机会。", sections: [["01","账户对账","Campaign与Listing花费需对账后才可信。"],["02","止损","成熟点击≥20且0单进入暂停或降Bid候选。"],["03","扩量","盈利、质量、库存、计划和预算余量全部通过才放量。"],["04","禁止项","计划预算为0或永久剔除对象禁止任何加价。"]] },
  { title: "150单SKU与广告预算分配论证", file: "YB店_150单SKU与广告预算分配论证_2026-07-15.html", kind: "预算", summary: "为什么给每个SKU目标与预算，以及释放边界。", sections: [["01","主力","DMOM1021目标50、预算$700；DMOM1022目标30、预算$340。"],["02","赢家","DMOM1019目标21、预算$290，以高效Keyword为主。"],["03","修复池","DMOM1018/1017/1000合计预算仅$50，严格Gate。"],["04","零预算池","DMOM1025/1026/1016与DRCI1007不得用广告救量。"]] },
  { title: "Conditional Offers 8月计划", file: "YB店_ConditionalOffers_8月150单增长计划.html", kind: "OFFER", summary: "Offer候选、利润底线、实验组与退出条件。", sections: [["01","盈利口径","WSC收入减出库成本、Offer Owed、广告和其他变动成本。"],["02","实验原则","A/B/C小流量验证；无增量或毛利<20%立即结束。"],["03","目标","Offer约20单，但不能以牺牲毛利换完成率。"],["04","归因","价格、Offer和广告同期变化必须记录，避免错误归因。"]] },
  { title: "新增四报前后对比", file: "YB店_新增四报前后对比.html", kind: "证据", summary: "新增报告对既有结论、目标和执行口径的修正。", sections: [["01","变化记录","保留旧结论和新证据，说明为什么修正。"],["02","数据冲突","冲突字段进入待确认，不选择性搬运。"],["03","影响范围","目标、预算、Campaign和SKU责任同步更新。"],["04","审计","每次计划变更保留时间、来源和责任人。"]] },
  { title: "店铺对标：类目均值", file: "YB店_店铺对标_类目均值.html", kind: "对标", summary: "店铺与类目均值在流量、转化和商品结构上的差异。", sections: [["01","用途","对标用于定位差距，不直接生成广告动作。"],["02","流量","曝光分位高但转化弱时，优先修承接。"],["03","转化","评分、评论、价格和内容是CVR诊断上下文。"],["04","目标","用类目基准校验计划是否可达，而非机械追平。"]] },
  { title: "运营ToDoList详细指引", file: "YB店_运营ToDoList_详细指引.html", kind: "任务", summary: "诊断结论到负责人、期限和验收物的运营任务。", sections: [["01","任务化","每项结论都有对象、负责人、截止日和验收物。"],["02","优先级","先处理影响业绩的P0/P1，再处理信息类待办。"],["03","跨模块","库存、商品、广告和月报共享同一任务状态。"],["04","闭环","完成后记录结果并进入下一次复盘证据。"]] },
  { title: "执行清单 XLSX", file: "YB店_SKU广告重构执行清单_2026-07-15.xlsx", kind: "表格", summary: "可下载、核对和执行的SKU广告参数账本。", sections: [["01","精确载荷","保存Listing、Campaign、当前Bid和建议Bid。"],["02","人工动作","Daily Cap、tROAS、关键词与否词分开列示。"],["03","回滚","每个动作保存原值和触发回滚的条件。"],["04","审批","个人测试阶段仅Dry-run，不执行生产写入。"]] },
];

function ShellHeader({ active, activeSub, onNavigate, onSubNavigate }: { active: View; activeSub: SubView | null; onNavigate: (view: View) => void; onSubNavigate: (view: SubView) => void }) {
  useEffect(()=>{if(window.innerWidth>760)return;const frame=requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.sidebar button[aria-current="page"]')?.scrollIntoView({block:'nearest',inline:'center'}));return()=>cancelAnimationFrame(frame);},[active,activeSub]);
  return <aside className="sidebar">
    <button className="brand" onClick={() => onNavigate("dashboard")}><span>W</span><strong>Wayfair AI</strong><small>运营中台</small></button>
    <nav className="nav" aria-label="主导航">
      {PRIMARY_NAV.map((item) => <div className={`nav-group ${active === item.id ? "expanded" : ""}`} key={item.id}><button className={active === item.id ? "active" : ""} aria-current={active===item.id&&!SUB_NAV[item.id]?.length?'page':undefined} aria-expanded={SUB_NAV[item.id]?.length?active===item.id:undefined} onClick={() => onNavigate(item.id)}>{item.label}</button>{active === item.id && SUB_NAV[item.id]?.length ? <div className="nav-submenu" aria-label={`${item.label}子菜单`}>{SUB_NAV[item.id]?.map((child) => <button key={child.id} className={activeSub === child.id ? "active" : ""} aria-current={activeSub===child.id?'page':undefined} onClick={() => onSubNavigate(child.id)}>{child.label}</button>)}</div> : null}</div>)}
    </nav>
    <nav className="nav utility-nav" aria-label="系统导航">
      {SYSTEM_NAV.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} aria-current={active===item.id?'page':undefined} onClick={() => onNavigate(item.id)}>{item.label}</button>)}
    </nav>
    <div className="system"><i></i><span><strong>生产数据已连接</strong><small>写操作需人工确认</small></span></div>
  </aside>;
}

function Hero({ eyebrow, title, text, side }: { eyebrow: string; title: string; text: string; side?: React.ReactNode }) {
  void eyebrow; void text;
  return <header className="hero page-heading"><h1>{title}</h1>{side}</header>;
}

function Dashboard() {
  const [checked, setChecked] = useState(false);
  const initialRange = rangeFor("today");
  const [preset, setPreset] = useState("today");
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [data, setData] = useState<OrderSummary | null>(dashboardSnapshot);
  const [emailBrief,setEmailBrief]=useState<EmailBrief|null>(emailBriefSnapshot);
  const [loading, setLoading] = useState(!dashboardSnapshot);
  const [error, setError] = useState("");

  useEffect(() => {
    const cacheKey = `orders:${start}:${end}`;
    const cached = readClientCache<OrderSummary>(cacheKey);
    const controller = new AbortController();
    if (cached) {
      queueMicrotask(()=>{if(!controller.signal.aborted){dashboardSnapshot=cached;setData(cached);setLoading(false);setError("");}});
      return () => controller.abort();
    }
    fetch(`/api/orders/summary?start=${start}&end=${end}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as OrderSummary;
        if (!response.ok) throw new Error(body.error || "订单数据读取失败");
        return body;
      })
      .then((body) => { dashboardSnapshot=body;setData(body);writeClientCache(cacheKey, body); })
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "订单数据读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [start, end]);

  useEffect(()=>{const cached=readClientCache<EmailBrief>('email:daily');const controller=new AbortController();if(cached){queueMicrotask(()=>{emailBriefSnapshot=cached;setEmailBrief(cached);});return()=>controller.abort();}fetch('/api/email/daily',{signal:controller.signal}).then(async response=>{const body=await response.json() as EmailBrief;if(!response.ok)throw new Error(body.error||'Outlook 日报读取失败');return body;}).then(body=>{emailBriefSnapshot=body;setEmailBrief(body);writeClientCache('email:daily',body);}).catch(()=>{});return()=>controller.abort();},[]);

  function selectPreset(next: string) {
    setPreset(next);
    if (next !== "custom") { const range = rangeFor(next); if (range.start !== start || range.end !== end) { setLoading(true); setError(""); setStart(range.start); setEnd(range.end); } }
  }

  const current = data?.current;
  const previous = data?.previous;
  const chartMax = Math.max(1, ...(data?.daily || []).map((item) => Number(item.revenue)));
  const rangeLabel = start === end ? start : `${start} - ${end}`;
  return <>
    <Hero eyebrow="ORDERS API · OPERATING BRIEF" title="Dashboard" text={`${rangeLabel} · 订单业绩、邮件摘要和运营待办`} side={<div className="hero-side"><b>{loading ? "同步中" : error ? "需检查" : "已更新"}</b><span>{data?.sync.stale ? "正在使用最近缓存" : "Ops API（库存 + 订单）"}</span></div>} />
    <section className="date-console" aria-label="经营周期">
      <div className="preset-list">{presetOptions.map(([id, label]) => <button key={id} className={preset === id ? "active" : ""} onClick={() => selectPreset(id)}>{label}</button>)}</div>
      {preset === "custom" && <div className="custom-range"><label>开始<input type="date" value={start} max={end} onChange={(event) => {setLoading(true);setError("");setStart(event.target.value);}} /></label><label>结束<input type="date" value={end} min={start} onChange={(event) => {setLoading(true);setError("");setEnd(event.target.value);}} /></label></div>}
      <span className={error ? "sync-state error" : "sync-state"}>{error || (data?.sync.stale ? `同步失败，显示缓存：${data.sync.error}` : data?.sync.syncedAt ? `最近同步 ${new Date(data.sync.syncedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "正在连接订单数据")}</span>
    </section>
    <section className="stat-grid six order-kpis">
      {[
        [loading ? "-" : money(current?.revenue), "销售额", change(current?.revenue, previous?.revenue)],
        [loading ? "-" : String(current?.orders || 0), "订单", change(current?.orders, previous?.orders)],
        [loading ? "-" : String(current?.units || 0), "件数", change(current?.units, previous?.units)],
        [loading ? "-" : money(current?.aov), "客单价", change(current?.aov, previous?.aov)],
        [loading ? "-" : money(current?.advertisingBeforeGrossProfit), "广告前商品毛利", `成本覆盖 ${Math.round((current?.costCoverage || 0) * 100)}% · 未覆盖部分按 ${((current?.marginRate || .2826) * 100).toFixed(2)}%估算`],
        [loading ? "-" : current?.contributionAfterAds == null ? "待广告同步" : money(current.contributionAfterAds), "广告后店铺贡献", current?.advertisingSpend == null ? "先到广告优化同步相同周期，不能伪称净利润" : `已扣广告费 ${money(current.advertisingSpend)} · ${current.advertisingCoverage === 'FULL' ? '完整覆盖' : '部分覆盖'}`],
      ].map(([value,label,note]) => <article className={`stat ${/毛利|贡献/.test(label) ? "profit-stat" : ""}`} key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}
    </section>
    <section className="card order-performance">
      <div className="section-head"><div><span>订单业绩</span><h2>{rangeLabel} 订单走势</h2></div><b>{data?.sync.refreshed ? "API 已刷新并写入缓存" : "每小时后台同步，读取已保存快照"}</b></div>
      <div className="order-performance-body">
        <div className="daily-bars">{(data?.daily || []).length ? data?.daily.map((item) => <div key={item.date} title={`${item.date} · ${money(item.revenue)} · ${item.orders} 单`}><span>{money(item.revenue)}</span><i style={{ height: `${Math.max(4, Number(item.revenue) / chartMax * 100)}%` }}></i><b>{item.date.slice(5)}</b></div>) : <p>{loading ? "正在拉取订单数据…" : "所选周期暂无订单"}</p>}</div>
        <aside className="top-skus"><span>热销 SKU</span>{(data?.topSkus || []).slice(0, 5).map((item, index) => <div key={item.partNumber}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.partNumber}</strong><small>{item.units} 件</small></span><em>{money(item.revenue)}</em></div>)}{!data?.topSkus?.length && <p>暂无 SKU 销售记录</p>}</aside>
      </div>
    </section>
    <div className="daily-grid outlook-dashboard">
      <article className="card feature-card outlook-brief">
        <div className="outlook-brief-head"><div><span className="pill amber">Outlook · Wayfair</span><h2>{emailBrief?.briefDate||'今日'} 邮件摘要</h2></div><div><strong>{emailBrief?.summary.total??'-'}</strong><small>封相关邮件 · {emailBrief?.summary.unread??'-'} 未读</small></div></div>
        <p className="meta">{emailBrief?.source||'正在读取 Outlook'} · {emailBrief?.syncedAt?`同步 ${new Date(emailBrief.syncedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`:'等待同步'}</p>
        <div className="outlook-mail-list">{(emailBrief?.items||[]).map(item=><a href={item.webLink} target="_blank" rel="noreferrer" key={item.id}><span className={`mail-priority ${item.priority.toLowerCase()}`}>{item.priority}</span><span><b>{item.subject}</b><small>{item.summary}</small></span><span><em>{item.unread?'未读':'已读'}</em><small>{item.owner} · {item.status}</small></span></a>)}{!emailBrief?.items?.length?<p>今日尚无 Wayfair 邮件。</p>:null}</div>
        <p className="handoff-note"><b>系统边界：</b>订单通知用于经营汇总和交接；本中台不执行发货。</p>
      </article>
      <aside className="side-stack">
        <article className="card risk-card"><h2>邮件风险</h2><div className="risk-number"><strong>{emailBrief?.summary.actionRequired??'-'}</strong><span>封需跟进</span></div><p>最高优先级 {emailBrief?.summary.highestPriority||'-'}。订单履约事项交接专职同事，运营只检查是否完成交接。</p><div className="soft-note">每天从 Outlook 读取 Wayfair 发件人和主题，摘要保存在运营数据库。</div></article>
        <article className="card todo-card"><h2>我的待办</h2>{(emailBrief?.tasks||[]).map((task,index)=><label key={task.id}><input type="checkbox" checked={index===0?checked:false} onChange={index===0?e=>setChecked(e.target.checked):undefined}/><span><b>{task.title}</b><small>{task.owner} · {task.priority} · 截止 {task.dueDate}</small></span></label>)}{!emailBrief?.tasks?.length?<p>今日没有从邮件提取的新待办。</p>:null}</article>
      </aside>
    </div>
  </>;
}

function Plan({ embedded = false, onOpenReview, tab, onTabChange }: { embedded?: boolean; onOpenReview: () => void; tab: PlanSection; onTabChange: (tab: PlanSection) => void }) {
  const [data,setData]=useState<PlanProgress|null>(readClientCache<PlanProgress>('plan:progress',CLIENT_CACHE_RETENTION_MS)); const [error,setError]=useState('');
  useEffect(()=>{const cached=readClientCache<PlanProgress>('plan:progress');if(cached){queueMicrotask(()=>setData(cached));return;}fetch('/api/plan/progress').then(async r=>{const body=await r.json() as PlanProgress;if(!r.ok)throw new Error(body.error||'计划读取失败');return body;}).then(body=>{setData(body);writeClientCache('plan:progress',body);}).catch(e=>setError(e.message));},[]);
  const p=data?.progress; const actual=data?.actual;
  return <>{!embedded&&<Hero eyebrow="MONTHLY OPERATING PLAN" title="目标与执行" text="6月复盘 → 7月真实基线执行 → 8月下一阶段准备；目标、利润与广告共用同一套运营计划" side={<button className="hero-button" onClick={onOpenReview}>查看完整复盘证据</button>} />}
    <section className="context-strip" aria-label="经营月份导航"><button aria-label="打开6月复盘资料" onClick={onOpenReview}><span>复盘月</span><b>2026-06</b><small>经营事实已归档</small></button><button aria-label="查看7月执行计划" className={tab!=='august'?'active':''} onClick={()=>onTabChange('july')}><span>当前经营月</span><b>{data?.currentOperatingMonth.month||'2026-07'} · 128 Orders</b><small>{data?.currentOperatingMonth.note||'真实基线计划读取中'}</small></button><button aria-label="查看8月准备计划" className={tab==='august'?'active':''} onClick={()=>onTabChange('august')}><span>下一计划月</span><b>2026-08 · 150 Units</b><small>准备阶段，不与7月目标混算</small></button></section>
    {error&&<div className="inline-error">{error}</div>}
    <section className="stat-grid six plan-kpis">{[
      [`${actual?.orders||0} / 128`,"7月订单完成",`${((p?.orderCompletion||0)*100).toFixed(1)}% · ${actual?.units||0} 件`],
      [`${p?.expectedOrders||0}`,"截至今日应完成",`节奏差 ${p?.paceGap||0} Orders`],
      [`${p?.forecastOrders||0}`,"月末订单预测",`剩余 ${p?.remainingOrders??128} Orders`],
      [`${p?.requiredDailyOrders||0}`,"后续所需日均",`按剩余天数计算 · 截至 ${data?.asOf||'-'}`],
      [actual?.adSpend==null?'待广告同步':money(actual.adSpend),"7月广告实际",`月预算 $790 · ${actual?.adCoverage||'未覆盖'}`],
      [actual?.contributionAfterAds==null?'待广告同步':money(actual.contributionAfterAds),"广告后店铺贡献",`${actual?.adCoverage==='FULL'?'广告完整覆盖':'广告仅部分覆盖'} · 成本覆盖 ${Math.round((actual?.costCoverage||0)*100)}% · 计划预计净利 $3,394`],
    ].map(([value,label,note])=><article className="stat" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}</section>
    <div className="plan-tabs"><button className={tab==='july'?'active':''} onClick={()=>onTabChange('july')}>7月执行计划</button><button className={tab==='bfij'?'active':''} onClick={()=>onTabChange('bfij')}>BFIJ 活动广告策略</button><button className={tab==='august'?'active':''} onClick={()=>onTabChange('august')}>8月准备计划</button></div>
    {tab==='july'&&<><div className="plan-workspace">
      <article className="card target-card"><div className="section-head"><div><span>SKU 责任</span><h2>128 Orders责任拆解与订单API实际</h2></div><b>来源：真实基线 v3.1 · 2026-06-23</b></div><div className="plan-table july"><div className="plan-row head"><span>Listing / Part</span><span>6月基线</span><span>7月目标</span><span>实际订单 / 件</span><span>广告预算</span><span>策略与Gate</span></div>{(data?.listings||[]).map(item=><div className="plan-row" key={item.listing}><span><b>{item.listing}</b><small>{item.parts.join(' · ')}</small></span><span>{item.juneBaselineOrders}</span><span><b>{item.julyTargetOrders}</b></span><span><b>{item.actualOrders} / {item.actualUnits}</b><small>{money(item.actualRevenue)}</small></span><span>{money(item.budget)}<small>预计净利 {money(item.estimatedNetProfit)}</small></span><span><b>{item.role} · {item.tactic}</b><small>{item.gate}{item.sourceWarning?` · ${item.sourceWarning}`:''}</small></span></div>)}</div></article>
      <aside className="card milestone-card"><div className="section-head"><div><span>活动节点</span><h2>活动节奏</h2></div></div><div className="milestones">{(data?.events||[]).map(item=><div key={item.label}><b>{item.label}<small>{item.range}</small></b><strong>{item.range.includes('23')?'当前重点':'记录'}</strong><p>{item.note}</p></div>)}</div></aside>
    </div><div className="scope-alert"><b>来源口径冲突</b><span>{data?.plan.scopeWarning||'正在读取7月计划来源说明。'}</span></div></>}
    {tab==='bfij'&&<><section className="activity-brief card"><div><span>OFFICIAL EVENT · 2026</span><h2>{data?.activity.name||'Black Friday in July 广告策略'}</h2><p>北美主活动 {data?.activity.officialEventRange.replace('/',' → ')||'07/23 → 07/28'}；Canada Co-Invest {data?.activity.canadaCoInvestRange.replace('/',' → ')||'07/23 → 07/27'}。活动预算与7月月计划共用同一预算池。</p></div><div><small>活动窗口建议上限</small><strong>{money(data?.activity.strategyBudget||330)}</strong><span>/ 7月 {money(data?.activity.monthlyBudget||790)}</span></div></section>
      <section className="activity-facts"><article><span>07/17 前</span><b>确认 Flash Deal</b><small>只有收到邀请的SKU才进入；每个上线SKU固定费$75计入利润。</small></article><article><span>07/21-07/28</span><b>商品编辑锁定</b><small>Listing、折扣、媒体和变体必须在锁定前完成核查。</small></article><article><span>07/23-07/28</span><b>北美主活动</b><small>普通折扣不叠加；Conditional Offer会叠加，必须核算最终折扣。</small></article><article><span>14天后</span><b>归因复盘</b><small>活动当日只看预算、库存与异常，不用未成熟ROAS做结论。</small></article></section>
      <section className="card activity-plan"><div className="section-head"><div><span>活动投放</span><h2>六阶段广告执行表</h2></div><b>{data?.activity.budgetNote||'活动预算包含在7月总预算内'}</b></div><div className="phase-list"><div className="phase-head"><span>阶段</span><span>预算上限</span><span>Bid规则</span><span>Cap规则</span><span>运营目标</span></div>{(data?.activity.phases||[]).map(phase=><article className={data?.activity.activePhase===phase.id?'active':''} key={phase.id}><div><b>{phase.label}</b><small>{phase.range}</small></div><strong>{money(phase.budgetCap)}</strong><p>{phase.bidRule}</p><p>{phase.capRule}</p><p>{phase.objective}</p></article>)}</div></section>
      <div className="scope-alert"><b>7–8月共用 CPC 基准</b><span>Makeace 6月报告 P{data?.cpcPlan.sourcePage||22}：Filing {money2(data?.cpcPlan.categoryBenchmarks['Filing Cabinets']||.53)}、Bike/Rack {money2(data?.cpcPlan.categoryBenchmarks['Bike And Sport Racks']||.57)}。BM CPC是成本锚，不是直接写入的Bid；有订单组单次最多降10%，活动赢家只加Cap，且先保留8月责任库存。</span></div></>}
    {tab==='august'&&<><div className="plan-workspace">
      <article className="card target-card"><div className="section-head"><div><span>8月准备</span><h2>150 Units下一计划责任表</h2></div><b>来源：Playbook · {data?.nextPlan.plan.sourceAsOf||'2026-07-15'}</b></div><div className="plan-table"><div className="plan-row head"><span>Listing / Part</span><span>6月基线</span><span>8月目标</span><span>实际</span><span>广告预算</span><span>角色与Gate</span></div>{(data?.nextPlan.listings||[]).map(item=><div className="plan-row" key={item.listing}><span><b>{item.listing}</b><small>{item.parts.join(' · ')}</small></span><span>{item.juneUnits}</span><span><b>{item.augustUnits}</b></span><span>{item.actualUnits}</span><span>{money(item.budget)}</span><span><b>{item.role}</b><small>{item.gate}</small></span></div>)}</div></article>
      <aside className="card milestone-card"><div className="section-head"><div><span>周里程碑</span><h2>8月周里程碑</h2></div></div><div className="milestones">{(data?.nextPlan.milestones||[]).map(item=><div key={item.label}><b>{item.label}<small>{item.range}</small></b><strong>{item.cumulative?`${item.cumulative} Units`:'准备'}</strong><p>{item.note}</p></div>)}</div></aside>
    </div><div className="scope-alert"><b>8月承接规则</b><span>继续使用 Makeace P{data?.cpcPlan.sourcePage||22} BM CPC锚；BFIJ不透支8月责任库存，活动成熟归因再决定8月首周Cap。{data?.nextPlan.plan.scopeWarning||'8月责任表按Units跟踪。'}</span></div></>}
  </>;
}

function Inventory({ embedded = false }: { embedded?: boolean }) {
  type Preview={snapshotId?:string;sourceFile?:string;createdAt?:string;canPush?:boolean;summary?:{totalRows:number;supplierCount:number;zeroStockRows:number;missingCombinations:number;totalQuantityOnHand:number;ignoredStockRows:number};warnings?:{message:string}[];errors?:{message:string}[];error?:string};
  const savedPreview=readClientCache<Preview>('inventory:preview',CLIENT_CACHE_RETENTION_MS);
  const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState<Preview|null>(savedPreview);const [state,setState]=useState(savedPreview?.snapshotId?'最近快照可用':"读取最近快照");const [busy,setBusy]=useState(false);const [confirmation,setConfirmation]=useState("");const [zeroConfirmed,setZeroConfirmed]=useState(false);const [message,setMessage]=useState("");
  useEffect(()=>{const cached=readClientCache<Preview>('inventory:preview');const controller=new AbortController();if(cached){queueMicrotask(()=>{setPreview(cached);setState(cached.snapshotId?'最近快照可用':'等待库存文件');});return()=>controller.abort();}fetch('/api/inventory/preview',{signal:controller.signal}).then(async r=>await r.json() as Preview).then(body=>{if(body.snapshotId){setPreview(body);setState('最近快照可用');writeClientCache('inventory:preview',body);}else setState('等待库存文件');}).catch(()=>setState('等待库存文件'));return()=>controller.abort();},[]);
  async function validate(){if(!file)return;setBusy(true);setMessage('');setState('正在解析与校验');try{const form=new FormData();form.set('file',file);const response=await fetch('/api/inventory/preview',{method:'POST',body:form});const body=await response.json() as Preview;if(!response.ok)throw new Error(`${body.error||'库存校验失败'}${body.errors?.[0]?.message?`：${body.errors[0].message}`:''}`);setPreview(body);writeClientCache('inventory:preview',body);invalidateClientCache('ads:');setState('校验通过 · 已入库');setMessage(`已保存库存快照 ${body.snapshotId?.slice(0,8)}；广告放量Gate将在下次打开时自动读取。`);}catch(error){setState('校验未通过');setMessage(error instanceof Error?error.message:'库存校验失败');}finally{setBusy(false);}}
  async function push(dryRun:boolean){if(!preview?.snapshotId)return;setBusy(true);setMessage('');setState(dryRun?'正在执行Dry-run':'正在提交Wayfair');try{const response=await fetch('/api/inventory/push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshotId:preview.snapshotId,dryRun,confirmation,zeroStockConfirmed:zeroConfirmed})});const body=await response.json() as {error?:string;itemCount?:number;batchCount?:number;mode?:string};if(!response.ok)throw new Error(body.error||'库存推送失败');setState(dryRun?'Dry-run 已通过':'已提交Wayfair');setMessage(dryRun?`Dry-run完成：${body.itemCount}条记录，拆分${body.batchCount}个批次；尚未写入Wayfair。`:`正式库存已提交，共${body.itemCount}条。`);}catch(error){setState(dryRun?'Dry-run 失败':'正式推送被阻止');setMessage(error instanceof Error?error.message:'库存推送失败');}finally{setBusy(false);}}
  const metrics=[["可推送行",preview?.summary?.totalRows],["Supplier",preview?.summary?.supplierCount],["零库存",preview?.summary?.zeroStockRows],["未匹配组合",preview?.summary?.missingCombinations]];
  return <>{!embedded&&<Hero eyebrow="INVENTORY UPDATE · CONTROLLED WRITE" title="库存更新" text="真实解析领星库存、套用SKU/仓库映射、持久化快照，再执行Dry-run与受控推送" side={<div className="hero-side"><b>{state}</b><span>{preview?.sourceFile||'尚无库存快照'}</span></div>} />}
    <div className="inventory-grid"><article className="card upload-card"><span className="step">库存文件与校验</span><h2>生成库存快照</h2><label className="drop"><input type="file" accept=".xlsx" onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);setState(next?'文件待校验':preview?'最近快照可用':'等待库存文件');setMessage('');}}/><b>{file?.name||preview?.sourceFile||"选择领星库存 XLSX"}</b><span>读取品名、SKU、仓库、可用量、锁定量、待到货与调拨在途；映射表已固化为当前生产版本</span></label><button className="primary" disabled={!file||busy} onClick={validate}>{busy&&state.includes('解析')?'校验中…':'校验并保存快照'}</button>{preview?.createdAt&&<div className="snapshot-note">最近快照 {new Date(preview.createdAt).toLocaleString('zh-CN')} · 库存合计 {preview.summary?.totalQuantityOnHand||0}</div>}</article><article className="card gate-card"><span className="step">预检与确认</span><h2>推送前检查</h2><div className="gate-metrics">{metrics.map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{value??'-'}</strong></div>)}</div>{preview?.warnings?.length?<div className="soft-note">{preview.warnings.map(item=>item.message).join('；')}</div>:<div className="soft-note">只有真实校验通过的D1快照可进入Dry-run；正式推送不会复用浏览器临时状态。</div>}<button className="primary" disabled={!preview?.canPush||busy} onClick={()=>push(true)}>执行 Wayfair API Dry-run</button><div className="live-confirm"><label>正式确认<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="输入：正式推送"/></label><label className="zero-check"><input type="checkbox" checked={zeroConfirmed} onChange={e=>setZeroConfirmed(e.target.checked)}/>确认零库存记录会改变可售状态</label><button className="primary dark" disabled={!preview?.canPush||busy||confirmation!=='正式推送'} onClick={()=>push(false)}>正式推送库存</button></div>{message&&<div className={state.includes('失败')||state.includes('阻止')||state.includes('未通过')?'inventory-message bad':'inventory-message good'}>{message}</div>}</article></div>
  </>;
}

function Ads({ tab }: { tab: AdsTab }) {
  const initial=adRangeFor('matureWeek');
  const initialAnalysis=readClientCache<AdAnalysis>(`ads:${initial.start}:${initial.end}`,CLIENT_CACHE_RETENTION_MS);
  const initialQueue=initialAnalysis?.runKey?readClientCache<AdQueueCache>(`ad-queue:${initialAnalysis.runKey}`,CLIENT_CACHE_RETENTION_MS):null;
  const [preset,setPreset]=useState('matureWeek');
  const [start,setStart]=useState(initial.start); const [end,setEnd]=useState(initial.end); const [requested,setRequested]=useState({start:initial.start,end:initial.end,refresh:false});
  const [data,setData]=useState<AdAnalysis|null>(initialAnalysis); const [loading,setLoading]=useState(!initialAnalysis); const [error,setError]=useState('');
  const [queueState,setQueueState]=useState<Record<string,string>>(queuedActionState(initialQueue?.actions||[]));
  const [queuedActions,setQueuedActions]=useState<QueuedAdAction[]>(initialQueue?.actions||[]); const [queueLoading,setQueueLoading]=useState(false); const [queueError,setQueueError]=useState('');
  const [liveEnabled,setLiveEnabled]=useState(Boolean(initialQueue?.liveEnabled)); const [batchBusy,setBatchBusy]=useState(false); const [batchMessage,setBatchMessage]=useState('');
  const [actionQuery,setActionQuery]=useState(''); const [recommendationFilter,setRecommendationFilter]=useState('ALL'); const [queueFilter,setQueueFilter]=useState('ALL');
  const [managerQuery,setManagerQuery]=useState(''); const [managerStatus,setManagerStatus]=useState('ALL');
  const [campaignSort,setCampaignSort]=useState<SortState>({key:'spend',direction:'desc'}); const [listingSort,setListingSort]=useState<SortState>({key:'spend',direction:'desc'});
  const [historyWeeks,setHistoryWeeks]=useState<AdHistoryWeek[]>(readClientCache<AdHistoryWeek[]>('ad-history',CLIENT_CACHE_RETENTION_MS)||[]);
  const [gateOverrides,setGateOverrides]=useState<string[]>([]);
  const [selectedRecommendations,setSelectedRecommendations]=useState<string[]>([]); const [selectedQueue,setSelectedQueue]=useState<string[]>([]); const [queueStatusFilter,setQueueStatusFilter]=useState('ALL');
  useEffect(()=>{const cacheKey=`ads:${requested.start}:${requested.end}`;const cached=!requested.refresh&&readClientCache<AdAnalysis>(cacheKey);const controller=new AbortController();if(cached){queueMicrotask(()=>{if(!controller.signal.aborted){setData(cached);setLoading(false);setError('');}});return()=>controller.abort();}fetch(`/api/ads/analysis?start=${requested.start}&end=${requested.end}${requested.refresh?'&refresh=1':''}`,{signal:controller.signal}).then(async r=>{const body=await r.json() as AdAnalysis;if(!r.ok)throw new Error(body.error||'广告分析失败');return body;}).then(body=>{setData(body);writeClientCache(cacheKey,body);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[requested]);
  useEffect(()=>{if(!data?.runKey)return;const cacheKey=`ad-queue:${data.runKey}`;const cached=readClientCache<AdQueueCache>(cacheKey);const controller=new AbortController();setQueueError('');if(cached){queueMicrotask(()=>{if(!controller.signal.aborted){setQueuedActions(cached.actions);setQueueState(queuedActionState(cached.actions));setLiveEnabled(cached.liveEnabled);setQueueLoading(false);}});return()=>controller.abort();}setQueueLoading(true);fetch(`/api/ads/actions?runKey=${encodeURIComponent(data.runKey)}`,{signal:controller.signal}).then(async response=>{const body=await response.json() as {actions?:QueuedAdAction[];liveEnabled?:boolean;error?:string};if(!response.ok)throw new Error(body.error||'执行批次读取失败');return body;}).then(body=>{const actions=body.actions||[];const next={actions,liveEnabled:Boolean(body.liveEnabled)};setQueuedActions(actions);setQueueState(queuedActionState(actions));setLiveEnabled(next.liveEnabled);writeClientCache(cacheKey,next);}).catch(reason=>{if(reason.name!=='AbortError')setQueueError(reason.message||'执行批次读取失败');}).finally(()=>{if(!controller.signal.aborted)setQueueLoading(false);});return()=>controller.abort();},[data?.runKey]);
  useEffect(()=>{if(tab!=='ai')return;const cached=readClientCache<AdHistoryWeek[]>('ad-history');const controller=new AbortController();if(cached){queueMicrotask(()=>setHistoryWeeks(cached));return()=>controller.abort();}fetch('/api/ads/history',{signal:controller.signal}).then(async response=>{const body=await response.json() as {weeks?:AdHistoryWeek[]};if(response.ok){const weeks=body.weeks||[];setHistoryWeeks(weeks);writeClientCache('ad-history',weeks);}}).catch(()=>{});return()=>controller.abort();},[tab,data?.runKey,queuedActions.length]);
  function selectAdPreset(next:string){setPreset(next);if(next==='custom')return;const range=adRangeFor(next);setStart(range.start);setEnd(range.end);setLoading(true);setError('');setRequested({...range,refresh:false});}
  async function reloadQueue(){if(!data?.runKey)return;const response=await fetch(`/api/ads/actions?runKey=${encodeURIComponent(data.runKey)}`);const body=await response.json() as {actions?:QueuedAdAction[];liveEnabled?:boolean;error?:string};if(!response.ok)throw new Error(body.error||'执行批次读取失败');const actions=body.actions||[];const next={actions,liveEnabled:Boolean(body.liveEnabled)};setQueuedActions(actions);setQueueState(queuedActionState(actions));setLiveEnabled(next.liveEnabled);writeClientCache(`ad-queue:${data.runKey}`,next);invalidateClientCache('ad-history');}
  async function queueAction(row:AdListing){const key=`${row.campaignId}:${row.listing}`;setQueueState(value=>({...value,[key]:'saving'}));setBatchMessage('');try{const response=await fetch('/api/ads/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runKey:data?.runKey,listing:row.listing,campaignId:row.campaignId,actionType:row.action.type,before:row.action.before,proposed:row.action.proposed})});const body=await response.json() as {message?:string;error?:string};if(!response.ok)throw new Error(body.error||'执行单保存失败');await reloadQueue();setBatchMessage('已加入页面上方的“本周执行批次”，刷新页面仍会保留。');}catch(reason){setQueueState(value=>({...value,[key]:reason instanceof Error?reason.message:'保存失败'}));}}
  async function removeAction(action:QueuedAdAction){setBatchBusy(true);setBatchMessage('');try{const response=await fetch(`/api/ads/actions?id=${encodeURIComponent(action.id)}`,{method:'DELETE'});const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error||'移除失败');await reloadQueue();setBatchMessage('已从本周执行批次移除。');}catch(reason){setBatchMessage(reason instanceof Error?reason.message:'移除失败');}finally{setBatchBusy(false);}}
  async function postExecution(dryRun:boolean){if(!data?.runKey)throw new Error('执行批次尚未生成');const response=await fetch('/api/ads/actions/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runKey:data.runKey,dryRun,confirmation:dryRun?undefined:'执行广告修改'})});const body=await response.json() as {message?:string;error?:string};await reloadQueue();if(!response.ok)throw new Error(body.error||'广告执行失败');return body;}
  async function queueSelected(){if(!data?.runKey)return;const rows=(data.listings||[]).filter(row=>selectedRecommendations.includes(`${row.campaignId}:${row.listing}`));if(!rows.length)return;setBatchBusy(true);setBatchMessage('');try{const results=await Promise.all(rows.map(async row=>{const response=await fetch('/api/ads/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runKey:data.runKey,listing:row.listing,campaignId:row.campaignId,actionType:row.action.type,before:row.action.before,proposed:row.action.proposed})});const body=await response.json() as {error?:string};if(!response.ok)throw new Error(`${row.listing}: ${body.error||'加入失败'}`);return row;}));await reloadQueue();setSelectedRecommendations([]);setBatchMessage(`已加入 ${results.length} 项到本周执行批次。`);}catch(reason){setBatchMessage(reason instanceof Error?reason.message:'批量加入失败');}finally{setBatchBusy(false);}}
  function toggleQueueSelection(action:QueuedAdAction,source:AdListing|undefined,checked:boolean){
    if(!checked){setSelectedQueue(value=>value.filter(id=>id!==action.id));setGateOverrides(value=>value.filter(id=>id!==action.id));return;}
    const gateBlocked=action.status==='PLANNED'&&source?.action.execution!=='READY_FOR_PLAN';
    if(gateBlocked){const reason=source?.action.blockers.join('；')||'当前周期未通过自动执行 Gate';if(!window.confirm(`该 Bid 未通过自动 Gate：${reason}\n\n确认由运营人工覆盖，并将此确认写入审计记录？`))return;setGateOverrides(value=>value.includes(action.id)?value:[...value,action.id]);}
    setSelectedQueue(value=>value.includes(action.id)?value:[...value,action.id]);
  }
  async function prepareSelected(){const actions=queuedActions.filter(action=>selectedQueue.includes(action.id)&&isBulkApprovable(action));if(!actions.length&&!approvedActions.length)return;setBatchBusy(true);setBatchMessage('');try{await Promise.all(actions.map(async action=>{const source=data?.listings.find(row=>row.campaignId===action.campaign_id&&row.listing===action.listing);const override=gateOverrides.includes(action.id);const response=await fetch('/api/ads/actions',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:action.id,status:'APPROVED',override,note:override?(source?.action.blockers.join('；')||'运营人工确认覆盖自动 Gate'):''})});const body=await response.json() as {error?:string};if(!response.ok)throw new Error(`${action.listing}: ${body.error||'确认失败'}`);}));const body=await postExecution(true);setSelectedQueue([]);setGateOverrides([]);setBatchMessage(body.message||`已确认并预检 ${actions.length+approvedActions.length} 项。`);}catch(reason){setBatchMessage(reason instanceof Error?reason.message:'确认并预检失败');}finally{setBatchBusy(false);}}
  async function executeValidated(){if(!validatedActions.length||!window.confirm(`将正式修改 ${validatedActions.length} 项 Wayfair 广告。是否继续？`))return;setBatchBusy(true);setBatchMessage('');try{const body=await postExecution(false);setBatchMessage(body.message||'执行完成，逐项结果已更新。');}catch(reason){setBatchMessage(reason instanceof Error?reason.message:'广告执行失败');}finally{setBatchBusy(false);}}
  const visibleHistory=(data?.history||[]).filter(x=>x.date>=requested.start&&x.date<=requested.end);
  const dailySpendMax=Math.max(1,...visibleHistory.map(x=>x.spend));
  const ready=data?.listings.filter(x=>x.action.recommendation==='READY').length||0;
  const needsInput=data?.listings.filter(x=>x.action.execution==='NEEDS_INPUT').length||0;
  const noChange=data?.listings.filter(x=>x.action.recommendation==='NO_CHANGE').length||0;
  const approvedActions=queuedActions.filter(item=>item.status==='APPROVED'); const validatedActions=queuedActions.filter(item=>item.status==='VALIDATED'); const executedActions=queuedActions.filter(item=>item.status==='EXECUTED'); const failedActions=queuedActions.filter(item=>item.status==='FAILED');
  const filteredListings=filterAdActions(data?.listings||[],{query:actionQuery,recommendation:recommendationFilter,queue:queueFilter},queueState) as AdListing[];
  const selectableListings=filteredListings.filter(row=>row.action.type!=='HOLD'&&!queueState[`${row.campaignId}:${row.listing}`]);
  const filteredQueue=queuedActions.filter(action=>queueStatusFilter==='ALL'||action.status===queueStatusFilter);
  const approvableQueue=filteredQueue.filter(action=>action.action_type==='SET_LISTING_BID'&&isBulkApprovable(action)&&(action.status==='FAILED'||gateOverrides.includes(action.id)||data?.listings.find(row=>row.campaignId===action.campaign_id&&row.listing===action.listing)?.action.execution==='READY_FOR_PLAN'));
  const normalizedManagerQuery=managerQuery.trim().toLowerCase();
  const managerCampaigns=sortRows((data?.campaigns||[]).filter(row=>!normalizedManagerQuery||[row.campaignId,row.name,row.targetingType,row.site].some(value=>String(value||'').toLowerCase().includes(normalizedManagerQuery))),campaignSort,{name:(row:AdCampaign)=>row.name,status:(row:AdCampaign)=>row.status,dailyCap:(row:AdCampaign)=>Number(row.dailyCap||0),impressions:(row:AdCampaign)=>row.impressions,clicks:(row:AdCampaign)=>row.clicks,ctr:(row:AdCampaign)=>row.ctr,spend:(row:AdCampaign)=>row.spend,cpc:(row:AdCampaign)=>metricCpc(row),orders:(row:AdCampaign)=>row.orders,units:(row:AdCampaign)=>row.units,cpa:(row:AdCampaign)=>row.cpa,wsc:(row:AdCampaign)=>row.wsc,retail:(row:AdCampaign)=>row.retail,wscRoas:(row:AdCampaign)=>row.wscRoas,retailRoas:(row:AdCampaign)=>row.retailRoas}) as AdCampaign[];
  const managerListings=sortRows((data?.listings||[]).filter(row=>(managerStatus==='ALL'||String(row.status||'').toUpperCase().includes(managerStatus))&&(!normalizedManagerQuery||[row.listing,row.campaignId,row.campaignName,row.productName,row.className,row.site,...row.parts].some(value=>String(value||'').toLowerCase().includes(normalizedManagerQuery)))),listingSort,{listing:(row:AdListing)=>row.listing,status:(row:AdListing)=>row.status,bid:(row:AdListing)=>row.bid,impressions:(row:AdListing)=>row.current.impressions,clicks:(row:AdListing)=>row.current.clicks,ctr:(row:AdListing)=>row.current.ctr,spend:(row:AdListing)=>row.current.spend,cpc:(row:AdListing)=>metricCpc(row.current),orders:(row:AdListing)=>row.current.orders,units:(row:AdListing)=>row.current.units,cpa:(row:AdListing)=>row.current.cpa,wsc:(row:AdListing)=>row.current.wsc,retail:(row:AdListing)=>row.current.retail,cvr:(row:AdListing)=>row.current.cvr,wscRoas:(row:AdListing)=>row.current.wscRoas,retailRoas:(row:AdListing)=>row.current.retailRoas}) as AdListing[];
  const sortCampaign=(field:string)=>setCampaignSort(value=>nextSort(value,field) as SortState); const sortListing=(field:string)=>setListingSort(value=>nextSort(value,field) as SortState);
  const pageTitle=tab==='manager'?'广告管理器':tab==='listings'?'Listing 表现':'广告 AI 优化';
  const pageCount=tab==='manager'?`${data?.campaigns.length||0} 个 Campaign`:tab==='listings'?`${data?.listings.length||0} 个 Listing`:`${ready} 项待处理`;
  return <><Hero eyebrow="" title={pageTitle} text="" side={<div className="hero-side compact-status"><b>{loading?'同步中':error?'需检查':pageCount}</b><span>{requested.start} 至 {requested.end}</span></div>} />
    <section className="period-bar ad-period"><div>{adPresetOptions.map(([id,label])=><button key={id} className={preset===id?'active':''} onClick={()=>selectAdPreset(id)}>{label}</button>)}</div>{preset==='custom'&&<><label>开始<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束<input type="date" value={end} max={dateText(new Date())} onChange={e=>setEnd(e.target.value)}/></label><button disabled={loading||start>end} onClick={()=>{setLoading(true);setError('');setRequested({start,end,refresh:false});}}>读取</button></>}<span>{error||`每小时自动同步 · 最近入库 ${data?.generatedAt?new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'-'} · 决策成熟周 ${data?.decisionRange.start||'-'} → ${data?.decisionRange.end||'-'}`}</span></section>
    {error&&<div className="inline-error">{error}；系统未展示任何静态替代建议。</div>}
    {tab!=='ai'&&<>
      <section className="stat-grid six ad-manager-kpis">{[
        [loading?'-':money(data?.current.spend),"花费",change(data?.current.spend,data?.previous.spend)],
        [loading?'-':String(data?.current.impressions||0),"曝光",`CTR ${((data?.current.ctr||0)*100).toFixed(2)}%`],
        [loading?'-':String(data?.current.clicks||0),"点击",`CPC ${money2(metricCpc(data?.current))}`],
        [loading?'-':String(data?.current.orders||0),"归因订单",`CVR ${((data?.current.cvr||0)*100).toFixed(2)}%`],
        [loading?'-':String(data?.current.units||0),"归因件数",`前周期 ${data?.previous.units||0} 件`],
        [loading?'-':`${(data?.current.wscRoas||0).toFixed(2)}×`,"WSC ROAS",`WSC ${money(data?.current.wsc||0)} · Retail ${money(data?.current.retail||0)}`],
      ].map(([value,label,note])=><article className="stat" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}</section>
      <section className="manager-source"><div><b>Advertising API</b><span>Campaign Report + Listing Report</span></div><div><b>{data?.cache?.layer||'连接中'}</b><span>{data?.generatedAt?`更新 ${new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`:'正在读取'}</span></div><div><b>{managerCampaigns.length} / {managerListings.length}</b><span>Campaign / Listing</span></div></section>
      {tab==='manager'&&<section className="card ad-manager-card"><div className="section-head"><div><span>账户结构</span><h2>Campaign 管理</h2></div><b>{managerCampaigns.length} 个 Campaign</b></div>
        <div className="manager-filters"><label>搜索<input value={managerQuery} onChange={event=>setManagerQuery(event.target.value)} placeholder="Campaign、投放类型或站点"/></label></div>
        <div className="api-table-scroll"><div className="api-table campaign-manager-table"><div className="api-row head"><SortHeader label="Campaign" field="name" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="状态 / 客群" field="status" sort={campaignSort} onSort={sortCampaign}/><span>投放类型 / 策略</span><SortHeader label="Daily Cap" field="dailyCap" sort={campaignSort} onSort={sortCampaign}/><span>Lifetime Budget</span><span>Target ROAS</span><span>投放周期</span><SortHeader label="曝光" field="impressions" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="点击" field="clicks" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="CTR" field="ctr" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="花费" field="spend" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="CPC" field="cpc" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="订单" field="orders" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="件数" field="units" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="CPA" field="cpa" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="WSC 销售额" field="wsc" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="Retail 销售额" field="retail" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="WSC ROAS" field="wscRoas" sort={campaignSort} onSort={sortCampaign}/><SortHeader label="Retail ROAS" field="retailRoas" sort={campaignSort} onSort={sortCampaign}/></div>{managerCampaigns.map(row=><article className="api-row" key={row.campaignId}><span><b>{row.name||`Campaign ${row.campaignId}`}</b><small>ID {row.campaignId} · {row.site||'-'}</small></span><span><em className={/active/i.test(row.status)&&!/false/i.test(row.isActive)?'good':'bad'}>{row.status||'—'}</em><small>{String(row.isB2b).toLowerCase()==='true'?'B2B':'B2C'}</small></span><span><b>{row.targetingType||'-'}</b><small>{row.strategy||'-'}</small></span><b>{adBudgetValue(row.dailyCap)}</b><b>{adBudgetValue(row.lifetimeBudget)}</b><b>{row.targetRoas?`${row.targetRoas}%`:'—'}</b><span><b>{row.startDate||'—'}</b><small>至 {row.endDate||'NO END DATE'}</small></span><b>{row.impressions}</b><b>{row.clicks}</b><b>{(row.ctr*100).toFixed(2)}%</b><b>{money2(row.spend)}</b><b>{money2(metricCpc(row))}</b><b>{row.orders}</b><b>{row.units}</b><b>{money2(row.cpa)}</b><b>{money2(row.wsc)}</b><b>{money2(row.retail)}</b><strong>{row.wscRoas.toFixed(2)}×</strong><strong>{row.retailRoas.toFixed(2)}×</strong></article>)}{!loading&&!managerCampaigns.length?<p className="empty-state">当前筛选没有 Campaign 数据。</p>:null}</div></div>
      </section>}
      {tab==='listings'&&<section className="card ad-manager-card"><div className="section-head"><div><span>商品投放</span><h2>Listing 表现</h2></div><b>{managerListings.length} 个 Listing</b></div><div className="manager-filters"><label>搜索<input value={managerQuery} onChange={event=>setManagerQuery(event.target.value)} placeholder="Listing、Campaign、商品或 Part"/></label><label>状态<select value={managerStatus} onChange={event=>setManagerStatus(event.target.value)}><option value="ALL">全部状态</option><option value="ACTIVE">投放中</option><option value="PAUSE">已暂停</option><option value="INACTIVE">未启用</option></select></label></div><div className="api-table-scroll"><div className="api-table listing-manager-table"><div className="api-row head"><SortHeader label="Listing / Campaign" field="listing" sort={listingSort} onSort={sortListing}/><span>商品名称 / 类目</span><SortHeader label="状态 / 客群" field="status" sort={listingSort} onSort={sortListing}/><SortHeader label="Bid" field="bid" sort={listingSort} onSort={sortListing}/><SortHeader label="曝光" field="impressions" sort={listingSort} onSort={sortListing}/><SortHeader label="点击" field="clicks" sort={listingSort} onSort={sortListing}/><SortHeader label="CTR" field="ctr" sort={listingSort} onSort={sortListing}/><SortHeader label="花费" field="spend" sort={listingSort} onSort={sortListing}/><SortHeader label="CPC" field="cpc" sort={listingSort} onSort={sortListing}/><SortHeader label="订单" field="orders" sort={listingSort} onSort={sortListing}/><SortHeader label="件数" field="units" sort={listingSort} onSort={sortListing}/><SortHeader label="CPA" field="cpa" sort={listingSort} onSort={sortListing}/><SortHeader label="WSC 销售额" field="wsc" sort={listingSort} onSort={sortListing}/><SortHeader label="Retail 销售额" field="retail" sort={listingSort} onSort={sortListing}/><SortHeader label="CVR" field="cvr" sort={listingSort} onSort={sortListing}/><SortHeader label="WSC ROAS" field="wscRoas" sort={listingSort} onSort={sortListing}/><SortHeader label="Retail ROAS" field="retailRoas" sort={listingSort} onSort={sortListing}/></div>{managerListings.map(row=><article className="api-row" key={`${row.campaignId}:${row.listing}`}><span><b>{row.listing}</b><small>{row.campaignName||`Campaign ${row.campaignId}`} · {row.parts.join(' / ')||'Part未映射'}</small></span><span><b>{row.productName||'—'}</b><small>{row.className||'未分类'}</small></span><span><em className={/active/i.test(row.status)?'good':/pause|inactive/i.test(row.status)?'bad':'neutral'}>{row.status||'—'}</em><small>{String(row.isB2b).toLowerCase()==='true'?'B2B':'B2C'} · Campaign {row.campaignStatus||'—'}</small></span><b>{money2(row.bid)}</b><b>{row.current.impressions}</b><b>{row.current.clicks}</b><b>{(row.current.ctr*100).toFixed(2)}%</b><b>{money2(row.current.spend)}</b><b>{money2(metricCpc(row.current))}</b><b>{row.current.orders}</b><b>{row.current.units}</b><b>{money2(row.current.cpa)}</b><b>{money2(row.current.wsc)}</b><b>{money2(row.current.retail)}</b><b>{(row.current.cvr*100).toFixed(2)}%</b><strong>{row.current.wscRoas.toFixed(2)}×</strong><strong>{row.current.retailRoas.toFixed(2)}×</strong></article>)}{!loading&&!managerListings.length?<p className="empty-state">当前筛选没有 Listing 数据。</p>:null}</div></div></section>}
    </>}
    {tab==='ai'&&<>
    <section className="stat-grid four ad-kpis">{[
      [loading?'-':money(data?.current.spend),"所选周期花费",change(data?.current.spend,data?.previous.spend)],
      [loading?'-':String(data?.current.orders||0),"所选周期归因订单",change(data?.current.orders,data?.previous.orders)],
      [loading?'-':`${(data?.current.wscRoas||0).toFixed(2)}×`,"所选周期ROAS",`前周期 ${(data?.previous.wscRoas||0).toFixed(2)}×`],
      [loading?'-':String(ready),"本周调整建议",`${needsInput} 项需补条件，${noChange} 项保持 · BM CPC锚`],
    ].map(([value,label,note])=><article className="stat" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}</section>
    <section className="card queue-panel"><div className="section-head"><div><span>执行批次</span><h2>本周执行批次</h2></div><b>{queueLoading?'读取中':`${queuedActions.length} 项 · 成功 ${executedActions.length} · 失败 ${failedActions.length} · 待执行 ${validatedActions.length}`}</b></div>
      <div className="table-tools queue-tools"><label>状态<select value={queueStatusFilter} onChange={event=>setQueueStatusFilter(event.target.value)}><option value="ALL">全部</option><option value="PLANNED">待确认</option><option value="FAILED">执行失败</option><option value="APPROVED">待预检</option><option value="VALIDATED">预检通过</option><option value="EXECUTED">已执行</option></select></label><span>已选 {selectedQueue.length} 项</span><button className="primary" disabled={(!selectedQueue.length&&!approvedActions.length)||batchBusy} onClick={prepareSelected}>确认并预检 ({selectedQueue.length+approvedActions.length})</button></div>
      {queueError&&<div className="inline-error">{queueError}</div>}
      <div className="queue-rows"><div className="queue-row queue-head"><input type="checkbox" aria-label="选择全部可确认执行项" checked={Boolean(approvableQueue.length)&&approvableQueue.every(action=>selectedQueue.includes(action.id))} onChange={event=>setSelectedQueue(event.target.checked?approvableQueue.map(action=>action.id):[])}/><span>Listing</span><span>修改内容</span><span>状态</span><span>执行结果</span><span>操作</span></div>{filteredQueue.map(action=>{const source=data?.listings.find(row=>row.campaignId===action.campaign_id&&row.listing===action.listing);const apiAction=action.action_type==='SET_LISTING_BID';const confirmable=apiAction&&source?.action.execution==='READY_FOR_PLAN';const gateBlocked=action.status==='PLANNED'&&apiAction&&!confirmable;const overridden=gateOverrides.includes(action.id);const selectable=isBulkApprovable(action)&&apiAction;const result=executionResultForAction(action);return <article className="queue-row" key={action.id}><input type="checkbox" aria-label={`选择 ${action.listing}`} disabled={!selectable} checked={selectedQueue.includes(action.id)} onChange={event=>toggleQueueSelection(action,source,event.target.checked)}/><div><strong>{action.listing}</strong><small>Campaign {action.campaign_id}</small></div><b>{actionPayloadText(action)}</b><span className={`queue-status ${action.status.toLowerCase()}`}>{action.status==='PLANNED'?apiAction?'待确认':'人工任务':action.status==='APPROVED'?'待预检':action.status==='VALIDATED'?'预检通过':action.status==='EXECUTING'?'正在执行':action.status==='EXECUTED'?'已执行':'失败，可移除或重试'}</span><div className={`queue-result ${result.tone}`}><b>{result.title}</b><small>{result.detail}</small></div><div className="queue-actions">{canRemoveAction(action.status)?<button disabled={batchBusy} onClick={()=>removeAction(action)}>移除</button>:null}{action.status==='FAILED'&&apiAction?<small>勾选后重新预检</small>:null}{action.status==='FAILED'&&!apiAction?<small>暂停动作已废弃，请移除</small>:null}{gateBlocked?<small>{overridden?'已由运营确认覆盖 Gate，可进入批量预检':`勾选后确认覆盖：${source?.action.blockers.join('；')||'当前周期不满足自动 Gate'}`}</small>:null}</div></article>})}{!queueLoading&&!filteredQueue.length?<p className="empty-state">没有符合筛选条件的执行项。</p>:null}</div>
      <div className="batch-controls compact"><div><b>执行已预检项</b><small>每个 Campaign 独立提交；单个 Campaign 失败不会阻断其他修改。</small></div><button className="primary dark" disabled={!validatedActions.length||batchBusy||!liveEnabled} onClick={executeValidated}>执行已预检项 ({validatedActions.length})</button><em>{liveEnabled?'生产写入已启用':'生产写入安全开关未启用'}</em></div>
      {batchMessage&&<div className={`inventory-message ${/成功 \d+ 项，失败 \d+ 项/.test(batchMessage)?'partial':/(失败|未启用|必须)/.test(batchMessage)?'bad':'good'}`}>{batchMessage}</div>}
    </section>
    <section className="card action-ledger"><div className="section-head"><div><span>每周建议</span><h2>SKU / Listing 操作建议</h2></div><b>{filteredListings.length} / {data?.listings.length||0} 项</b></div>
      <div className="table-tools"><label className="search-field">搜索<input value={actionQuery} onChange={event=>setActionQuery(event.target.value)} placeholder="筛选 Listing、Campaign 或 Part"/></label><label>建议<select value={recommendationFilter} onChange={event=>setRecommendationFilter(event.target.value)}><option value="ALL">全部建议</option><option value="READY">建议调整</option><option value="NO_CHANGE">建议保持</option></select></label><label>执行单<select value={queueFilter} onChange={event=>setQueueFilter(event.target.value)}><option value="ALL">全部状态</option><option value="unqueued">未加入</option><option value="queued">已加入</option></select></label><span>已选 {selectedRecommendations.length} 项</span><button className="primary" disabled={!selectedRecommendations.length||batchBusy} onClick={queueSelected}>批量加入执行单</button></div>
      <div className="action-list rich"><div className="action-head selectable"><input type="checkbox" aria-label="选择全部可执行建议" checked={Boolean(selectableListings.length)&&selectableListings.every(row=>selectedRecommendations.includes(`${row.campaignId}:${row.listing}`))} onChange={event=>setSelectedRecommendations(event.target.checked?selectableListings.map(row=>`${row.campaignId}:${row.listing}`):[])}/><span>Listing / Campaign</span><span>成熟周证据</span><span>利润 / 链接 / 库存 / 目标</span><span>建议动作</span><span>执行</span></div>{filteredListings.map(row=>{const key=`${row.campaignId}:${row.listing}`;const queued=queueState[key];const queuedLabel=queued==='saving'?'保存中':queued==='saved'?'已加入待确认':queued==='approved'?'已确认':queued==='validated'?'预检通过':queued==='executing'?'执行中':queued==='executed'?'已执行':queued==='failed'?'执行失败':'';const selectable=row.action.type!=='HOLD'&&!queued;return <article className="selectable" key={key}><input type="checkbox" aria-label={`选择 ${row.listing}`} disabled={!selectable} checked={selectedRecommendations.includes(key)} onChange={event=>setSelectedRecommendations(value=>event.target.checked?[...value,key]:value.filter(id=>id!==key))}/><div><strong>{row.listing}</strong><small>Campaign {row.campaignId}<br/>{row.parts.join(' / ')||'Part未映射'}</small></div><p><b>{money(row.current.spend)} / {row.current.clicks} 点击 / {row.current.orders} 单</b><br/>ROAS {row.current.wscRoas.toFixed(2)}×，CPC {row.cpcBaseline.actualCpc==null?'—':money2(row.cpcBaseline.actualCpc)} / BM {row.cpcBaseline.cpc==null?'—':money2(row.cpcBaseline.cpc)}</p><p><b>保本</b> {row.economics.breakEvenRoas.toFixed(2)}×<br/><b>链接</b> {row.linkQuality.rating??'缺失'}分 / {row.linkQuality.reviews??'-'}评<br/><b>库存</b> {row.inventory.known?`${row.inventory.quantityOnHand}件 / ${row.inventory.coverDays}天`:'未入库'}<br/><b>责任</b> 7月余{row.goalGuardrail.julyRemainingUnits} / 8月留{row.goalGuardrail.augustReserveUnits}</p><div className="recommendation-cell"><div className="recommendation-title"><span className={row.action.recommendation==='READY'?'recommend-ready':'recommend-hold'}>{row.action.recommendation==='READY'?'建议调整':'建议保持'}</span><b>{row.action.label}</b></div><p className="recommendation-reason">{row.action.reasons[0]||'依据成熟归因周期与经营目标生成。'}</p>{row.action.reasons.length>1?<dl className="recommendation-evidence">{row.action.reasons.slice(1,3).map((reason,index)=><div key={`${key}:reason:${index}`}><dt>依据 {index+1}</dt><dd>{reason}</dd></div>)}</dl>:null}{row.action.warnings.length||row.action.blockers.length?<div className="recommendation-alerts">{row.action.warnings.slice(0,1).map((warning,index)=><span className="recommendation-warning" key={`${key}:warning:${index}`}>{warning}</span>)}{row.action.blockers.length?<span className="gate-warning">需补条件：{row.action.blockers.join('；')}</span>:null}</div>:null}</div><div className="recommendation-execution"><em className={row.action.execution==='READY_FOR_PLAN'?'good':row.action.execution==='NEEDS_INPUT'?'warn':'neutral'}>{row.action.execution==='READY_FOR_PLAN'?'可执行':row.action.execution==='NEEDS_INPUT'?'需补条件':'本周保持'}</em><button disabled={!selectable} onClick={()=>queueAction(row)}>{queuedLabel||'加入执行单'}</button></div></article>})}{!loading&&!filteredListings.length&&<p className="empty-state">没有符合筛选条件的建议。</p>}</div>
    </section>
    <section className="card weekly-history"><div className="section-head"><div><span>周度记忆</span><h2>调整记录与效果复盘</h2></div><b>成熟后自动校验，结果约束下一周建议</b></div><div className="weekly-history-list">{historyWeeks.filter(week=>week.actions.length||week.reviews.length).slice(0,8).map(week=>{const successful=week.actions.filter(action=>action.status==='EXECUTED').length;const failed=week.actions.filter(action=>action.status==='FAILED').length;return <article key={week.run_key}><div><time>{week.decision_start} → {week.decision_end}</time><strong>{week.actions.length} 项调整 · {successful} 成功 · {failed} 失败</strong></div><div className="weekly-review-chips">{week.reviews.length?week.reviews.map(review=><span className={`review-${review.verdict.toLowerCase()}`} key={review.actionId||`${week.run_key}:${review.listing}`}><b>{review.listing} · {review.verdict==='EFFECTIVE'?'有效':review.verdict==='HARMFUL'?'无效':review.verdict==='PENDING'?'待成熟':review.verdict==='INCONCLUSIVE'?'证据不足':'持平'}</b><small>{review.summary}</small></span>):<span className="review-empty"><b>尚无成熟复盘</b><small>执行后需等待至少7天数据，并叠加14天归因成熟期。</small></span>}</div></article>})}{!historyWeeks.some(week=>week.actions.length||week.reviews.length)?<p className="empty-state">完成第一批广告调整后，这里会按周保存执行结果和成熟效果。</p>:null}</div></section>
    </>}
    {tab==='manager'&&<section className="card daily-efficiency"><div className="section-head"><div><span>所选周期</span><h2>日级投放效率</h2></div><b>{money(data?.current.spend||0)} 花费 · {data?.current.orders||0} 单 · ROAS {(data?.current.wscRoas||0).toFixed(2)}×</b></div><div className="daily-efficiency-list"><div className="daily-efficiency-row head"><span>日期</span><span>曝光</span><span>点击 / CPC</span><span>花费</span><span>归因订单</span><span>归因销售额</span><span>ROAS</span><span>运营判断</span></div>{visibleHistory.map(row=>{const signal=adDailySignal(row);return <article className="daily-efficiency-row manager" key={row.date}><time>{row.date}</time><b>{row.impressions}</b><b>{row.clicks} / {money2(metricCpc(row))}</b><div className="spend-cell"><b>{money2(row.spend)}</b><i><span style={{width:`${Math.max(2,row.spend/dailySpendMax*100)}%`}}></span></i></div><b>{row.orders} 单</b><b>{money2(row.wsc)}</b><strong>{row.wscRoas.toFixed(2)}×</strong><em className={signal.tone}>{signal.label}</em></article>})}{!loading&&!visibleHistory.length?<p className="empty-state">所选周期没有广告日级数据。</p>:null}</div></section>}
  </>;
}

function Review({ embedded = false, onOpenPlan }: { embedded?: boolean; onOpenPlan: (section: PlanSection) => void }) {
  const [report,setReport]=useState(0);const [uploads,setUploads]=useState<UploadedReport[]>(readClientCache<UploadedReport[]>('reports:list',CLIENT_CACHE_RETENTION_MS)||[]);const [uploading,setUploading]=useState(false);const [uploadMessage,setUploadMessage]=useState('');
  useEffect(()=>{const cached=readClientCache<UploadedReport[]>('reports:list');const controller=new AbortController();if(cached){queueMicrotask(()=>setUploads(cached));return()=>controller.abort();}fetch('/api/reports',{signal:controller.signal}).then(async r=>await r.json() as {reports?:UploadedReport[]}).then(body=>{const reports=body.reports||[];setUploads(reports);writeClientCache('reports:list',reports);}).catch(()=>{});return()=>controller.abort();},[]);
  const allReports=useMemo(()=>[...REPORTS.map(item=>({...item,assetUrl:`/reports/${encodeURIComponent(item.file)}`,uploaded:false})),...uploads.map(item=>({title:item.title,file:item.fileName,kind:item.kind,date:new Date(item.createdAt).toLocaleDateString('zh-CN'),summary:'用户补充的复盘证据，原文件已持久化保存。',sections:[],assetUrl:`/api/reports/file?id=${encodeURIComponent(item.id)}`,uploaded:true}))],[uploads]);
  const selected=allReports[Math.min(report,allReports.length-1)];const spreadsheet=selected.file.endsWith('.xlsx');
  async function uploadReport(file:File|null){if(!file)return;setUploading(true);setUploadMessage('');try{const form=new FormData();form.set('file',file);const response=await fetch('/api/reports',{method:'POST',body:form});const body=await response.json() as UploadedReport&{error?:string};if(!response.ok)throw new Error(body.error||'报告上传失败');setUploads(value=>{const next=[body,...value];writeClientCache('reports:list',next);return next;});setReport(REPORTS.length);setUploadMessage('报告已保存并加入资料库。');}catch(error){setUploadMessage(error instanceof Error?error.message:'报告上传失败');}finally{setUploading(false);}}
  return <>{!embedded&&<Hero eyebrow="MONTHLY REVIEW · FULL REPORTS" title="月度复盘" text="直接阅读完整原报告，不再用四个摘要框代替正文" side={<label className="hero-button upload-report">{uploading?'上传中…':'补充复盘资料'}<input type="file" accept=".html,.htm,.pdf,.xlsx" disabled={uploading} onChange={e=>uploadReport(e.target.files?.[0]||null)}/></label>} />}
    <section className="review-context" aria-label="复盘与计划月份导航"><button aria-label="查看6月月度复盘" onClick={()=>setReport(REPORTS.findIndex(item=>item.title==='2026年6月月度复盘总览'))}><span>复盘事实月</span><b>2026-06 · 已归档</b></button><i>→</i><button aria-label="返回7月执行计划" onClick={()=>onOpenPlan('july')}><span>当前经营月</span><b>2026-07 · 128 Orders执行中</b></button><i>→</i><button aria-label="查看8月准备计划" onClick={()=>onOpenPlan('august')}><span>下一计划月</span><b>2026-08 · 150 Units准备中</b></button></section>
    {uploadMessage&&<div className="upload-message">{uploadMessage}</div>}
    <div className="review-grid full-reader"><aside className="card report-list"><div><span>复盘资料</span><h2>完整复盘资料</h2><b>{allReports.length}</b></div>{allReports.map((x,i)=><button className={report===i?'active':''} onClick={()=>setReport(i)} key={`${x.uploaded?'upload':'builtin'}:${x.file}`}><strong>{x.title}</strong><small>{x.kind} · {x.date||'2026/07/15'}</small></button>)}</aside><article className="card report-reader"><header><div><span>{selected.kind} · 完整原报告</span><h2>{selected.title}</h2><p>{selected.summary}</p></div><div className="report-actions">{embedded&&<label className="compact-upload">{uploading?'上传中…':'补充复盘资料'}<input type="file" accept=".html,.htm,.pdf,.xlsx" disabled={uploading} onChange={e=>uploadReport(e.target.files?.[0]||null)}/></label>}<a href={selected.assetUrl} target="_blank" rel="noreferrer">{spreadsheet?'下载原表格':'在新窗口打开'}</a></div></header>{spreadsheet?<div className="sheet-download"><b>执行清单为 XLSX 原表格</b><p>点击右上角下载完整文件；同一内容的可读版请在左侧打开“SKU广告重构执行清单”。</p><a href={selected.assetUrl} download>下载 {selected.file}</a></div>:<iframe key={selected.assetUrl} title={selected.title} src={selected.assetUrl} sandbox={selected.uploaded?'':'allow-same-origin allow-scripts allow-popups'} />}</article></div>
  </>;
}

function Catalog({ embedded = false }: { embedded?: boolean }) {
  const initialCatalog=readClientCache<CatalogResponse>('catalog:page=1&pageSize=30',CLIENT_CACHE_RETENTION_MS);
  const [query,setQuery]=useState(''); const [submitted,setSubmitted]=useState(''); const [status,setStatus]=useState('');
  const [catalogSort,setCatalogSort]=useState<SortState>({key:'revenue',direction:'desc'});
  const [page,setPage]=useState(1); const [refresh,setRefresh]=useState(0); const [data,setData]=useState<CatalogResponse | null>(initialCatalog); const [loading,setLoading]=useState(!initialCatalog); const [error,setError]=useState(''); const [selected,setSelected]=useState<CatalogItem | null>(initialCatalog?.items?.[0]||null);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({page:String(page),pageSize:'30'}); if(submitted)params.set('q',submitted); if(status)params.set('status',status);
    const cacheKey=`catalog:${params}`;const cached=refresh===0?readClientCache<CatalogResponse>(cacheKey):null;if(cached){queueMicrotask(()=>{if(!controller.signal.aborted){setData(cached);setSelected(cached.items?.[0]||null);setLoading(false);}});return()=>controller.abort();}
    fetch(`/api/catalog/items?${params}`,{signal:controller.signal}).then(async response=>{const body=await response.json() as CatalogResponse;if(!response.ok)throw new Error(body.error||'商品数据读取失败');return body;}).then(body=>{setData(body);setSelected(body.items?.[0]||null);writeClientCache(cacheKey,body);}).catch(reason=>{if(reason.name!=='AbortError')setError(reason.message||'商品数据读取失败');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[submitted,status,page,refresh]);
  const pages=data?.paginationInfo;
  const insights=selected?.insights;
  const insightTotal=(insights?.problems?.length||0)+(insights?.warnings?.length||0)+(insights?.opportunities?.length||0);
  const catalogItems=sortRows(data?.items||[],catalogSort,{sku:(item:CatalogItem)=>item.supplierPartNumber,status:(item:CatalogItem)=>item.catalogItemStatus,brand:(item:CatalogItem)=>item.marketContext?.brand,issues:(item:CatalogItem)=>(item.insights?.problems?.length||0)+(item.insights?.warnings?.length||0),units:(item:CatalogItem)=>item.recent30d?.units||0,revenue:(item:CatalogItem)=>item.recent30d?.revenue||0}) as CatalogItem[];
  function submit(){setLoading(true);setError('');setPage(1);setSubmitted(query.trim().toUpperCase());setRefresh(value=>value+1);}
  return <>{!embedded&&<Hero eyebrow="CATALOG READ V2 · ORDER JOIN" title="商品数据" text="Catalog 商品事实与近 30 天订单表现合并为 SKU 360° 视图" side={<div className="hero-side"><b>{loading?'同步中':error?'需检查':'已连接'}</b><span>Catalog Read V2 · {pages?.totalCount||0} 个商品</span></div>} />}
    <section className="card catalog-card"><div className="filters"><label>Supplier Part #<input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submit();}} placeholder="精确输入，如 DMOM1022"/></label><label>商品状态<select value={status} onChange={e=>{setLoading(true);setError('');setStatus(e.target.value);setPage(1);}}><option value="">全部状态</option><option value="LIVE">LIVE</option><option value="NOT_LIVE">NOT LIVE</option><option value="LAUNCHING">LAUNCHING</option></select></label><button className="primary" onClick={submit}>查询商品</button></div>
      {error&&<div className="inline-error">{error}</div>}
      <div className="catalog-layout"><div className="catalog-results"><div className="catalog-row catalog-head"><SortHeader label="SKU / Listing" field="sku" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><SortHeader label="状态" field="status" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><SortHeader label="品牌 · 类目" field="brand" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><span>市场</span><SortHeader label="诊断" field="issues" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><span className="dual-sort"><SortHeader label="近30天件数" field="units" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/><SortHeader label="销售额" field="revenue" sort={catalogSort} onSort={field=>setCatalogSort(value=>nextSort(value,field) as SortState)}/></span></div>{catalogItems.map(item=>{const issues=(item.insights?.problems?.length||0)+(item.insights?.warnings?.length||0);return <button className={`catalog-row ${selected?.supplierPartNumber===item.supplierPartNumber?'selected':''}`} key={item.supplierPartNumber} onClick={()=>setSelected(item)}><span><strong>{item.supplierPartNumber}</strong><small>{item.listings?.length||0} 个 Listing</small></span><em className={item.catalogItemStatus==='LIVE'?'good':'bad'}>{item.catalogItemStatus?.replace('_',' ')||'-'}</em><span><b>{item.marketContext?.brand||'-'}</b><small>{item.class?.className||'未分类'}</small></span><span><b>{item.marketContext?.country||'-'} · {item.marketContext?.locale||'-'}</b><small>{item.marketContext?.channel||'-'} / {item.marketContext?.segment||'-'}</small></span><span><b>{issues} 问题</b><small>{item.insights?.opportunities?.length||0} 机会</small></span><span><b>{item.recent30d?.units||0} 件</b><small>{money(item.recent30d?.revenue||0)}</small></span></button>})}{!loading&&!data?.items?.length&&<p className="empty-state">没有符合条件的商品</p>} {loading&&<p className="empty-state">正在读取 Catalog…</p>}
        <div className="pagination"><span>第 {pages?.page||1} / {pages?.totalPages||1} 页 · 共 {pages?.totalCount||0} 个</span><button disabled={page<=1} onClick={()=>{setLoading(true);setError('');setPage(page-1);}}>上一页</button><button disabled={!pages?.hasNextPage} onClick={()=>{setLoading(true);setError('');setPage(page+1);}}>下一页</button></div></div>
        <aside className="product-detail">{selected?<><span>SKU 360°</span><h2>{selected.supplierPartNumber}</h2><div className="product-facts"><div><small>商品状态</small><b>{selected.catalogItemStatus?.replace('_',' ')}</b></div><div><small>Listing</small><b>{selected.listings?.length||0}</b></div><div><small>近 30 天销售</small><b>{money(selected.recent30d?.revenue||0)}</b></div><div><small>诊断信号</small><b>{insightTotal}</b></div></div><section><h3>市场与标识</h3><p>{selected.marketContext?.brand||'-'} · {selected.class?.className||'未分类'} · {selected.marketContext?.country||'-'} / {selected.marketContext?.channel||'-'}</p><div className="listing-tags">{selected.listings?.map(item=><i key={item.listingId}>{item.listingId}</i>)}</div></section><section><h3>Catalog 诊断</h3>{([['问题',insights?.problems],['警告',insights?.warnings],['机会',insights?.opportunities]] as [string,CatalogInsight[]|undefined][]).map(([label,list])=>list?.map(item=><article className="insight" key={item.insightId||item.title}><b>{label} · {item.title||'未命名信号'}</b><p>{item.explanation||'Catalog 未提供详细解释。'}</p>{item.monthsInViolation? <small>已持续 {item.monthsInViolation} 个月</small>:null}{item.resolution?.url&&/^https:\/\//.test(item.resolution.url)&&<a href={item.resolution.url} target="_blank" rel="noreferrer">查看 Wayfair 处理指引</a>}</article>))}{!insightTotal&&<p className="empty-insight">当前没有 Catalog 问题、警告或机会。</p>}</section><section className="linkage-note"><h3>跨模块联动</h3><p>订单表现已关联；库存写入前进入 Inventory Gate，广告动作在周度父体清单统一审批。</p></section></>:<p>选择左侧商品查看完整信息。</p>}</aside></div>
    </section></>;
}

function SkuOperatingPerformance() {
  const [query,setQuery]=useState('');const [category,setCategory]=useState('ALL');const [sort,setSort]=useState<SortState>({key:'revenue',direction:'desc'});
  const categories=Array.from(new Set(LEGACY_OPERATING_DATA.skus.map(item=>item["Class Name"]).filter(Boolean))).sort();
  const needle=query.trim().toLowerCase();
  const rows=sortRows(LEGACY_OPERATING_DATA.skus.filter(item=>(category==='ALL'||item["Class Name"]===category)&&(!needle||[item["Wayfair Sku"],item["Supplier Part Number"],item["Product Name"],item.cn_name].some(value=>String(value||'').toLowerCase().includes(needle)))),sort,{sku:(item:LegacySku)=>item["Wayfair Sku"],name:(item:LegacySku)=>item.cn_name||item["Product Name"],category:(item:LegacySku)=>item["Class Name"],grade:(item:LegacySku)=>item.grade,revenue:(item:LegacySku)=>item["Total Revenue"],cvr:(item:LegacySku)=>item.CVR,sessions:(item:LegacySku)=>item.Sessions,rating:(item:LegacySku)=>item.rating,tag:(item:LegacySku)=>item.tag_pct,wsc:(item:LegacySku)=>item.wsc,cogs:(item:LegacySku)=>item.cogs,margin:(item:LegacySku)=>item.my_margin,space:(item:LegacySku)=>item.wf_space}) as LegacySku[];
  const onSort=(field:string)=>setSort(value=>nextSort(value,field) as SortState);
  return <section className="card legacy-data-card"><div className="section-head"><div><span>2026-06 经营基线</span><h2>SKU 经营表现</h2></div><b>{rows.length} / {LEGACY_OPERATING_DATA.skus.length} 个 Part</b></div><div className="legacy-filters"><label>搜索<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="SKU、Supplier Part 或名称"/></label><label>类目<select value={category} onChange={event=>setCategory(event.target.value)}><option value="ALL">全部类目</option>{categories.map(item=><option value={item} key={item}>{item}</option>)}</select></label></div><div className="legacy-table-scroll"><div className="legacy-table sku-economics-table"><div className="legacy-row head"><SortHeader label="产品 / Part" field="sku" sort={sort} onSort={onSort}/><SortHeader label="中文名" field="name" sort={sort} onSort={onSort}/><SortHeader label="类目" field="category" sort={sort} onSort={onSort}/><SortHeader label="级" field="grade" sort={sort} onSort={onSort}/><SortHeader label="营收" field="revenue" sort={sort} onSort={onSort}/><SortHeader label="CVR · 访问" field="cvr" sort={sort} onSort={onSort}/><SortHeader label="评分 · 评论" field="rating" sort={sort} onSort={onSort}/><SortHeader label="Tag%" field="tag" sort={sort} onSort={onSort}/><SortHeader label="WSC" field="wsc" sort={sort} onSort={onSort}/><SortHeader label="拿货" field="cogs" sort={sort} onSort={onSort}/><SortHeader label="毛利率" field="margin" sort={sort} onSort={onSort}/><SortHeader label="空间" field="space" sort={sort} onSort={onSort}/></div>{rows.map((item,index)=><article className="legacy-row" key={`${item["Supplier Part Number"]}:${index}`}><span><b>{item["Wayfair Sku"]}</b><small>{item["Supplier Part Number"]}</small></span><span><b>{item.cn_name||'—'}</b><small>{item["Product Name"]}</small></span><span>{item["Class Name"]}</span><em className={`grade grade-${String(item.grade||'c').toLowerCase()}`}>{item.grade||'—'}</em><b>{money(item["Total Revenue"])}</b><span><b>{(item.CVR*100).toFixed(2)}%</b><small>{item.Sessions} 访</small></span><span><b>{item.rating||'—'}</b><small>{item.review_count||0} 条</small></span><b>{item.tag_pct.toFixed(0)}%</b><b>{money2(item.wsc)}</b><b>{money2(item.cogs)}</b><span className={item.my_margin>=.2?'good':'bad'}><b>{(item.my_margin*100).toFixed(1)}%</b><small>{money2(item.my_profit)}</small></span><b className={item.wf_space>=.2?'good':'bad'}>{(item.wf_space*100).toFixed(0)}%</b></article>)}</div></div></section>;
}

function MonthlyOperatingHistory() {
  const monthlyByNumber=new Map(LEGACY_OPERATING_DATA.acct_monthly.map(item=>[item.m,item]));
  const rows=LEGACY_OPERATING_DATA.trend.months.map((month,index)=>{const revenue=LEGACY_OPERATING_DATA.trend.revenue[index];const orders=LEGACY_OPERATING_DATA.trend.orders[index];const sessions=LEGACY_OPERATING_DATA.trend.sessions[index];const cvr=LEGACY_OPERATING_DATA.trend.cvr[index];const spend=LEGACY_OPERATING_DATA.trend.sp_spend[index];return{month:month.replace('_','-'),revenue,orders,sessions,cvr,spend,aov:revenue&&orders?revenue/orders:null,tacos:revenue&&spend?spend/revenue:null};});
  return <div className="history-workspace"><section className="card legacy-data-card"><div className="section-head"><div><span>2025-06 → 2026-06</span><h2>13 个月账户全景</h2></div><b>{LEGACY_OPERATING_DATA.meta.store}</b></div><div className="legacy-table-scroll"><div className="legacy-table monthly-table"><div className="legacy-row head"><span>月份</span><span>营收</span><span>订单</span><span>Sessions</span><span>CVR</span><span>AOV</span><span>广告花费</span><span>TACoS</span></div>{rows.map(row=><article className="legacy-row" key={row.month}><b>{row.month}</b><b>{row.revenue==null?'—':money(row.revenue)}</b><b>{row.orders??'—'}</b><b>{row.sessions??'—'}</b><b>{row.cvr==null?'—':`${(row.cvr*100).toFixed(1)}%`}</b><b>{row.aov==null?'—':money(row.aov)}</b><b>{row.spend==null?'—':money(row.spend)}</b><b className={(row.tacos||0)>.2?'bad':'good'}>{row.tacos==null?'—':`${(row.tacos*100).toFixed(1)}%`}</b></article>)}</div></div></section><section className="card legacy-data-card"><div className="section-head"><div><span>广告归因订单 / 总订单</span><h2>广告依赖度 · 2026年1–6月</h2></div><b>健康区 25–40%</b></div><div className="legacy-table-scroll"><div className="legacy-table dependency-table"><div className="legacy-row head"><span>月份</span><span>总订单</span><span>广告归因单</span><span>依赖度（上限）</span><span>广告花费</span><span>TACoS</span></div>{Array.from(monthlyByNumber.values()).map(row=>{const dependency=row.orders?row.ad_orders/row.orders:0;const tacos=row.rev?row.spend/row.rev:0;return <article className="legacy-row" key={row.m}><b>2026-{String(row.m).padStart(2,'0')}</b><b>{row.orders}</b><b>{row.ad_orders}</b><b className={dependency>.4?'bad':'good'}>{(dependency*100).toFixed(0)}%</b><b>{money(row.spend)}</b><b className={tacos>.2?'bad':'good'}>{(tacos*100).toFixed(1)}%</b></article>})}</div></div></section></div>;
}

function PlanningWorkspace({ tab, onTabChange }: { tab: PlanningTab; onTabChange: (tab: PlanningTab) => void }) {
  const [planSection,setPlanSection]=useState<PlanSection>('july');
  return <><Hero eyebrow="" title={tab==='plan'?'运营计划':tab==='history'?'历史月度':'复盘资料'} text="" />
    {tab==='plan'?<Plan embedded tab={planSection} onTabChange={setPlanSection} onOpenReview={()=>onTabChange('review')}/>:tab==='history'?<MonthlyOperatingHistory/>:<Review embedded onOpenPlan={section=>{setPlanSection(section);onTabChange('plan');}}/>}
  </>;
}

function ProductWorkspace({ tab }: { tab: ProductTab }) {
  return <><Hero eyebrow="" title={tab==='inventory'?'库存更新':tab==='performance'?'SKU 经营':'商品数据'} text="" />
    {tab==='inventory'?<Inventory embedded/>:tab==='performance'?<SkuOperatingPerformance/>:<Catalog embedded/>}
  </>;
}

function Sources() {
  const sources=[['Outlook 邮件日报','已同步','2026-07-16','风险与待办'],['Ops API · 库存 + 订单','生产','同一套 OAuth 应用','库存写 / 订单读'],['Advertising API','生产','官方报表已连接','Campaign / Listing 报表与受控写入'],['Catalog Read V2','生产','双版本权限','商品、Listing 与诊断'],['月度报告资料库','已同步','15+ 份报告','6月复盘 / 7月执行 / BFIJ / 8月准备'],['运营数据库','运行中','D1 + R2 持久化','订单、广告、商品、库存、执行单与补充报告']];
  return <><Hero eyebrow="DATA SOURCES · PERMISSION CONTROL" title="数据源" text="库存与订单共用 Ops 应用；每个连接只承担明确的数据职责" /><div className="source-grid">{sources.map(x=><article className="card source-card" key={x[0]}><span className="connected">{x[1]}</span><h2>{x[0]}</h2><p>{x[2]}</p><small>{x[3]}</small></article>)}</div></>;
}

function Help() {
  return <><Hero eyebrow="" title="帮助" text="" />
    <div className="help-grid">
      <section className="card help-section"><h2>广告优化</h2><dl><div><dt>调整频率</dt><dd>每周生成一次建议，固定读取截至 T-14 的最近 7 天成熟数据。</dd></div><div><dt>建议依据</dt><dd>历史表现、SKU 利润、链接质量、库存覆盖和月度计划共同判断。</dd></div><div><dt>执行范围</dt><dd>中台只执行 Listing Bid。暂停、启用、Campaign Cap、tROAS、关键词和否词均不自动写入。</dd></div></dl></section>
      <section className="card help-section"><h2>数据与缓存</h2><dl><div><dt>订单与库存</dt><dd>共用 Ops 应用。订单只读，库存经过校验和预检后写入。</dd></div><div><dt>广告数据</dt><dd>日级报表和每周决策快照保存到数据库，切换页面不会重复拉取。</dd></div><div><dt>复盘资料</dt><dd>原始 HTML、PDF 和 XLSX 保存在资料库，页面提供完整阅读与下载。</dd></div></dl></section>
      <section className="card help-section"><h2>写入安全</h2><dl><div><dt>人工确认</dt><dd>广告和库存的生产写入都需要明确确认。</dd></div><div><dt>预检</dt><dd>正式写入前先执行 Dry-run，校验载荷、权限和当前值。</dd></div><div><dt>审计与重试</dt><dd>保存修改前值、建议值、结果和失败原因。失败项可重新确认和执行。</dd></div></dl></section>
      <section className="card help-section"><h2>口径</h2><dl><div><dt>广告后贡献</dt><dd>广告前商品毛利扣除已同步的广告花费。广告数据未覆盖时不显示为实际利润。</dd></div><div><dt>成熟归因</dt><dd>最近 7 天和 14 天可用于观察。只有成熟周期用于自动调整建议。</dd></div><div><dt>计划联动</dt><dd>7 月目标、活动节奏和 8 月计划分别保存，不跨月混用目标口径。</dd></div></dl></section>
    </div>
  </>;
}

export default function OpsCenter() {
  const [view,setView]=useState<View>('dashboard');
  const [adsTab,setAdsTab]=useState<AdsTab>('manager');
  const [planningTab,setPlanningTab]=useState<PlanningTab>('plan');
  const [productTab,setProductTab]=useState<ProductTab>('inventory');
  useEffect(()=>{window.scrollTo(0,0);const frame=requestAnimationFrame(()=>window.scrollTo(0,0));return()=>cancelAnimationFrame(frame);},[view]);
  const activeSub: SubView | null=view==='ads'?adsTab:view==='planning'?planningTab:view==='products'?productTab:null;
  function navigateSub(next:SubView){if(view==='ads'&&(next==='manager'||next==='listings'||next==='ai'))setAdsTab(next);if(view==='planning'&&(next==='plan'||next==='review'||next==='history'))setPlanningTab(next);if(view==='products'&&(next==='inventory'||next==='catalog'||next==='performance'))setProductTab(next);}
  const page=useMemo(()=>({dashboard:<Dashboard/>,ads:<Ads tab={adsTab}/>,planning:<PlanningWorkspace tab={planningTab} onTabChange={setPlanningTab}/>,products:<ProductWorkspace tab={productTab}/>,sources:<Sources/>,help:<Help/>})[view],[view,adsTab,planningTab,productTab]);
  return <div className="app app-shell"><ShellHeader active={view} activeSub={activeSub} onNavigate={setView} onSubNavigate={navigateSub}/><div className="content-shell"><main>{page}</main><footer><span>Wayfair AI 运营中台</span><span>个人测试阶段</span></footer></div></div>;
}
