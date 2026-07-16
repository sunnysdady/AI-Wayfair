import { PLAN_LISTINGS, planForListing } from "./operating-plan";

const TOKEN_URL = "https://sso.auth.wayfair.com/oauth/token";
const API_BASE = "https://api.wayfair.io/advertising/v1";
const ATTRIBUTION_DAYS = 14;
const CACHE_MS = 30 * 60 * 1000;
const DEFAULT_MARGIN = .2826;

type Db = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first: <T>() => Promise<T | null>;
      run: () => Promise<unknown>;
    };
  };
};

type CsvRow = Record<string, string>;
type Metric = { impressions: number; clicks: number; spend: number; orders: number; units: number; wsc: number; ctr: number; cvr: number; wscRoas: number };

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
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

async function getToken(env: Record<string, string>) {
  if (!env.WAYFAIR_AD_CLIENT_ID || !env.WAYFAIR_AD_CLIENT_SECRET) throw new Error("Advertising API 凭证未配置");
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: env.WAYFAIR_AD_CLIENT_ID, client_secret: env.WAYFAIR_AD_CLIENT_SECRET, audience: "https://api.wayfair.io/" }),
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
    // Wayfair occasionally returns a transient JWKS 401. The caller keeps the same token and retries once.
    await new Promise((resolve) => setTimeout(resolve, 500));
    response = await fetch(`${API_BASE}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init?.headers || {}) } });
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`Advertising API 请求失败（HTTP ${response.status}）：${text.slice(0, 160)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function report(reportType: "CAMPAIGN_REPORT" | "LISTING_REPORT", start: string, end: string, token: string) {
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
  throw new Error("广告报表仍在生成，请稍后重试；已保留上次缓存");
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

function buildAnalysis(campaignRows: CsvRow[], listingRows: CsvRow[], start: string, end: string) {
  const span = daysBetween(start, end);
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(span - 1));
  const asOf = todayShanghai();
  const matureThrough = addDays(asOf, -ATTRIBUTION_DAYS);
  const mature = end <= matureThrough;
  const currentByListing = aggregate(listingRows, "listing", start, end);
  const previousByListing = aggregate(listingRows, "listing", previousStart, previousEnd);
  const listings = [...currentByListing].map(([listing, current]) => {
    const previous = previousByListing.get(listing);
    const plan = planForListing(listing);
    const marginRate = plan?.marginRate || DEFAULT_MARGIN;
    const breakEvenRoas = Number((1 / marginRate).toFixed(2));
    const ratingPass = plan?.rating !== undefined && plan.rating >= 4;
    const planPass = Boolean(plan?.eligible && plan.budget > 0);
    const qualityKnown = plan?.rating !== undefined;
    const inventoryKnown = false;
    let action = "等待数据成熟";
    let actionType = "WAIT_DATA";
    let proposed: Record<string, unknown> = {};
    if (mature && !planPass && current.spend > 0) { action = "暂停计划外 Listing"; actionType = "SET_LISTING_ACTIVE"; proposed = { active: false }; }
    else if (mature && current.clicks >= 20 && current.orders === 0) { action = "Listing Bid 下调 10%并排查链接"; actionType = "SET_LISTING_BID"; proposed = { bid: Number((number(current.latest, "product_default_bid") * .9).toFixed(2)) }; }
    else if (mature && current.spend > 0 && current.wscRoas < breakEvenRoas) { action = "Listing Bid 下调 10%"; actionType = "SET_LISTING_BID"; proposed = { bid: Number((number(current.latest, "product_default_bid") * .9).toFixed(2)) }; }
    else if (mature && planPass && ratingPass && current.cvr >= .02 && current.wscRoas >= Math.max(breakEvenRoas, 4)) { action = "审核后增加Campaign Cap 20%"; actionType = "INCREASE_DAILY_CAP"; proposed = { change: "+20%", manual: true }; }
    else if (mature) { action = "保持参数，进入下一成熟周复查"; actionType = "HOLD"; }
    const blockers = [
      !mature ? `归因未成熟（成熟至 ${matureThrough}）` : "",
      !plan ? "未进入月度计划" : !planPass ? plan.gate : "",
      !qualityKnown ? "评分/评论快照缺失" : !ratingPass ? `评分 ${plan?.rating} 低于放量门槛` : "",
      !inventoryKnown ? "库存覆盖天数未接入" : "",
      !plan?.marginRate ? "使用店铺默认毛利率估算保本线" : "",
    ].filter(Boolean);
    const execution = blockers.length || actionType === "HOLD" || actionType === "WAIT_DATA" ? "BLOCKED" : ["SET_LISTING_ACTIVE", "SET_LISTING_BID"].includes(actionType) ? "API_DRY_RUN" : "MANUAL_TASK";
    return {
      listing, campaignId: current.latest.campaign_id, campaignName: current.latest.campaign_name, site: current.latest.store_url,
      parts: String(current.latest.first_10_part_numbers || "").split(",").map((item) => item.trim()).filter(Boolean),
      bid: number(current.latest, "product_default_bid"), status: current.latest.product_status,
      current: { ...current, latest: undefined }, previous: previous ? { ...previous, latest: undefined } : emptyMetric(),
      plan: plan || null, economics: { marginRate, marginMode: plan?.marginRate ? "PLAN_SKU" : "STORE_ESTIMATE", breakEvenRoas },
      linkQuality: { rating: plan?.rating ?? null, reviews: plan?.reviews ?? null, pass: qualityKnown && ratingPass, source: plan ? "月度Playbook快照" : "未建档" },
      action: { type: actionType, label: action, before: { bid: number(current.latest, "product_default_bid"), active: !/inactive|false/i.test(current.latest.product_status || "") }, proposed, execution, blockers },
    };
  }).sort((a, b) => (a.action.execution === "BLOCKED" ? 1 : 0) - (b.action.execution === "BLOCKED" ? 1 : 0) || b.current.spend - a.current.spend);

  const historyMap = aggregate(campaignRows, "Date", previousStart, end);
  const history = [...historyMap].map(([date, metric]) => ({ date, ...metric, latest: undefined })).sort((a, b) => a.date.localeCompare(b.date));
  const campaigns = [...aggregate(campaignRows, "campaign_id", start, end)].map(([campaignId, metric]) => ({ campaignId, name: metric.latest.campaign_name, targetingType: metric.latest.targeting_type, site: metric.latest.store_url, dailyCap: metric.latest.campaign_daily_cap_USD, strategy: metric.latest.bidding_strategy, ...metric, latest: undefined })).sort((a, b) => b.spend - a.spend);
  return {
    source: "Wayfair Advertising API", generatedAt: new Date().toISOString(), attributionWindowDays: ATTRIBUTION_DAYS,
    range: { start, end, previousStart, previousEnd, asOf, matureThrough, mature },
    current: total(campaignRows, start, end), previous: total(campaignRows, previousStart, previousEnd), history, campaigns, listings,
    plan: { month: "2026-08", plannedListings: PLAN_LISTINGS.filter((item) => item.eligible).length, plannedBudget: 1800 },
    safety: { liveWritesEnabled: false, approvalEnabled: false, reason: "第一阶段仅生成可解释清单；缺失库存/链接/利润Gate时禁止审批。" },
  };
}

export async function getAdvertisingAnalysis(env: Record<string, string> & { DB?: Db }, start: string, end: string, force = false) {
  const span = daysBetween(start, end);
  if (span < 1 || span > 42) throw new Error("广告分析周期需在1–42天内");
  const previousEnd = addDays(start, -1);
  const historyStart = addDays(previousEnd, -(span - 1));
  const cacheKey = `ads-analysis:${start}:${end}`;
  if (env.DB && !force) {
    const cached = await env.DB.prepare("SELECT value, updated_at FROM sync_state WHERE key = ?").bind(cacheKey).first<{ value: string; updated_at: string }>();
    if (cached && Date.now() - Date.parse(cached.updated_at) < CACHE_MS) return { ...JSON.parse(cached.value), cache: { hit: true, updatedAt: cached.updated_at } };
  }
  const token = await getToken(env);
  const [campaign, listing] = await Promise.all([report("CAMPAIGN_REPORT", historyStart, end, token), report("LISTING_REPORT", historyStart, end, token)]);
  const analysis = { ...buildAnalysis(campaign.rows, listing.rows, start, end), reports: { campaign: campaign.reportId, listing: listing.reportId }, cache: { hit: false } };
  if (env.DB) {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(cacheKey, JSON.stringify(analysis), now).run();
    await env.DB.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind("ads-daily-latest", JSON.stringify({ history: analysis.history, range: analysis.range }), now).run();
  }
  return analysis;
}

export async function cachedAdSpend(db: Db | undefined, start: string, end: string) {
  if (!db) return { spend: null, coverage: "NO_DB" };
  const cached = await db.prepare("SELECT value, updated_at FROM sync_state WHERE key = ?").bind("ads-daily-latest").first<{ value: string; updated_at: string }>();
  if (!cached) return { spend: null, coverage: "NOT_SYNCED" };
  const parsed = JSON.parse(cached.value) as { history?: { date: string; spend: number }[] };
  const rows = (parsed.history || []).filter((item) => item.date >= start && item.date <= end);
  const expected = daysBetween(start, end);
  if (!rows.length) return { spend: null, coverage: "OUTSIDE_CACHE", updatedAt: cached.updated_at };
  return { spend: Number(rows.reduce((sum, item) => sum + Number(item.spend || 0), 0).toFixed(2)), coverage: rows.length >= expected ? "FULL" : "PARTIAL", coveredDays: rows.length, expectedDays: expected, updatedAt: cached.updated_at };
}
