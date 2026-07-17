import { AUGUST_PLAN, AUGUST_PLAN_LISTINGS, BFIJ_PLAN, JULY_PLAN, JULY_PLAN_LISTINGS, planForListing } from "./operating-plan";
import { MAKEACE_CPC_PLAN, recommendCpcAction } from "./makeace-cpc-plan.mjs";

const TOKEN_URL = "https://sso.auth.wayfair.com/oauth/token";
const API_BASE = "https://api.wayfair.io/advertising/v1";
const ATTRIBUTION_DAYS = 14;
const ANALYSIS_CACHE_MS = 30 * 60 * 1000;
const MUTABLE_REPORT_CACHE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MARGIN = .2826;

type CsvRow = Record<string, string>;
type AdvertisingEnv = {
  DB?: D1Database;
  WAYFAIR_AD_CLIENT_ID?: string;
  WAYFAIR_AD_CLIENT_SECRET?: string;
};
type Metric = { impressions: number; clicks: number; spend: number; orders: number; units: number; wsc: number; ctr: number; cvr: number; wscRoas: number };
type ReportType = "CAMPAIGN_REPORT" | "LISTING_REPORT";
type InventoryEvidence = { quantityOnHand: number; units30d: number; coverDays: number; snapshotAt: string };
type GoalEvidence = {
  julyPaceGap: number;
  eventPhase: string;
  reliable: boolean;
  byListing: Map<string, { actualUnits: number; julyRemainingUnits: number; augustReserveUnits: number; marginRate: number | null; marginKnown: boolean }>;
};

async function ensureAdTables(db: D1Database | undefined) {
  if (!db) return;
  const statements = [
    "CREATE TABLE IF NOT EXISTS ad_report_days (report_type TEXT NOT NULL, report_date TEXT NOT NULL, refreshed_at TEXT NOT NULL, PRIMARY KEY(report_type, report_date))",
    "CREATE TABLE IF NOT EXISTS ad_report_rows (report_type TEXT NOT NULL, report_date TEXT NOT NULL, entity_key TEXT NOT NULL, payload TEXT NOT NULL, refreshed_at TEXT NOT NULL, PRIMARY KEY(report_type, report_date, entity_key))",
    "CREATE INDEX IF NOT EXISTS ad_report_rows_range_idx ON ad_report_rows(report_type, report_date)",
    "CREATE TABLE IF NOT EXISTS ad_decision_runs (run_key TEXT PRIMARY KEY NOT NULL, decision_start TEXT NOT NULL, decision_end TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)",
  ];
  for (const sql of statements) await db.prepare(sql).run();
}

async function loadInventoryEvidence(db: D1Database | undefined) {
  const result = new Map<string, InventoryEvidence>();
  if (!db) return result;
  try {
    const latest = await db.prepare("SELECT id,created_at FROM inventory_snapshots ORDER BY created_at DESC LIMIT 1").first<{id:string;created_at:string}>();
    if (!latest) return result;
    const start = addDays(todayShanghai(), -29);
    const inventory = await db.prepare("SELECT part_number,SUM(quantity_on_hand) AS quantity_on_hand FROM inventory_snapshot_rows WHERE snapshot_id=? GROUP BY part_number").bind(latest.id).all<{part_number:string;quantity_on_hand:number}>();
    const velocity = await db.prepare("SELECT oi.part_number AS part_number,SUM(oi.quantity) AS units FROM order_items oi JOIN orders o ON o.po_number=oi.po_number WHERE o.po_date>=? GROUP BY oi.part_number").bind(start).all<{part_number:string;units:number}>();
    const units = new Map((velocity.results||[]).map((row)=>[row.part_number,Number(row.units||0)]));
    for (const row of inventory.results||[]) {
      const quantityOnHand=Number(row.quantity_on_hand||0); const units30d=units.get(row.part_number)||0;
      result.set(row.part_number,{quantityOnHand,units30d,coverDays:Number(Math.min(999,quantityOnHand/(Math.max(units30d,1)/30)).toFixed(1)),snapshotAt:latest.created_at});
    }
  } catch { /* Inventory remains an explicit gate until the first real snapshot exists. */ }
  return result;
}

function eventPhaseForDate(value: string) {
  for (const phase of BFIJ_PLAN.phases) {
    const [start, end] = phase.range.split("–").map((item) => `2026-${item.replace("/", "-")}`);
    if (value >= start && value <= end) return phase.id;
  }
  return value < "2026-07-16" ? "before" : "closed";
}

async function loadGoalEvidence(db: D1Database | undefined, asOf: string): Promise<GoalEvidence> {
  const base = new Map(JULY_PLAN_LISTINGS.map((july) => {
    const august = AUGUST_PLAN_LISTINGS.find((item) => item.listing === july.listing);
    return [july.listing, {
      actualUnits: 0,
      julyRemainingUnits: Number(july.julyTargetOrders || 0),
      augustReserveUnits: Number(august?.augustUnits || 0),
      marginRate: null,
      marginKnown: false,
    }];
  }));
  const fallback = { julyPaceGap: 0, eventPhase: eventPhaseForDate(asOf), reliable: false, byListing: base };
  if (!db || !asOf.startsWith("2026-07")) return fallback;
  try {
    const endExclusive = addDays(asOf, 1);
    const [orders, items] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS orders FROM orders WHERE datetime(po_date)>=datetime(?) AND datetime(po_date)<datetime(?)")
        .bind("2026-07-01T00:00:00+08:00", `${endExclusive}T00:00:00+08:00`)
        .first<{ orders: number }>(),
      db.prepare(`SELECT i.part_number AS part_number, SUM(i.quantity) AS units,
        SUM(i.unit_price_cents*i.quantity) AS revenue_cents,
        SUM(CASE WHEN c.unit_cost_cents IS NOT NULL THEN c.unit_cost_cents*i.quantity ELSE 0 END) AS cost_cents,
        SUM(CASE WHEN c.unit_cost_cents IS NULL THEN i.unit_price_cents*i.quantity ELSE 0 END) AS uncovered_revenue_cents
        FROM order_items i JOIN orders o ON o.po_number=i.po_number LEFT JOIN sku_costs c ON c.part_number=i.part_number
        WHERE datetime(o.po_date)>=datetime(?) AND datetime(o.po_date)<datetime(?) GROUP BY i.part_number`)
        .bind("2026-07-01T00:00:00+08:00", `${endExclusive}T00:00:00+08:00`)
        .all<{ part_number: string; units: number; revenue_cents: number; cost_cents: number; uncovered_revenue_cents: number }>(),
    ]);
    const byPart = new Map((items.results || []).map((row) => [row.part_number, row]));
    for (const july of JULY_PLAN_LISTINGS) {
      const august = AUGUST_PLAN_LISTINGS.find((item) => item.listing === july.listing);
      const rows = july.parts.map((part) => byPart.get(part)).filter(Boolean) as { units: number; revenue_cents: number; cost_cents: number; uncovered_revenue_cents: number }[];
      const actualUnits = rows.reduce((sum, row) => sum + Number(row.units || 0), 0);
      const revenueCents = rows.reduce((sum, row) => sum + Number(row.revenue_cents || 0), 0);
      const costCents = rows.reduce((sum, row) => sum + Number(row.cost_cents || 0), 0);
      const uncovered = rows.reduce((sum, row) => sum + Number(row.uncovered_revenue_cents || 0), 0);
      base.set(july.listing, {
        actualUnits,
        julyRemainingUnits: Math.max(0, Number(july.julyTargetOrders || 0) - actualUnits),
        augustReserveUnits: Number(august?.augustUnits || 0),
        marginRate: revenueCents > 0 && uncovered === 0 ? Number(((revenueCents - costCents) / revenueCents).toFixed(4)) : null,
        marginKnown: revenueCents > 0 && uncovered === 0,
      });
    }
    const elapsedDays = Number(asOf.slice(8, 10));
    const expectedOrders = JULY_PLAN.orderTarget * elapsedDays / 31;
    return {
      julyPaceGap: Number((Number(orders?.orders || 0) - expectedOrders).toFixed(1)),
      eventPhase: eventPhaseForDate(asOf),
      reliable: true,
      byListing: base,
    };
  } catch {
    return fallback;
  }
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

function dates(start: string, end: string) {
  const result: string[] = [];
  for (let value = start; value <= end; value = addDays(value, 1)) result.push(value);
  return result;
}

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ""; }
    else if (char === '\n') { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function number(row: CsvRow, key: string) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function emptyMetric(): Metric { return { impressions: 0, clicks: 0, spend: 0, orders: 0, units: 0, wsc: 0, ctr: 0, cvr: 0, wscRoas: 0 }; }

function addMetric(metric: Metric, row: CsvRow) {
  metric.impressions += number(row, "impressions");
  metric.clicks += number(row, "clicks");
  metric.spend += number(row, "spend_USD");
  metric.orders += number(row, "attributed_orders_window_view_through_Day_14");
  metric.units += number(row, "attributed_units_window_view_through_Day_14");
  metric.wsc += number(row, "attributed_wholesale_cost_window_view_through_USD_Day_14");
}

function finalize(metric: Metric): Metric {
  return {
    impressions: Math.round(metric.impressions), clicks: Math.round(metric.clicks), orders: Math.round(metric.orders), units: Math.round(metric.units),
    spend: Number(metric.spend.toFixed(2)), wsc: Number(metric.wsc.toFixed(2)),
    ctr: metric.impressions ? Number((metric.clicks / metric.impressions).toFixed(4)) : 0,
    cvr: metric.clicks ? Number((metric.orders / metric.clicks).toFixed(4)) : 0,
    wscRoas: metric.spend ? Number((metric.wsc / metric.spend).toFixed(2)) : 0,
  };
}

async function getToken(env: AdvertisingEnv) {
  if (!env.WAYFAIR_AD_CLIENT_ID || !env.WAYFAIR_AD_CLIENT_SECRET) throw new Error("Advertising API 凭证未配置");
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: env.WAYFAIR_AD_CLIENT_ID, client_secret: env.WAYFAIR_AD_CLIENT_SECRET, audience: WAYFAIR_ADVERTISING_AUDIENCE }),
    });
    lastStatus = response.status;
    if (response.ok) {
      const body = await response.json() as { access_token?: string };
      if (body.access_token) return body.access_token;
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw new Error(`Advertising API OAuth 失败（HTTP ${lastStatus}）`);
}

async function api(path: string, token: string, init?: RequestInit) {
  let response = await fetch(`${API_BASE}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init?.headers || {}) } });
  if (response.status === 401) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    response = await fetch(`${API_BASE}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init?.headers || {}) } });
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`Advertising API 请求失败（HTTP ${response.status}）：${text.slice(0, 160)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function fetchReport(reportType: ReportType, start: string, end: string, token: string) {
  const created = await api("/reports", token, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `YB_${reportType}_${start}_${end}`, reportType, groupBy: "DAY", program: "WSP", fileType: "CSV", filters: { startDate: start, endDate: end }, attributionWindow: ATTRIBUTION_DAYS }),
  });
  const reportId = String(created.id || "");
  if (!reportId) throw new Error("Advertising API 未返回 reportId");
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt ? 1500 : 900));
    const status = await api(`/reports?reportId=${encodeURIComponent(reportId)}`, token);
    if (status.status === "COMPLETED" && status.url) {
      const download = await fetch(String(status.url));
      if (!download.ok) throw new Error(`广告报表下载失败（HTTP ${download.status}）`);
      return { reportId, rows: parseCsv(await download.text()) };
    }
    if (["FAILED", "ERROR", "CANCELLED"].includes(String(status.status))) throw new Error(`广告报表生成失败（${status.status}）`);
  }
  throw new Error("广告报表仍在生成，请稍后重试；数据库会继续保留已有数据");
}

async function loadReportFromDb(db: D1Database | undefined, reportType: ReportType, start: string, end: string) {
  if (!db) return null;
  const coverage = await db.prepare("SELECT COUNT(*) AS days, MIN(refreshed_at) AS oldest FROM ad_report_days WHERE report_type=? AND report_date>=? AND report_date<=?").bind(reportType, start, end).first<{ days: number; oldest: string | null }>();
  if (Number(coverage?.days || 0) < daysBetween(start, end)) return null;
  const mutable = end > addDays(todayShanghai(), -ATTRIBUTION_DAYS);
  if (mutable && (!coverage?.oldest || Date.now() - Date.parse(coverage.oldest) > MUTABLE_REPORT_CACHE_MS)) return null;
  const stored = await db.prepare("SELECT payload FROM ad_report_rows WHERE report_type=? AND report_date>=? AND report_date<=? ORDER BY report_date,entity_key").bind(reportType, start, end).all<{ payload: string }>();
  return (stored.results || []).map((item) => JSON.parse(item.payload) as CsvRow);
}

async function saveReportToDb(db: D1Database | undefined, reportType: ReportType, start: string, end: string, rows: CsvRow[]) {
  if (!db) return;
  const now = new Date().toISOString();
  const rowsByDate = new Map<string, CsvRow[]>();
  for (const row of rows) rowsByDate.set(row.Date, [...(rowsByDate.get(row.Date) || []), row]);
  const statements: D1PreparedStatement[] = [];
  for (const date of dates(start, end)) {
    statements.push(db.prepare("DELETE FROM ad_report_rows WHERE report_type=? AND report_date=?").bind(reportType, date));
    statements.push(db.prepare("INSERT INTO ad_report_days(report_type,report_date,refreshed_at) VALUES(?,?,?) ON CONFLICT(report_type,report_date) DO UPDATE SET refreshed_at=excluded.refreshed_at").bind(reportType, date, now));
    for (const [index, row] of (rowsByDate.get(date) || []).entries()) {
      const entity = reportType === "CAMPAIGN_REPORT" ? `${row.campaign_id || "unknown"}:${index}` : `${row.campaign_id || "unknown"}:${row.listing || "unknown"}:${index}`;
      statements.push(db.prepare("INSERT INTO ad_report_rows(report_type,report_date,entity_key,payload,refreshed_at) VALUES(?,?,?,?,?)").bind(reportType, date, entity, JSON.stringify(row), now));
    }
  }
  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
}

async function getReportRows(db: D1Database | undefined, reportType: ReportType, start: string, end: string, token: () => Promise<string>, force: boolean) {
  if (!force) {
    const cached = await loadReportFromDb(db, reportType, start, end);
    if (cached) return { rows: cached, reportId: null, source: "D1_DATABASE" };
  }
  const fresh = await fetchReport(reportType, start, end, await token());
  await saveReportToDb(db, reportType, start, end, fresh.rows);
  return { ...fresh, source: "ADVERTISING_API" };
}

function aggregate(rows: CsvRow[], key: string, start: string, end: string) {
  const groups = new Map<string, { metric: Metric; latest: CsvRow }>();
  for (const row of rows) {
    if (row.Date < start || row.Date > end) continue;
    const id = row[key] || "UNKNOWN";
    const current = groups.get(id) || { metric: emptyMetric(), latest: row };
    addMetric(current.metric, row);
    if (row.Date >= current.latest.Date) current.latest = row;
    groups.set(id, current);
  }
  return new Map([...groups].map(([id, value]) => [id, { ...finalize(value.metric), latest: value.latest }]));
}

function total(rows: CsvRow[], start: string, end: string) {
  const metric = emptyMetric();
  for (const row of rows) if (row.Date >= start && row.Date <= end) addMetric(metric, row);
  return finalize(metric);
}

function buildAnalysis(campaignRows: CsvRow[], listingRows: CsvRow[], start: string, end: string, decisionStart: string, decisionEnd: string, inventory: Map<string,InventoryEvidence>, goals: GoalEvidence) {
  const span = daysBetween(start, end);
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(span - 1));
  const decisionPreviousEnd = addDays(decisionStart, -1);
  const decisionPreviousStart = addDays(decisionPreviousEnd, -6);
  const asOf = todayShanghai();
  const matureThrough = addDays(asOf, -ATTRIBUTION_DAYS);
  const currentByListing = aggregate(listingRows, "listing", decisionStart, decisionEnd);
  const previousByListing = aggregate(listingRows, "listing", decisionPreviousStart, decisionPreviousEnd);
  const rolling28Start = addDays(decisionEnd, -27);
  const rollingByListing = aggregate(listingRows, "listing", rolling28Start, decisionEnd);
  const rolling56Start = addDays(decisionEnd, -55);
  const rolling56ByListing = aggregate(listingRows, "listing", rolling56Start, decisionEnd);
  const listings = [...currentByListing].map(([listing, current]) => {
    const previous = previousByListing.get(listing);
    const rolling28d = rollingByListing.get(listing);
    const rolling56d = rolling56ByListing.get(listing);
    const plan = planForListing(listing, JULY_PLAN.month);
    const nextPlan = planForListing(listing, AUGUST_PLAN.month);
    const goal = goals.byListing.get(listing) || { actualUnits: 0, julyRemainingUnits: Number(plan?.julyTargetOrders || 0), augustReserveUnits: Number(nextPlan?.augustUnits || 0), marginRate: null, marginKnown: false };
    const marginRate = goal.marginRate || plan?.marginRate || DEFAULT_MARGIN;
    const breakEvenRoas = Number((1 / marginRate).toFixed(2));
    const ratingPass = plan?.rating !== undefined && plan.rating >= 4;
    const qualityKnown = plan?.rating !== undefined;
    const partInventory = String(current.latest.first_10_part_numbers || "").split(",").map((item)=>item.trim()).filter(Boolean).map((part)=>inventory.get(part)).filter(Boolean) as InventoryEvidence[];
    const inventoryKnown = partInventory.length > 0;
    const inventoryCoverDays = inventoryKnown ? Math.min(...partInventory.map((item)=>item.coverDays)) : null;
    const currentBid = number(current.latest, "product_default_bid");
    const strategy = recommendCpcAction({
      listing,
      currentBid,
      current,
      rolling28d: rolling28d || emptyMetric(),
      breakEvenRoas,
      adRole: plan?.adRole || "observe",
      eventPhase: goals.eventPhase,
      julyPaceGap: goals.julyPaceGap,
      qualityPass: qualityKnown && ratingPass,
      marginKnown: goal.marginKnown || Boolean(plan?.marginRate),
      inventoryKnown,
      inventoryCoverDays: inventoryCoverDays || 0,
      inventoryQuantity: partInventory.reduce((sum,item)=>sum+item.quantityOnHand,0),
      julyRemainingUnits: goal.julyRemainingUnits,
      augustReserveUnits: goal.augustReserveUnits,
    });
    const actionType = strategy.actionType;
    const blockers = [
      ...strategy.blockers,
      !plan ? "未进入7月推广计划" : "",
      !goals.reliable && actionType === "INCREASE_DAILY_CAP" ? "缺7月目标进度证据" : "",
    ].filter(Boolean);
    const warnings = [
      ...strategy.warnings,
      !goal.marginKnown && !plan?.marginRate ? `保本线按店铺毛利${(DEFAULT_MARGIN * 100).toFixed(2)}%估算` : "",
      !inventoryKnown ? "库存尚未进入建议证据" : "",
    ].filter(Boolean);
    const reasons = [
      ...strategy.reasons,
      `成熟周花费$${current.spend.toFixed(0)}、${current.clicks}点击、${current.orders}单`,
      `WSC ROAS ${current.wscRoas.toFixed(2)}× / 保本 ${breakEvenRoas.toFixed(2)}×`,
      `成熟28天 ${rolling28d?.orders||0}单、ROAS ${(rolling28d?.wscRoas||0).toFixed(2)}×`,
      `成熟8周 ${rolling56d?.orders||0}单、ROAS ${(rolling56d?.wscRoas||0).toFixed(2)}×`,
      plan ? `7月角色：${plan.role}；剩余责任约${goal.julyRemainingUnits}件` : "7月计划未建档",
      nextPlan ? `8月角色：${nextPlan.role}；预留${goal.augustReserveUnits}件` : "8月计划未建档",
    ];
    const recommendation = actionType === "HOLD" ? "NO_CHANGE" : "READY";
    const execution = actionType === "HOLD" ? "NO_CHANGE" : blockers.length ? "NEEDS_INPUT" : "READY_FOR_PLAN";
    const confidence = plan && (goal.marginKnown || plan.marginRate) && qualityKnown && strategy.benchmark.cpc !== null ? "HIGH" : plan ? "MEDIUM" : "LOW";
    return {
      listing, campaignId: current.latest.campaign_id, campaignName: current.latest.campaign_name, site: current.latest.store_url,
      parts: String(current.latest.first_10_part_numbers || "").split(",").map((item) => item.trim()).filter(Boolean),
      bid: number(current.latest, "product_default_bid"), status: current.latest.product_status,
      current: { ...current, latest: undefined }, previous: previous ? { ...previous, latest: undefined } : emptyMetric(),
      rolling28d: rolling28d ? { ...rolling28d, latest: undefined } : emptyMetric(),
      rolling56d: rolling56d ? { ...rolling56d, latest: undefined } : emptyMetric(),
      plan: plan || null, nextPlan: nextPlan || null, economics: { marginRate, marginMode: goal.marginKnown ? "ORDER_ACTUAL" : plan?.marginRate ? "PLAN_SKU" : "STORE_ESTIMATE", breakEvenRoas },
      linkQuality: { rating: plan?.rating ?? null, reviews: plan?.reviews ?? null, pass: qualityKnown && ratingPass, source: plan ? "7月真实基线计划快照" : "未建档" },
      inventory: { known: inventoryKnown, coverDays: inventoryCoverDays, quantityOnHand: partInventory.reduce((sum,item)=>sum+item.quantityOnHand,0), snapshotAt: partInventory[0]?.snapshotAt||null },
      cpcBaseline: { ...strategy.benchmark, actualCpc: strategy.actualCpc, source: `${MAKEACE_CPC_PLAN.sourceFile} · P${MAKEACE_CPC_PLAN.sourcePage}`, appliesTo: MAKEACE_CPC_PLAN.appliesTo },
      goalGuardrail: { julyPaceGap: goals.julyPaceGap, eventPhase: goals.eventPhase, julyRemainingUnits: goal.julyRemainingUnits, augustReserveUnits: goal.augustReserveUnits },
      action: {
        type: actionType, label: strategy.label, recommendation, execution, confidence, reasons, blockers, warnings,
        before: { bid: currentBid, active: !/inactive|false/i.test(current.latest.product_status || "") }, proposed: strategy.proposed,
      },
    };
  }).sort((a, b) => (a.action.recommendation === "READY" ? 0 : 1) - (b.action.recommendation === "READY" ? 0 : 1) || b.current.spend - a.current.spend);

  const historyStart = previousStart < decisionPreviousStart ? previousStart : decisionPreviousStart;
  const historyMap = aggregate(campaignRows, "Date", historyStart, end > decisionEnd ? end : decisionEnd);
  const history = [...historyMap].map(([date, metric]) => ({ date, ...metric, latest: undefined })).sort((a, b) => a.date.localeCompare(b.date));
  const campaigns = [...aggregate(campaignRows, "campaign_id", start, end)].map(([campaignId, metric]) => ({ campaignId, name: metric.latest.campaign_name, targetingType: metric.latest.targeting_type, site: metric.latest.store_url, dailyCap: metric.latest.campaign_daily_cap_USD, strategy: metric.latest.bidding_strategy, ...metric, latest: undefined })).sort((a, b) => b.spend - a.spend);
  const runKey = `weekly:${decisionStart}:${decisionEnd}`;
  return {
    source: "Wayfair Advertising API + D1", generatedAt: new Date().toISOString(), attributionWindowDays: ATTRIBUTION_DAYS, runKey,
    range: { start, end, previousStart, previousEnd, asOf, matureThrough, mature: end <= matureThrough },
    decisionRange: { start: decisionStart, end: decisionEnd, previousStart: decisionPreviousStart, previousEnd: decisionPreviousEnd, cadence: "WEEKLY", rule: "每周使用截至T-14的最近完整7天成熟数据生成动作；最近7/14天只用于观察。" },
    current: total(campaignRows, start, end), previous: total(campaignRows, previousStart, previousEnd), history, campaigns, listings,
    plan: { month: JULY_PLAN.month, plannedListings: JULY_PLAN_LISTINGS.filter((item) => item.eligible).length, plannedBudget: JULY_PLAN.adBudget, cpcAnchor: MAKEACE_CPC_PLAN, goalGuardrail: { julyPaceGap: goals.julyPaceGap, eventPhase: goals.eventPhase, reliable: goals.reliable } },
    safety: { liveWritesEnabled: false, approvalEnabled: true, reason: "AI建议自动生成并可加入周执行单；生产写入保留人工确认与回滚。" },
  };
}

export async function getAdvertisingAnalysis(env: AdvertisingEnv, start: string, end: string, force = false) {
  await ensureAdTables(env.DB);
  const span = daysBetween(start, end);
  if (span < 1 || span > 42) throw new Error("广告展示周期需在1–42天内");
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(span - 1));
  const decisionEnd = addDays(todayShanghai(), -ATTRIBUTION_DAYS);
  const decisionStart = addDays(decisionEnd, -6);
  const decisionPreviousStart = addDays(decisionStart, -7);
  const decisionHistoryStart = addDays(decisionEnd, -55);
  const fetchStart = [previousStart, decisionPreviousStart, decisionHistoryStart].sort()[0];
  const today = todayShanghai();
  const fetchEnd = [end, decisionEnd, today].sort().at(-1) as string;
  if (daysBetween(fetchStart, fetchEnd) > 93) throw new Error("广告底层取数跨度超过93天，请缩短展示周期");
  const cacheKey = `ads-analysis:v7:${start}:${end}:${decisionStart}:${decisionEnd}`;
  if (env.DB && !force) {
    const cached = await env.DB.prepare("SELECT value, updated_at FROM sync_state WHERE key=?").bind(cacheKey).first<{ value: string; updated_at: string }>();
    if (cached && Date.now() - Date.parse(cached.updated_at) < ANALYSIS_CACHE_MS) return { ...JSON.parse(cached.value), cache: { hit: true, layer: "D1_ANALYSIS", updatedAt: cached.updated_at } };
  }
  let tokenPromise: Promise<string> | null = null;
  const token = () => tokenPromise ||= getToken(env);
  const [campaign, listing] = await Promise.all([
    getReportRows(env.DB, "CAMPAIGN_REPORT", fetchStart, fetchEnd, token, force),
    getReportRows(env.DB, "LISTING_REPORT", fetchStart, fetchEnd, token, force),
  ]);
  const [inventory, goals] = await Promise.all([loadInventoryEvidence(env.DB), loadGoalEvidence(env.DB, today)]);
  const analysis = {
    ...buildAnalysis(campaign.rows, listing.rows, start, end, decisionStart, decisionEnd, inventory, goals),
    reports: { campaign: campaign.reportId, listing: listing.reportId },
    cache: { hit: campaign.source === "D1_DATABASE" && listing.source === "D1_DATABASE", layer: campaign.source === "D1_DATABASE" && listing.source === "D1_DATABASE" ? "D1_REPORT_ROWS" : "ADVERTISING_API" },
  };
  if (env.DB) {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(cacheKey, JSON.stringify(analysis), now).run();
    await env.DB.prepare("INSERT INTO ad_decision_runs(run_key,decision_start,decision_end,payload,created_at) VALUES(?,?,?,?,?) ON CONFLICT(run_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at").bind(analysis.runKey, decisionStart, decisionEnd, JSON.stringify({ listings: analysis.listings, plan: analysis.plan, decisionRange: analysis.decisionRange }), now).run();
  }
  return analysis;
}

export async function cachedAdSpend(db: D1Database | undefined, start: string, end: string) {
  if (!db) return { spend: null, coverage: "NO_DB" };
  try {
    const coverage = await db.prepare("SELECT COUNT(*) AS days FROM ad_report_days WHERE report_type='CAMPAIGN_REPORT' AND report_date>=? AND report_date<=?").bind(start, end).first<{ days: number }>();
    const stored = await db.prepare("SELECT payload FROM ad_report_rows WHERE report_type='CAMPAIGN_REPORT' AND report_date>=? AND report_date<=?").bind(start, end).all<{ payload: string }>();
    const rows = (stored.results || []).map((item) => JSON.parse(item.payload) as CsvRow);
    if (rows.length) {
      const spend = rows.reduce((sum, item) => sum + number(item, "spend_USD"), 0);
      const expected = daysBetween(start, end);
      return { spend: Number(spend.toFixed(2)), coverage: Number(coverage?.days || 0) >= expected ? "FULL" : "PARTIAL", coveredDays: Number(coverage?.days || 0), expectedDays: expected, source: "D1_DATABASE" };
    }
  } catch { /* Migration may not be applied yet; fall through to legacy cache. */ }
  const cached = await db.prepare("SELECT value,updated_at FROM sync_state WHERE key=?").bind("ads-daily-latest").first<{ value: string; updated_at: string }>();
  if (!cached) return { spend: null, coverage: "NOT_SYNCED" };
  const parsed = JSON.parse(cached.value) as { history?: { date: string; spend: number }[] };
  const rows = (parsed.history || []).filter((item) => item.date >= start && item.date <= end);
  if (!rows.length) return { spend: null, coverage: "OUTSIDE_CACHE", updatedAt: cached.updated_at };
  const expected = daysBetween(start, end);
  return { spend: Number(rows.reduce((sum, item) => sum + Number(item.spend || 0), 0).toFixed(2)), coverage: rows.length >= expected ? "FULL" : "PARTIAL", coveredDays: rows.length, expectedDays: expected, updatedAt: cached.updated_at, source: "LEGACY_CACHE" };
}
import { WAYFAIR_ADVERTISING_AUDIENCE } from "./ad-action-queue.mjs";
