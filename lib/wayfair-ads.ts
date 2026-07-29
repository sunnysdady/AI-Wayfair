import { AUGUST_PLAN, AUGUST_PLAN_LISTINGS, BFIJ_PLAN, JULY_PLAN, JULY_PLAN_LISTINGS, planForListing } from "./operating-plan";
import { executionGateForAction, MAKEACE_CPC_PLAN, recommendCpcAction } from "./makeace-cpc-plan.mjs";
import { evaluateAdjustment } from "./ad-weekly-memory.mjs";
import { diagnoseAiCampaign } from "./ai-campaign-diagnosis.mjs";
import { platformObservationForCampaign } from "./ai-campaign-observations.mjs";
import { evaluateAiAdCandidate } from "./ai-ad-eligibility.mjs";
import { detectZombieCampaigns, ZOMBIE_MATURE_DAYS } from "./zombie-campaign-rules.mjs";
import { summarizeAdSpendCoverage } from "./ad-spend-coverage.mjs";
import { eventCycleForDate } from "./event-cycle.mjs";
import { applyLiveSafety } from "./ad-live-safety.mjs";
import { applyOperatorDebate } from "./ad-operator-debate.mjs";
import { buildAdDecisionModel, normalizeAdAudience } from "./ad-decision-model.mjs";
import { shouldGenerateAdModelTodo } from "./ad-model-todo.mjs";
import { resolveContributionEconomics, type SkuCostEvidence } from "./ad-contribution-economics.mjs";
import { fetchAdvertisingResponse } from "./wayfair-ad-retry.mjs";
import { syncAdActionOperation } from "./ad-operation-link.mjs";
import { catalogEvidenceKey, mergeCatalogPartEvidence, resolveCatalogOperationalEvidence, type CatalogPartEvidence } from "./catalog-operational-evidence.mjs";
import { AD_CANARY_RISK_POLICY, canaryRiskForListing } from "./ad-experiment-policy.mjs";
import {
  AUGUST_CAMPAIGN_CONTROL_SNAPSHOT,
  AUGUST_EXECUTION_POLICY,
  campaignExecutionFact,
  reconcileAugustCampaignFindings,
} from "./august-execution-policy.mjs";
import { augustSalesPlanForListing } from "./august-sales-plan.mjs";

const TOKEN_URL = "https://sso.auth.wayfair.com/oauth/token";
const API_BASE = "https://api.wayfair.io/advertising/v1";
const ATTRIBUTION_DAYS = 14;
const ANALYSIS_CACHE_MS = 60 * 60 * 1000;
const MUTABLE_REPORT_CACHE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MARGIN = .2826;
const KNOWN_PORTFOLIO_CHANGE_DATE = "2026-07-17";
const KNOWN_PORTFOLIO_COOLDOWN_UNTIL = "2026-08-07";

type CsvRow = Record<string, string>;
type AdvertisingEnv = {
  DB?: D1Database;
  WAYFAIR_AD_CLIENT_ID?: string;
  WAYFAIR_AD_CLIENT_SECRET?: string;
};
type Metric = { impressions: number; clicks: number; spend: number; orders: number; units: number; retail: number; wsc: number; ctr: number; cvr: number; cpa: number; retailRoas: number; wscRoas: number };
type ReportType = "CAMPAIGN_REPORT" | "LISTING_REPORT";
type InventoryEvidence = { quantityOnHand: number; units30d: number; coverDays: number; snapshotAt: string };
type GoalListingEvidence = { actualUnits: number; julyRemainingUnits: number; augustReserveUnits: number; marginRate: number | null; marginKnown: boolean };
type GoalEvidence = {
  julyPaceGap: number;
  eventPhase: string;
  eventContext: ReturnType<typeof eventCycleForDate>;
  reliable: boolean;
  byListing: Map<string, GoalListingEvidence>;
};

async function ensureAdTables(db: D1Database | undefined) {
  if (!db) return;
  const statements = [
    "CREATE TABLE IF NOT EXISTS ad_report_days (report_type TEXT NOT NULL, report_date TEXT NOT NULL, refreshed_at TEXT NOT NULL, PRIMARY KEY(report_type, report_date))",
    "CREATE TABLE IF NOT EXISTS ad_report_rows (report_type TEXT NOT NULL, report_date TEXT NOT NULL, entity_key TEXT NOT NULL, payload TEXT NOT NULL, refreshed_at TEXT NOT NULL, PRIMARY KEY(report_type, report_date, entity_key))",
    "CREATE INDEX IF NOT EXISTS ad_report_rows_range_idx ON ad_report_rows(report_type, report_date)",
    "CREATE TABLE IF NOT EXISTS ad_decision_runs (run_key TEXT PRIMARY KEY NOT NULL, decision_start TEXT NOT NULL, decision_end TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS ad_weekly_reviews (action_id TEXT PRIMARY KEY NOT NULL, source_run_key TEXT NOT NULL, evaluation_run_key TEXT NOT NULL, listing TEXT NOT NULL, campaign_id TEXT NOT NULL, verdict TEXT NOT NULL, payload TEXT NOT NULL, evaluated_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS ad_weekly_reviews_listing_idx ON ad_weekly_reviews(listing)",
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

async function loadSkuCostEvidence(db: D1Database | undefined) {
  const result = new Map<string, SkuCostEvidence>();
  if (!db) return result;
  try {
    const rows = await db.prepare("SELECT part_number,unit_cost_cents,currency,currency_certified_at,currency_certification_source,updated_at FROM sku_costs")
      .all<{ part_number: string; unit_cost_cents: number; currency: string; currency_certified_at: string | null; currency_certification_source: string | null; updated_at: string }>();
    for (const row of rows.results || []) {
      result.set(String(row.part_number), {
        unitCostCents: Number(row.unit_cost_cents || 0),
        currency: String(row.currency || "").toUpperCase() as "USD" | "UNVERIFIED",
        currencyCertifiedAt: String(row.currency_certified_at || ""),
        currencyCertificationSource: String(row.currency_certification_source || ""),
        updatedAt: String(row.updated_at || ""),
      });
    }
  } catch {
    // Missing or unreadable cost evidence remains a hard model blocker.
  }
  return result;
}

async function loadCatalogOperationalEvidence(db: D1Database | undefined) {
  const result = new Map<string, CatalogPartEvidence>();
  if (!db) return result;
  try {
    const rows = await db.prepare("SELECT value,updated_at FROM sync_state WHERE key LIKE 'catalog:v2:%:30::'")
      .all<{ value: string; updated_at: string }>();
    for (const row of rows.results || []) {
      const payload = JSON.parse(row.value) as {
        catalogItems?: Array<{
          supplierPartNumber?: string;
          catalogItemStatus?: string;
          marketContext?: { country?: string; segment?: string };
          listings?: Array<{ listingId?: string }>;
          insights?: {
            problems?: Array<{ title?: string; insightTypeId?: string }>;
            warnings?: Array<{ title?: string; insightTypeId?: string }>;
          };
        }>;
      };
      for (const item of payload.catalogItems || []) {
        const part = String(item.supplierPartNumber || "").trim();
        if (!part) continue;
        const country = String(item.marketContext?.country || "").trim().toUpperCase();
        const segment = String(item.marketContext?.segment || "").trim().toUpperCase();
        const key = catalogEvidenceKey(part, country, segment);
        const evidence = {
          status: String(item.catalogItemStatus || ""),
          listingIds: (item.listings || []).map((listing) => String(listing.listingId || "")).filter(Boolean),
          country,
          segment,
          problems: (item.insights?.problems || []).map((insight) => String(insight.title || insight.insightTypeId || "Catalog problem")),
          warnings: (item.insights?.warnings || []).map((insight) => String(insight.title || insight.insightTypeId || "Catalog warning")),
          updatedAt: String(row.updated_at || ""),
        };
        result.set(key, mergeCatalogPartEvidence(result.get(key), evidence));
      }
    }
  } catch {
    // Missing or stale Catalog evidence remains an explicit model blocker.
  }
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
  const base = new Map<string, GoalListingEvidence>(JULY_PLAN_LISTINGS.map((july) => {
    const august = AUGUST_PLAN_LISTINGS.find((item) => item.listing === july.listing);
    return [july.listing, {
      actualUnits: 0,
      julyRemainingUnits: Number(july.julyTargetOrders || 0),
      augustReserveUnits: Number(august?.augustUnits || 0),
      marginRate: null,
      marginKnown: false,
    }];
  }));
  const eventContext = eventCycleForDate(asOf);
  const fallback = { julyPaceGap: 0, eventPhase: eventPhaseForDate(asOf), eventContext, reliable: false, byListing: base };
  if (!db || !asOf.startsWith("2026-07")) return fallback;
  try {
    const endExclusive = addDays(asOf, 1);
    const [orders, items] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS orders FROM orders WHERE po_date>=? AND po_date<?")
        .bind("2026-07-01T00:00:00+08:00", `${endExclusive}T00:00:00+08:00`)
        .first<{ orders: number }>(),
      db.prepare(`SELECT i.part_number AS part_number, SUM(i.quantity) AS units,
        SUM(i.unit_price_cents*i.quantity) AS revenue_cents,
        SUM(CASE WHEN c.unit_cost_cents IS NOT NULL THEN c.unit_cost_cents*i.quantity ELSE 0 END) AS cost_cents,
        SUM(CASE WHEN c.unit_cost_cents IS NULL THEN i.unit_price_cents*i.quantity ELSE 0 END) AS uncovered_revenue_cents
        FROM order_items i JOIN orders o ON o.po_number=i.po_number LEFT JOIN sku_costs c
          ON c.part_number=i.part_number
          AND c.currency='USD'
          AND c.currency_certified_at IS NOT NULL
          AND c.currency_certification_source IS NOT NULL
        WHERE o.po_date>=? AND o.po_date<? GROUP BY i.part_number`)
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
      eventContext,
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

function emptyMetric(): Metric { return { impressions: 0, clicks: 0, spend: 0, orders: 0, units: 0, retail: 0, wsc: 0, ctr: 0, cvr: 0, cpa: 0, retailRoas: 0, wscRoas: 0 }; }

function addMetric(metric: Metric, row: CsvRow) {
  metric.impressions += number(row, "impressions");
  metric.clicks += number(row, "clicks");
  metric.spend += number(row, "spend_USD");
  metric.orders += number(row, "attributed_orders_window_view_through_Day_14");
  metric.units += number(row, "attributed_units_window_view_through_Day_14");
  metric.retail += number(row, "attributed_retail_sales_window_view_through_USD_Day_14");
  metric.wsc += number(row, "attributed_wholesale_cost_window_view_through_USD_Day_14");
}

function finalize(metric: Metric): Metric {
  return {
    impressions: Math.round(metric.impressions), clicks: Math.round(metric.clicks), orders: Math.round(metric.orders), units: Math.round(metric.units),
    spend: Number(metric.spend.toFixed(2)), retail: Number(metric.retail.toFixed(2)), wsc: Number(metric.wsc.toFixed(2)),
    ctr: metric.impressions ? Number((metric.clicks / metric.impressions).toFixed(4)) : 0,
    cvr: metric.clicks ? Number((metric.orders / metric.clicks).toFixed(4)) : 0,
    cpa: metric.orders ? Number((metric.spend / metric.orders).toFixed(2)) : 0,
    retailRoas: metric.spend ? Number((metric.retail / metric.spend).toFixed(2)) : 0,
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
  const response = await fetchAdvertisingResponse(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init?.headers || {}),
    },
  });
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

async function getReportRows(db: D1Database | undefined, reportType: ReportType, start: string, end: string, token: () => Promise<string>, force: boolean, refreshStart = start, refreshEnd = end) {
  const cached = await loadReportFromDb(db, reportType, start, end);
  if (cached && !force) return { rows: cached, reportId: null, source: "POSTGRESQL_DATABASE" };
  if (cached && force) {
    const fresh = await fetchReport(reportType, refreshStart, refreshEnd, await token());
    await saveReportToDb(db, reportType, refreshStart, refreshEnd, fresh.rows);
    const refreshed = await loadReportFromDb(db, reportType, start, end);
    if (!refreshed) throw new Error("广告快照写入后覆盖范围不完整");
    return { rows: refreshed, reportId: fresh.reportId, source: "ADVERTISING_API" };
  }
  const fresh = await fetchReport(reportType, start, end, await token());
  await saveReportToDb(db, reportType, start, end, fresh.rows);
  return { ...fresh, source: "ADVERTISING_API" };
}

function aggregate(rows: CsvRow[], key: string | ((row: CsvRow) => string), start: string, end: string) {
  const groups = new Map<string, { metric: Metric; latest: CsvRow }>();
  for (const row of rows) {
    if (row.Date < start || row.Date > end) continue;
    const id = (typeof key === "function" ? key(row) : row[key]) || "UNKNOWN";
    const current = groups.get(id) || { metric: emptyMetric(), latest: row };
    addMetric(current.metric, row);
    if (row.Date >= current.latest.Date) current.latest = row;
    groups.set(id, current);
  }
  return new Map([...groups].map(([id, value]) => [id, { ...finalize(value.metric), latest: value.latest }]));
}

function latestSettingChangeDates(rows: CsvRow[], start: string, end: string) {
  const byEntity = new Map<string, Map<string, { bid: number; active: boolean }>>();
  for (const row of rows) {
    if (row.Date < start || row.Date > end || !row.listing || !row.campaign_id) continue;
    const key = `${row.listing}::${row.campaign_id}`;
    const byDate = byEntity.get(key) || new Map<string, { bid: number; active: boolean }>();
    byDate.set(row.Date, {
      bid: number(row, "product_default_bid"),
      active: !/inactive|paused|false/i.test(row.product_status || ""),
    });
    byEntity.set(key, byDate);
  }
  const result = new Map<string, string>();
  for (const [key, byDate] of byEntity) {
    let previous: { bid: number; active: boolean } | null = null;
    for (const [date, state] of [...byDate].sort(([left], [right]) => left.localeCompare(right))) {
      if (previous && (Math.abs(previous.bid - state.bid) > 0.001 || previous.active !== state.active)) result.set(key, date);
      previous = state;
    }
  }
  return result;
}

function total(rows: CsvRow[], start: string, end: string) {
  const metric = emptyMetric();
  for (const row of rows) if (row.Date >= start && row.Date <= end) addMetric(metric, row);
  return finalize(metric);
}

function knownPortfolioChangeDate(asOf: string) {
  return asOf >= KNOWN_PORTFOLIO_CHANGE_DATE && asOf <= KNOWN_PORTFOLIO_COOLDOWN_UNTIL
    ? KNOWN_PORTFOLIO_CHANGE_DATE
    : null;
}

function catalogCountryForSite(site: string) {
  const normalized = String(site || "").trim().toUpperCase();
  if (normalized === "CA" || normalized.includes("CANADA") || normalized.includes(".CA")) return "CA";
  if (normalized === "US" || normalized === "USA" || normalized.includes("UNITED STATES") || normalized.includes(".COM")) return "US";
  return "";
}

function buildAnalysis(campaignRows: CsvRow[], listingRows: CsvRow[], start: string, end: string, decisionStart: string, decisionEnd: string, inventory: Map<string,InventoryEvidence>, goals: GoalEvidence, skuCosts: Map<string, SkuCostEvidence>, catalogEvidenceByPart: Map<string, CatalogPartEvidence>, weeklyMemory = new Map<string, Record<string, unknown>>()) {
  const span = daysBetween(start, end);
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(span - 1));
  const decisionPreviousEnd = addDays(decisionStart, -1);
  const decisionPreviousStart = addDays(decisionPreviousEnd, -6);
  const asOf = todayShanghai();
  const matureThrough = addDays(asOf, -ATTRIBUTION_DAYS);
  const learningStart = addDays(asOf, -(ATTRIBUTION_DAYS - 1));
  const liveSafetyEnd = addDays(asOf, -1);
  const liveSafetyStart = addDays(liveSafetyEnd, -3);
  const liveTrailingStart = addDays(liveSafetyEnd, -6);
  const campaignListingKey = (row: CsvRow) => `${row.listing || "UNKNOWN"}::${row.campaign_id || "UNKNOWN"}`;
  const campaignTargetingById = new Map(
    [...aggregate(campaignRows, "campaign_id", decisionStart, decisionEnd)]
      .map(([campaignId, metric]) => [campaignId, String(metric.latest.targeting_type || "")]),
  );
  const modelUnitKey = (row: CsvRow) => {
    const audience = normalizeAdAudience(row);
    return JSON.stringify([
      row.store_url || "",
      audience.key,
      row.campaign_id || "",
      row.targeting_type || campaignTargetingById.get(row.campaign_id || "") || "",
      row.listing || "",
    ]);
  };
  const liveRecentByCampaignListing = aggregate(listingRows, campaignListingKey, liveSafetyStart, liveSafetyEnd);
  const liveTrailingByCampaignListing = aggregate(listingRows, campaignListingKey, liveTrailingStart, liveSafetyEnd);
  const settingChanges = latestSettingChangeDates(listingRows, addDays(asOf, -35), asOf);
  const portfolioChangeDate = knownPortfolioChangeDate(asOf);
  const parentCurrentByListing = aggregate(listingRows, "listing", decisionStart, decisionEnd);
  const currentByListing = aggregate(listingRows, campaignListingKey, decisionStart, decisionEnd);
  const modelCurrentByUnit = aggregate(listingRows, modelUnitKey, decisionStart, decisionEnd);
  const modelPartSets = new Map<string, Set<string>>();
  for (const row of listingRows) {
    if (row.Date < decisionStart || row.Date > decisionEnd) continue;
    const key = modelUnitKey(row);
    const partSet = JSON.stringify([...new Set(
      String(row.first_10_part_numbers || "").split(",").map((part) => part.trim()).filter(Boolean),
    )].sort());
    const observed = modelPartSets.get(key) || new Set<string>();
    observed.add(partSet);
    modelPartSets.set(key, observed);
  }
  const previousByListing = aggregate(listingRows, campaignListingKey, decisionPreviousStart, decisionPreviousEnd);
  const rolling28Start = addDays(decisionEnd, -27);
  const rollingByListing = aggregate(listingRows, campaignListingKey, rolling28Start, decisionEnd);
  const rolling56Start = addDays(decisionEnd, -55);
  const rolling56ByListing = aggregate(listingRows, campaignListingKey, rolling56Start, decisionEnd);
  const listings = [...currentByListing].map(([exactKey, current]) => {
    const listing = current.latest.listing || exactKey.split("::")[0];
    const previous = previousByListing.get(exactKey);
    const rolling28d = rollingByListing.get(exactKey);
    const rolling56d = rolling56ByListing.get(exactKey);
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
      campaignStatus: current.latest.campaign_status,
      parts: String(current.latest.first_10_part_numbers || "").split(",").map((item)=>item.trim()).filter(Boolean),
      currentBid,
      current,
      rolling28d: rolling28d || emptyMetric(),
      breakEvenRoas,
      adRole: plan?.adRole || "observe",
      eventPhase: goals.eventPhase,
      eventContext: goals.eventContext,
      julyPaceGap: goals.julyPaceGap,
      qualityPass: qualityKnown && ratingPass,
      marginKnown: goal.marginKnown || Boolean(plan?.marginRate),
      inventoryKnown,
      inventoryCoverDays: inventoryCoverDays || 0,
      inventoryQuantity: partInventory.reduce((sum,item)=>sum+item.quantityOnHand,0),
      julyRemainingUnits: goal.julyRemainingUnits,
      augustReserveUnits: goal.augustReserveUnits,
      priorReview: weeklyMemory.get(exactKey) || null,
    });
    const liveRecent = liveRecentByCampaignListing.get(exactKey);
    const liveTrailing = liveTrailingByCampaignListing.get(exactKey);
    const latestState = liveRecent?.latest || liveTrailing?.latest || current.latest;
    const safetyApplied = applyLiveSafety({
      strategy,
      currentBid: number(latestState, "product_default_bid") || currentBid,
      breakEvenRoas,
      baselineCvr: rolling56d?.cvr || rolling28d?.cvr || current.cvr,
      recent: liveRecent || emptyMetric(),
      trailing: liveTrailing || emptyMetric(),
      latestProductStatus: latestState.product_status,
      latestCampaignStatus: latestState.campaign_status,
      forceStop: listing === "DRCI1007",
    });
    const operatorDebate = applyOperatorDebate({
      strategy: safetyApplied.strategy,
      liveSafety: safetyApplied.liveSafety,
      lastChangeDate: settingChanges.get(exactKey) || portfolioChangeDate,
      asOf,
      cooldownDays: 21,
      eventPhase: goals.eventPhase,
      hardStop: listing === "DRCI1007",
    });
    const safeStrategy = operatorDebate.strategy;
    const actionType = safeStrategy.actionType;
    const blockers = executionGateForAction({ actionType });
    const warnings = [
      ...safeStrategy.warnings,
      !goal.marginKnown && !plan?.marginRate ? `保本线按店铺毛利${(DEFAULT_MARGIN * 100).toFixed(2)}%估算` : "",
      !inventoryKnown ? "库存尚未进入建议证据" : "",
    ].filter(Boolean);
    const reasons = [
      ...safeStrategy.reasons,
      `成熟周花费$${current.spend.toFixed(0)}、${current.clicks}点击、${current.orders}单`,
      `WSC ROAS ${current.wscRoas.toFixed(2)}× / 保本 ${breakEvenRoas.toFixed(2)}×`,
      `成熟28天 ${rolling28d?.orders||0}单、ROAS ${(rolling28d?.wscRoas||0).toFixed(2)}×`,
      `成熟8周 ${rolling56d?.orders||0}单、ROAS ${(rolling56d?.wscRoas||0).toFixed(2)}×`,
      plan ? `7月角色：${plan.role}；剩余责任约${goal.julyRemainingUnits}件` : "7月计划未建档",
      nextPlan ? `8月角色：${nextPlan.role}；预留${goal.augustReserveUnits}件` : "8月计划未建档",
    ];
    const recommendation = actionType === "HOLD" ? "NO_CHANGE" : "READY";
    const execution = actionType === "HOLD" ? "NO_CHANGE" : blockers.length ? "NEEDS_INPUT" : "READY_FOR_PLAN";
    const confidence = plan && (goal.marginKnown || plan.marginRate) && qualityKnown && safeStrategy.benchmark.cpc !== null ? "HIGH" : plan ? "MEDIUM" : "LOW";
    return {
      listing, campaignId: latestState.campaign_id, campaignName: latestState.campaign_name, site: latestState.store_url,
      targetingType: latestState.targeting_type, strategy: latestState.bidding_strategy,
      productName: latestState.product_name, className: latestState.class_name,
      isB2b: latestState.isB2b, campaignStatus: latestState.campaign_status,
      parts: String(latestState.first_10_part_numbers || current.latest.first_10_part_numbers || "").split(",").map((item) => item.trim()).filter(Boolean),
      bid: number(latestState, "product_default_bid"), status: latestState.product_status,
      current: { ...current, latest: undefined }, previous: previous ? { ...previous, latest: undefined } : emptyMetric(),
      rolling28d: rolling28d ? { ...rolling28d, latest: undefined } : emptyMetric(),
      rolling56d: rolling56d ? { ...rolling56d, latest: undefined } : emptyMetric(),
      plan: plan || null, nextPlan: nextPlan || null, economics: { marginRate, marginMode: goal.marginKnown ? "ORDER_ACTUAL" : plan?.marginRate ? "PLAN_SKU" : "STORE_ESTIMATE", breakEvenRoas },
      linkQuality: { rating: plan?.rating ?? null, reviews: plan?.reviews ?? null, pass: qualityKnown && ratingPass, source: plan ? "7月真实基线计划快照" : "未建档" },
      inventory: { known: inventoryKnown, coverDays: inventoryCoverDays, quantityOnHand: partInventory.reduce((sum,item)=>sum+item.quantityOnHand,0), snapshotAt: partInventory[0]?.snapshotAt||null },
      cpcBaseline: { ...safeStrategy.benchmark, actualCpc: safeStrategy.actualCpc, source: `${MAKEACE_CPC_PLAN.sourceFile} · P${MAKEACE_CPC_PLAN.sourcePage}`, appliesTo: MAKEACE_CPC_PLAN.appliesTo },
      goalGuardrail: { julyPaceGap: goals.julyPaceGap, eventPhase: goals.eventPhase, julyRemainingUnits: goal.julyRemainingUnits, augustReserveUnits: goal.augustReserveUnits },
      weeklyReview: weeklyMemory.get(exactKey) || null,
      liveSafety: safetyApplied.liveSafety,
      operatorReview: operatorDebate.review,
      action: {
        type: actionType, label: safeStrategy.label, recommendation, execution, confidence, reasons, blockers, warnings,
        repairPlan: safeStrategy.repairPlan || null,
        before: { bid: number(latestState, "product_default_bid") || currentBid, active: !/inactive|paused|false/i.test(latestState.product_status || "") }, proposed: safeStrategy.proposed,
      },
    };
  }).sort((a, b) => (a.action.recommendation === "READY" ? 0 : 1) - (b.action.recommendation === "READY" ? 0 : 1) || b.current.spend - a.current.spend);
  const decisionModel = {
    ...buildAdDecisionModel({
      asOf,
      units: [...modelCurrentByUnit].map(([unitKey, metric]) => {
      const latest = metric.latest;
      const listing = String(latest.listing || "");
      const campaignId = String(latest.campaign_id || "");
      const site = String(latest.store_url || "");
      const audience = normalizeAdAudience(latest);
      const targetingType = String(latest.targeting_type || campaignTargetingById.get(campaignId) || "");
      const campaignStatus = String(latest.campaign_status || "");
      const campaignActiveFlag = String(latest.campaign_is_active || "");
      const campaignInactive = /INACTIVE|ARCHIVED|PAUSED|FALSE/i.test(`${campaignStatus} ${campaignActiveFlag}`);
      const campaignActive = campaignInactive
        ? false
        : /ACTIVE|TRUE/i.test(`${campaignStatus} ${campaignActiveFlag}`)
          ? true
          : null;
      const parts = String(latest.first_10_part_numbers || "").split(",").map((item) => item.trim()).filter(Boolean);
      const inventoryRows = parts.map((part) => inventory.get(part));
      const inventoryKnown = parts.length > 0 && inventoryRows.every(Boolean);
      const knownInventory = inventoryRows.filter(Boolean) as InventoryEvidence[];
      const base = listings.find((row) => row.listing === listing && String(row.campaignId) === campaignId);
      const canonicalPlan = asOf.startsWith(JULY_PLAN.month)
        ? planForListing(listing, JULY_PLAN.month)
        : asOf.startsWith(AUGUST_PLAN.month)
          ? planForListing(listing, AUGUST_PLAN.month)
          : null;
      const economics = resolveContributionEconomics({
        parts,
        canonicalParts: canonicalPlan?.parts || [],
        costByPart: skuCosts,
        attributedWsc: metric.wsc,
        attributedUnits: metric.units,
        asOf,
        mappingStable: modelPartSets.get(unitKey)?.size === 1,
      });
      const catalogEvidence = resolveCatalogOperationalEvidence({
        listing,
        parts,
        country: catalogCountryForSite(site),
        segment: audience.key,
        evidenceByPart: catalogEvidenceByPart,
        asOf,
        evaluatedAt: new Date().toISOString(),
      });
      const augustListingPlan = augustSalesPlanForListing(listing);
      return {
        identity: {
          site,
          currency: "USD",
          isB2B: audience.isB2B,
          campaignId,
          targetingType,
          listing,
        },
        operatingState: {
          campaignStatus,
          campaignActive,
          listingStatus: String(latest.product_status || ""),
        },
        metrics: {
          clicks: metric.clicks,
          spend: metric.spend,
          orders: metric.orders,
          wsc: metric.wsc,
        },
        economics: {
          marginRate: economics.marginRate,
          marginKnown: economics.marginKnown,
          mode: economics.mode,
          coverage: economics.coverage,
        },
        executionPlan: augustListingPlan ? {
          targetMetric: augustListingPlan.targetMetric,
          listingTargetOrders: augustListingPlan.targetOrders,
          listingBaseAdBudget: augustListingPlan.baseAdBudget,
          listingCanaryBudget: augustListingPlan.canaryBudget,
          listingPlannedAdBudget: augustListingPlan.plannedAdBudget,
          scaleEligible: augustListingPlan.scaleEligible,
          portfolioStageOneAdCap: AUGUST_EXECUTION_POLICY.stageOneAdCap,
          portfolioStageTwoAdCap: AUGUST_EXECUTION_POLICY.stageTwoAdCap,
        } : {
          targetMetric: AUGUST_EXECUTION_POLICY.targetMetric,
          listingTargetOrders: 0,
          listingBaseAdBudget: 0,
          listingCanaryBudget: 0,
          listingPlannedAdBudget: 0,
          scaleEligible: false,
          portfolioStageOneAdCap: AUGUST_EXECUTION_POLICY.stageOneAdCap,
          portfolioStageTwoAdCap: AUGUST_EXECUTION_POLICY.stageTwoAdCap,
        },
        campaignControl: campaignExecutionFact(campaignId),
        readiness: {
          identityComplete: Boolean(site && audience.known && campaignId && targetingType && listing),
          attributionMature: decisionEnd <= matureThrough,
          mappingComplete: parts.length > 0,
          mappingVerified: economics.mappingVerified,
          inventoryKnown,
          inventoryCoverDays: inventoryKnown ? Math.min(...knownInventory.map((item) => item.coverDays)) : null,
          inventoryFresh: inventoryKnown && knownInventory.every((item) => item.snapshotAt.slice(0, 10) >= addDays(asOf, -3)),
          linkPass: Boolean(base?.linkQuality.pass) && catalogEvidence.pass,
          linkEvidenceVerified: catalogEvidence.verified,
          cooldownUntil: base?.operatorReview?.cooldownUntil || null,
          platformStrategy: String(latest.bidding_strategy || ""),
        },
      };
      }),
    }),
    riskPolicy: AD_CANARY_RISK_POLICY,
  };
  const modelTodo = decisionModel.decisions
    .flatMap((decision) => {
      if (!shouldGenerateAdModelTodo(decision).include) return [];
      const candidate = decision.candidates.find((item) => item.action === decision.suggestedAction);
      const listing = String(decision.identity.listing || "UNKNOWN");
      const campaignId = String(decision.identity.campaignId || "UNKNOWN");
      const isCanary = decision.suggestedAction === "CANARY_BUDGET_10";
      const canaryRisk = canaryRiskForListing(listing);
      if (!isCanary && !decision.blockers.length) return [];
      const waitForEvidence = decision.blockers.some((item) => ["ATTRIBUTION_IMMATURE", "MINIMUM_EVIDENCE", "COOLDOWN_ACTIVE"].includes(item));
      const manualAiReview = decision.blockers.includes("AI_TROAS_LISTING_ACTION_UNSUPPORTED");
      const taskType = isCanary ? "DESIGN_CANARY" : manualAiReview ? "MANUAL_AI_REVIEW" : waitForEvidence ? "WAIT_FOR_EVIDENCE" : "FIX_MODEL_INPUT";
      const suffix = `${decisionStart}-${decision.unitKey}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 104);
      return [{
        id: `model-${suffix}`,
        unitKey: decision.unitKey,
        identity: decision.identity,
        listing,
        campaignId,
        priority: isCanary || manualAiReview ? "P1" : "P2",
        type: taskType,
        title: isCanary ? "设计 10% 小额 Canary 对照" : manualAiReview ? "转 Campaign 级 AI 人工评审" : waitForEvidence ? "等待证据成熟后重新评分" : "修复模型证据后重新评分",
        detail: isCanary
          ? "当前因果置信度为 C0；先完成预注册、对照选择、功效分析和最大损失审批，不得直接扩量。"
          : `模型保持 HOLD；阻断项：${decision.blockers.join("、") || "当前动作未显著优于 HOLD"}`,
        suggestedAction: decision.suggestedAction,
        executionPlan: decision.executionPlan,
        campaignControl: decision.campaignControl,
        blockers: decision.blockers,
        confidence: decision.confidence,
        attributedScenarioDelta: candidate ? {
          orders: candidate.attributedScenarioDelta.orders,
          spend: candidate.attributedScenarioDelta.spend,
          wsc: candidate.attributedScenarioDelta.wsc,
          contributionProxy: candidate.attributedScenarioDelta.contributionProxy,
        } : null,
        incrementalContributionProbability: null,
        experimentContract: isCanary ? {
          status: canaryRisk.approved ? "RISK_LIMIT_APPROVED_PENDING_GATES" : "DRAFT_REQUIRES_APPROVAL",
          treatment: "单一变量 10% 预算 Canary",
          control: "同期匹配对照或预注册 switchback",
          primaryMetric: "成熟总订单增量与广告后贡献代理",
          attributionWaitDays: ATTRIBUTION_DAYS,
          minimumSampleSize: null,
          requiresPowerAnalysis: true,
          maxIncrementalLoss: canaryRisk.maxLoss,
          maxDailyIncrementalLoss: canaryRisk.maxDailyIncrementalLoss,
          portfolioMaxIncrementalLoss: AD_CANARY_RISK_POLICY.portfolioMaxLoss,
          portfolioMaxDailyIncrementalLoss: AD_CANARY_RISK_POLICY.portfolioMaxDailyIncrementalLoss,
          earliestStart: AD_CANARY_RISK_POLICY.earliestStart,
          earliestMatureReview: AD_CANARY_RISK_POLICY.earliestMatureReview,
          stopRule: canaryRisk.approved
            ? `单 Listing 增量损失达到 $${canaryRisk.maxLoss.toFixed(2)}、组合达到 $${AD_CANARY_RISK_POLICY.portfolioMaxLoss.toFixed(2)}，或账户月度贡献代理预测低于 $${AD_CANARY_RISK_POLICY.monthlyContributionFloor.toFixed(2)}，任一触发立即停止；归因成熟前不判胜负。`
            : "最大损失未获运营风险预算，不得启动；归因成熟前不判胜负。",
          contaminationControls: ["价格", "Promotion", "Offer", "素材", "库存", "Catalog"],
        } : null,
        mode: "SHADOW",
        eligibleForExecution: false,
      }];
    })
    .sort((left: { priority: string; listing: string }, right: { priority: string; listing: string }) => left.priority.localeCompare(right.priority) || left.listing.localeCompare(right.listing));
  const parentListings = [...parentCurrentByListing].flatMap(([listing, metric]) => {
    const base = listings.find((row) => row.listing === listing);
    if (!base) return [];
    return [{
      ...base,
      campaignId: metric.latest.campaign_id,
      campaignName: metric.latest.campaign_name,
      current: { ...metric, latest: undefined },
      bid: number(metric.latest, "product_default_bid"),
      status: metric.latest.product_status,
    }];
  });
  const liveSafetyFindings = [...liveRecentByCampaignListing].flatMap(([exactKey, recent]) => {
    const [listing, campaignId] = exactKey.split("::");
    const base = listings.find((row) => row.listing === listing && String(row.campaignId) === campaignId)
      || listings.find((row) => row.listing === listing);
    if (!base) return [];
    const trailing = liveTrailingByCampaignListing.get(exactKey);
    const currentBid = number(recent.latest, "product_default_bid");
    const assessed = applyLiveSafety({
      strategy: {
        actionType: "HOLD",
        label: "实时安全窗观察",
        proposed: {},
        reasons: [],
        warnings: [],
      },
      currentBid,
      breakEvenRoas: base.economics.breakEvenRoas,
      baselineCvr: base.rolling56d.cvr || base.rolling28d.cvr || base.current.cvr,
      recent,
      trailing: trailing || emptyMetric(),
      latestProductStatus: recent.latest.product_status,
      latestCampaignStatus: recent.latest.campaign_status,
      forceStop: listing === "DRCI1007",
    });
    const operatorDebate = applyOperatorDebate({
      strategy: assessed.strategy,
      liveSafety: assessed.liveSafety,
      lastChangeDate: settingChanges.get(exactKey) || portfolioChangeDate,
      asOf,
      cooldownDays: 21,
      eventPhase: goals.eventPhase,
      hardStop: listing === "DRCI1007",
    });
    const isVisibleAlert = assessed.liveSafety.status === "ALERT" || assessed.liveSafety.status === "CONFIRMED_STOP";
    if (!isVisibleAlert) return [];
    const blockers = executionGateForAction({ actionType: operatorDebate.strategy.actionType });
    return [{
      ...base,
      campaignId,
      campaignName: recent.latest.campaign_name,
      site: recent.latest.store_url,
      productName: recent.latest.product_name,
      className: recent.latest.class_name,
      isB2b: recent.latest.isB2b,
      campaignStatus: recent.latest.campaign_status,
      parts: String(recent.latest.first_10_part_numbers || "").split(",").map((item) => item.trim()).filter(Boolean),
      bid: currentBid,
      status: recent.latest.product_status,
      current: { ...recent, latest: undefined },
      previous: trailing ? { ...trailing, latest: undefined } : emptyMetric(),
      cpcBaseline: { ...base.cpcBaseline, actualCpc: recent.clicks ? Number((recent.spend / recent.clicks).toFixed(2)) : null },
      liveSafety: assessed.liveSafety,
      operatorReview: operatorDebate.review,
      action: {
        ...base.action,
        type: operatorDebate.strategy.actionType,
        label: operatorDebate.strategy.label,
        recommendation: operatorDebate.strategy.actionType === "HOLD" ? "NO_CHANGE" : "READY",
        execution: operatorDebate.strategy.actionType === "HOLD" ? "NO_CHANGE" : blockers.length ? "NEEDS_INPUT" : "READY_FOR_PLAN",
        reasons: operatorDebate.strategy.reasons,
        blockers,
        warnings: operatorDebate.strategy.warnings,
        repairPlan: null,
        before: { bid: currentBid, active: !/inactive|paused|false/i.test(recent.latest.product_status || "") },
        proposed: operatorDebate.strategy.proposed,
      },
    }];
  }).sort((a, b) => b.current.spend - a.current.spend);

  const historyStart = previousStart < decisionPreviousStart ? previousStart : decisionPreviousStart;
  const historyMap = aggregate(campaignRows, "Date", historyStart, end > decisionEnd ? end : decisionEnd);
  const history = [...historyMap].map(([date, metric]) => ({ date, ...metric, latest: undefined })).sort((a, b) => a.date.localeCompare(b.date));
  const campaigns = [...aggregate(campaignRows, "campaign_id", start, end)].map(([campaignId, metric]) => ({
    campaignId,
    name: metric.latest.campaign_name,
    targetingType: metric.latest.targeting_type,
    site: metric.latest.store_url,
    status: metric.latest.campaign_status,
    isActive: metric.latest.campaign_is_active,
    isB2b: metric.latest.isB2b,
    dailyCap: metric.latest.campaign_daily_cap_USD,
    lifetimeBudget: metric.latest.campaign_lifetime_budget_USD,
    startDate: metric.latest.campaign_start_date,
    endDate: metric.latest.campaign_end_date,
    strategy: metric.latest.bidding_strategy,
    targetRoas: metric.latest.target_roas_percentage,
    ...metric,
    latest: undefined,
  })).sort((a, b) => b.spend - a.spend);
  const latestCampaigns = aggregate(campaignRows, "campaign_id", learningStart, asOf);
  const aiCampaignDiagnostics = [...latestCampaigns].map(([campaignId, metric]) => {
    const diagnosis = diagnoseAiCampaign({
      campaignId,
      campaignName: metric.latest.campaign_name,
      strategy: metric.latest.bidding_strategy,
      status: metric.latest.campaign_status,
      isActive: metric.latest.campaign_is_active,
      startDate: metric.latest.campaign_start_date,
      asOf,
      orders14d: metric.orders,
      spend14d: metric.spend,
      clicks14d: metric.clicks,
      dailyCap: metric.latest.campaign_daily_cap_USD,
      targetRoas: metric.latest.target_roas_percentage,
      ...platformObservationForCampaign(campaignId),
    });
    if (!diagnosis) return null;
    return {
      campaignId,
      name: metric.latest.campaign_name,
      strategy: metric.latest.bidding_strategy,
      status: metric.latest.campaign_status,
      startDate: metric.latest.campaign_start_date,
      dailyCap: metric.latest.campaign_daily_cap_USD,
      targetRoas: metric.latest.target_roas_percentage,
      current14d: { ...metric, latest: undefined },
      ...diagnosis,
    };
  }).filter(Boolean).sort((a, b) => {
    const rank = { P0: 0, P1: 1, P2: 2 } as Record<string, number>;
    return (rank[String(a?.priority)] ?? 3) - (rank[String(b?.priority)] ?? 3);
  });
  const learningByListing = aggregate(listingRows, "listing", learningStart, asOf);
  const aiCampaignIds = new Set([...latestCampaigns].filter(([, metric]) => /AI Bidding|TROAS/i.test(String(metric.latest.bidding_strategy || ""))).map(([campaignId]) => campaignId));
  const aiAdEligibility = listings.map((listing) => {
    const metric = learningByListing.get(listing.listing);
    if (!metric || aiCampaignIds.has(String(listing.campaignId))) return null;
    return {
      campaignId: listing.campaignId, parts: listing.parts, inventory: listing.inventory, linkQuality: listing.linkQuality,
      ...evaluateAiAdCandidate({ listing: listing.listing, orders14d: metric.orders, spend14d: metric.spend, wsc14d: metric.wsc, inventoryKnown: listing.inventory.known, coverDays: listing.inventory.coverDays, linkPass: listing.linkQuality.pass, marginRate: listing.economics.marginRate, breakEvenRoas: listing.economics.breakEvenRoas }),
    };
  }).filter(Boolean).sort((a, b) => Number(Boolean(b?.canLaunch)) - Number(Boolean(a?.canLaunch)) || Number(a?.orderGap || 0) - Number(b?.orderGap || 0));
  const rawZombieFindings = detectZombieCampaigns({
    campaignRows,
    listingRows,
    decisionEnd,
  });
  const zombieReconciliation =
    reconcileAugustCampaignFindings(rawZombieFindings);
  const zombieFindings = zombieReconciliation.findings;
  const zombieAudit = {
    matureDays: ZOMBIE_MATURE_DAYS,
    total: zombieFindings.length,
    hard: zombieFindings.filter((item) => item.severity === "P0").length,
    near: zombieFindings.filter((item) => item.severity === "P1").length,
  };
  const runKey = `weekly:${decisionStart}:${decisionEnd}`;
  return {
    source: "Wayfair Advertising API + PostgreSQL", generatedAt: new Date().toISOString(), attributionWindowDays: ATTRIBUTION_DAYS, runKey,
    range: { start, end, previousStart, previousEnd, asOf, matureThrough, mature: end <= matureThrough },
    decisionRange: { start: decisionStart, end: decisionEnd, previousStart: decisionPreviousStart, previousEnd: decisionPreviousEnd, cadence: "WEEKLY", rule: "T-14成熟周用于效果评估；最近4个完整日只生成预警，最近7日持续异常需经过运营辩论。活动期与调整后21天冷却期禁止绩效调参。" },
    liveSafetyRange: { start: liveSafetyStart, end: liveSafetyEnd, trailingStart: liveTrailingStart, days: 4, rule: "4日花费≥$20、点击≥30且0单只触发预警；持续7日且达到Campaign成熟CVR的95%异常样本门槛才进入运营辩论，未成熟数据禁止直接调参。" },
    current: total(campaignRows, start, end), previous: total(campaignRows, previousStart, previousEnd), decision: { current: total(campaignRows, decisionStart, decisionEnd), previous: total(campaignRows, decisionPreviousStart, decisionPreviousEnd) }, history, campaigns, listings, parentListings, liveSafetyFindings, aiCampaignDiagnostics, aiAdEligibility, zombieFindings, zombieAudit, decisionModel, modelTodo,
    campaignControl: AUGUST_CAMPAIGN_CONTROL_SNAPSHOT,
    suppressedCampaignFindings: zombieReconciliation.suppressed,
    plan: { month: JULY_PLAN.month, plannedListings: JULY_PLAN_LISTINGS.filter((item) => item.eligible).length, plannedBudget: JULY_PLAN.adBudget, cpcAnchor: MAKEACE_CPC_PLAN, goalGuardrail: { julyPaceGap: goals.julyPaceGap, eventPhase: goals.eventPhase, reliable: goals.reliable } },
    safety: {
      liveWritesEnabled: false,
      approvalEnabled: true,
      knownPortfolioChange: { date: KNOWN_PORTFOLIO_CHANGE_DATE, cooldownUntil: KNOWN_PORTFOLIO_COOLDOWN_UNTIL, source: "已确认运营变更" },
      reason: "AI建议自动生成并可加入周执行单；生产写入保留人工确认与回滚。",
    },
  };
}

async function loadWeeklyMemory(db: D1Database | undefined) {
  const memory = new Map<string, Record<string, unknown>>();
  if (!db) return memory;
  const rows = await db.prepare(`SELECT r.listing,r.campaign_id,r.payload FROM ad_weekly_reviews r
    WHERE r.evaluated_at=(SELECT MAX(r2.evaluated_at) FROM ad_weekly_reviews r2 WHERE r2.listing=r.listing AND r2.campaign_id=r.campaign_id)`)
    .all<{ listing: string; campaign_id: string; payload: string }>();
  for (const row of rows.results || []) {
    try { memory.set(`${row.listing}::${row.campaign_id}`, JSON.parse(row.payload)); } catch { /* Ignore malformed legacy rows. */ }
  }
  return memory;
}

async function syncWeeklyReviews(db: D1Database | undefined, analysis: ReturnType<typeof buildAnalysis>) {
  if (!db) return;
  const actions = await db.prepare(`SELECT q.id,q.run_key,q.listing,q.campaign_id,q.action_type,q.before_payload,q.proposed_payload,
    e.created_at AS executed_at,d.payload AS source_payload
    FROM ad_action_queue q
    JOIN ad_decision_runs d ON d.run_key=q.run_key
    JOIN ad_action_events e ON e.id=(SELECT e2.id FROM ad_action_events e2 WHERE e2.action_id=q.id AND e2.event_type='EXECUTED' ORDER BY e2.created_at DESC LIMIT 1)
    WHERE q.status='EXECUTED' AND q.action_type='SET_LISTING_BID'`)
    .all<{ id:string;run_key:string;listing:string;campaign_id:string;action_type:string;before_payload:string;proposed_payload:string;executed_at:string;source_payload:string }>();
  const now = new Date().toISOString();
  for (const action of actions.results || []) {
    let source: { listings?: Array<{ listing:string; campaignId?:string; current:Metric; economics?:{breakEvenRoas?:number} }> };
    try { source = JSON.parse(action.source_payload); } catch { continue; }
    const baseline = source.listings?.find((row) => row.listing === action.listing && String(row.campaignId) === action.campaign_id);
    const observed = analysis.listings.find((row) => row.listing === action.listing && String(row.campaignId) === action.campaign_id);
    if (!baseline || !observed) continue;
    const executedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(action.executed_at));
    const review = evaluateAdjustment({
      action, baseline: baseline.current, observed: observed.current, executedDate,
      matureThrough: analysis.range.matureThrough,
      breakEvenRoas: observed.economics.breakEvenRoas || baseline.economics?.breakEvenRoas || 0,
    });
    const payload = { ...review, actionId: action.id, sourceRunKey: action.run_key, evaluationRunKey: analysis.runKey, listing: action.listing, campaignId: action.campaign_id, executedAt: action.executed_at, baseline: baseline.current, observed: observed.current };
    await db.prepare(`INSERT INTO ad_weekly_reviews(action_id,source_run_key,evaluation_run_key,listing,campaign_id,verdict,payload,evaluated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(action_id) DO UPDATE SET evaluation_run_key=excluded.evaluation_run_key,verdict=excluded.verdict,payload=excluded.payload,evaluated_at=excluded.evaluated_at`)
      .bind(action.id, action.run_key, analysis.runKey, action.listing, action.campaign_id, review.verdict, JSON.stringify(payload), now).run();
    await syncAdActionOperation(db, action, "REVIEWED", payload);
  }
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
  const campaignFetchEnd = today;
  const listingFetchEnd = today;
  const fetchEnd = [campaignFetchEnd, listingFetchEnd].sort().at(-1) as string;
  if (daysBetween(fetchStart, fetchEnd) > 93) throw new Error("广告底层取数跨度超过93天，请缩短展示周期");
  const cacheKey = `ads-analysis:v24:${start}:${end}:${decisionStart}:${decisionEnd}`;
  if (env.DB && !force) {
    const [cached, catalogVersion] = await Promise.all([
      env.DB.prepare("SELECT value, updated_at FROM sync_state WHERE key=?").bind(cacheKey).first<{ value: string; updated_at: string }>(),
      env.DB.prepare("SELECT MAX(updated_at) AS updated_at FROM sync_state WHERE key LIKE 'catalog:v2:%:30::'").first<{ updated_at: string | null }>(),
    ]);
    const catalogNotNewer = !catalogVersion?.updated_at || (cached && Date.parse(cached.updated_at) >= Date.parse(catalogVersion.updated_at));
    if (cached && catalogNotNewer && Date.now() - Date.parse(cached.updated_at) < ANALYSIS_CACHE_MS) return { ...JSON.parse(cached.value), cache: { hit: true, layer: "POSTGRESQL_ANALYSIS", updatedAt: cached.updated_at } };
  }
  let tokenPromise: Promise<string> | null = null;
  const token = () => tokenPromise ||= getToken(env);
  const [campaign, listing] = await Promise.all([
    getReportRows(env.DB, "CAMPAIGN_REPORT", fetchStart, campaignFetchEnd, token, force, start, campaignFetchEnd),
    getReportRows(env.DB, "LISTING_REPORT", fetchStart, listingFetchEnd, token, force, start, end),
  ]);
  const [inventory, goals, skuCosts, catalogEvidence] = await Promise.all([
    loadInventoryEvidence(env.DB),
    loadGoalEvidence(env.DB, today),
    loadSkuCostEvidence(env.DB),
    loadCatalogOperationalEvidence(env.DB),
  ]);
  const preliminary = buildAnalysis(campaign.rows, listing.rows, start, end, decisionStart, decisionEnd, inventory, goals, skuCosts, catalogEvidence);
  await syncWeeklyReviews(env.DB, preliminary);
  const weeklyMemory = await loadWeeklyMemory(env.DB);
  const analysis = {
    ...buildAnalysis(campaign.rows, listing.rows, start, end, decisionStart, decisionEnd, inventory, goals, skuCosts, catalogEvidence, weeklyMemory),
    reports: { campaign: campaign.reportId, listing: listing.reportId },
    cache: { hit: campaign.source === "POSTGRESQL_DATABASE" && listing.source === "POSTGRESQL_DATABASE", layer: campaign.source === "POSTGRESQL_DATABASE" && listing.source === "POSTGRESQL_DATABASE" ? "POSTGRESQL_REPORT_ROWS" : "ADVERTISING_API" },
  };
  if (env.DB) {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(cacheKey, JSON.stringify(analysis), now).run();
    await env.DB.prepare("INSERT INTO ad_decision_runs(run_key,decision_start,decision_end,payload,created_at) VALUES(?,?,?,?,?) ON CONFLICT(run_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at").bind(analysis.runKey, decisionStart, decisionEnd, JSON.stringify({ listings: analysis.listings, liveSafetyFindings: analysis.liveSafetyFindings, liveSafetyRange: analysis.liveSafetyRange, zombieFindings: analysis.zombieFindings, zombieAudit: analysis.zombieAudit, campaignControl: analysis.campaignControl, decisionModel: analysis.decisionModel, modelTodo: analysis.modelTodo, plan: analysis.plan, decisionRange: analysis.decisionRange }), now).run();
  }
  return analysis;
}

export async function cachedAdSpend(db: D1Database | undefined, start: string, end: string) {
  if (!db) return { spend: null, coverage: "NO_DB" };
  try {
    const [ledger, stored] = await Promise.all([
      db.prepare("SELECT report_date, refreshed_at FROM ad_report_days WHERE report_type='CAMPAIGN_REPORT' AND report_date>=? AND report_date<=?").bind(start, end).all<{ report_date: string; refreshed_at: string }>(),
      db.prepare("SELECT report_date, payload FROM ad_report_rows WHERE report_type='CAMPAIGN_REPORT' AND report_date>=? AND report_date<=?").bind(start, end).all<{ report_date: string; payload: string }>(),
    ]);
    const summary = summarizeAdSpendCoverage({
      start,
      end,
      asOf: todayShanghai(),
      days: (ledger.results || []).map((row) => ({ reportDate: row.report_date, refreshedAt: row.refreshed_at })),
      rows: (stored.results || []).map((row) => ({ reportDate: row.report_date, spend: number(JSON.parse(row.payload) as CsvRow, "spend_USD") })),
    });
    return { ...summary, source: "POSTGRESQL_DATABASE" };
  } catch (error) {
    // Storage is unreachable (unapplied migration, or a read-only binding).
    // Orders must still render, so report the gap instead of failing the route.
    return { spend: null, coverage: "UNAVAILABLE", error: error instanceof Error ? error.message : "广告花费快照不可读" };
  }
}
import { WAYFAIR_ADVERTISING_AUDIENCE } from "./ad-action-queue.mjs";
