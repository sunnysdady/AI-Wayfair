import { cachedAdSpend } from "../../../../lib/wayfair-ads";

const TOKEN_URL = "https://sso.auth.wayfair.com/oauth/token";
const ORDER_ENDPOINT = "https://api.wayfair.com/v1/graphql";
const DEFAULT_MARGIN_RATE = 0.2826;
const PRELOAD_DAYS = 62;
const FRESH_MS = 60 * 60 * 1000;

type Product = { partNumber?: string; quantity?: number; price?: number };
type PurchaseOrder = { poNumber?: string; poDate?: string; products?: Product[] };

const ORDER_QUERY = `query RecentDropshipOrders($fromDate: IsoDateTime!) {
  getDropshipPurchaseOrders(limit: 2000, fromDate: $fromDate, sortOrder: DESC) {
    poNumber
    poDate
    products { partNumber quantity price }
  }
}`;

async function bindings() {
  return (await import("cloudflare:workers")).env;
}

function assertDate(value: string | null, name: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} 必须是 YYYY-MM-DD`);
  }
  return value;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoFromDate(value: string) {
  return `${value}T00:00:00+08:00`;
}

async function accessToken() {
  const env = await bindings();
  const clientId = env.WAYFAIR_OPS_CLIENT_ID;
  const clientSecret = env.WAYFAIR_OPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Ops API 凭证未配置");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: "https://api.wayfair.com/",
    }),
  });
  if (!response.ok) throw new Error(`Ops API OAuth 失败（HTTP ${response.status}）`);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Ops API OAuth 缺少 access_token");
  return body.access_token;
}

async function fetchOrders(fromDate: string) {
  const token = await accessToken();
  const response = await fetch(ORDER_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: ORDER_QUERY, variables: { fromDate: isoFromDate(fromDate) } }),
  });
  if (!response.ok) throw new Error(`订单 API 请求失败（HTTP ${response.status}）`);
  const body = await response.json() as { data?: { getDropshipPurchaseOrders?: PurchaseOrder[] }; errors?: { message?: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((item) => item.message || "订单 API GraphQL 错误").join("；"));
  return body.data?.getDropshipPurchaseOrders || [];
}

async function syncOrders(force = false) {
  const env = await bindings();
  const db = env.DB;
  if (!db) throw new Error("订单缓存数据库未配置");
  const state = await db.prepare("SELECT value, updated_at FROM sync_state WHERE key = ?").bind("orders").first<{ value: string; updated_at: string }>();
  const lastSync = state?.updated_at ? Date.parse(state.updated_at) : 0;
  if (!force && lastSync && Date.now() - lastSync < FRESH_MS) return { refreshed: false, syncedAt: state?.updated_at };
  const latest = await db.prepare("SELECT MAX(po_date) AS max_date, COUNT(*) AS count FROM orders").first<{ max_date: string | null; count: number }>();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const fromDate = latest?.count && latest.max_date ? addDays(String(latest.max_date).slice(0, 10), -2) : addDays(today, -PRELOAD_DAYS);
  const orders = await fetchOrders(fromDate);
  const now = new Date().toISOString();
  for (const order of orders) {
    if (!order.poNumber || !order.poDate) continue;
    const products = (order.products || []).filter((item) => item.partNumber);
    const revenueCents = products.reduce((sum, item) => sum + Math.round(Number(item.price || 0) * 100) * Number(item.quantity || 0), 0);
    const units = products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const statements = [
      db.prepare("INSERT INTO orders(po_number,po_date,revenue_cents,units,item_count,synced_at) VALUES(?,?,?,?,?,?) ON CONFLICT(po_number) DO UPDATE SET po_date=excluded.po_date,revenue_cents=excluded.revenue_cents,units=excluded.units,item_count=excluded.item_count,synced_at=excluded.synced_at").bind(order.poNumber, order.poDate, revenueCents, units, products.length, now),
      db.prepare("DELETE FROM order_items WHERE po_number = ?").bind(order.poNumber),
      ...products.map((item, index) => db.prepare("INSERT INTO order_items(po_number,line_key,part_number,quantity,unit_price_cents) VALUES(?,?,?,?,?)").bind(order.poNumber, `${item.partNumber}:${index}`, item.partNumber, Number(item.quantity || 0), Math.round(Number(item.price || 0) * 100))),
    ];
    await db.batch(statements);
  }
  await db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind("orders", JSON.stringify({ fromDate, fetched: orders.length }), now).run();
  return { refreshed: true, syncedAt: now, fetched: orders.length };
}

async function metrics(start: string, end: string) {
  const env = await bindings();
  const db = env.DB;
  const endExclusive = addDays(end, 1);
  const row = await db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(revenue_cents),0) AS revenue_cents, COALESCE(SUM(units),0) AS units FROM orders WHERE datetime(po_date) >= datetime(?) AND datetime(po_date) < datetime(?)`).bind(isoFromDate(start), isoFromDate(endExclusive)).first<{ orders: number; revenue_cents: number; units: number }>();
  const profit = await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN c.unit_cost_cents IS NOT NULL THEN (i.unit_price_cents-c.unit_cost_cents)*i.quantity ELSE 0 END),0) AS known_profit_cents,
    COALESCE(SUM(CASE WHEN c.unit_cost_cents IS NULL THEN i.unit_price_cents*i.quantity ELSE 0 END),0) AS unknown_revenue_cents,
    COALESCE(SUM(i.unit_price_cents*i.quantity),0) AS item_revenue_cents
    FROM order_items i JOIN orders o ON o.po_number=i.po_number LEFT JOIN sku_costs c ON c.part_number=i.part_number
    WHERE datetime(o.po_date) >= datetime(?) AND datetime(o.po_date) < datetime(?)`).bind(isoFromDate(start), isoFromDate(endExclusive)).first<{ known_profit_cents: number; unknown_revenue_cents: number; item_revenue_cents: number }>();
  const estimatedProfitCents = Number(profit?.known_profit_cents || 0) + Math.round(Number(profit?.unknown_revenue_cents || 0) * DEFAULT_MARGIN_RATE);
  const advertising = await cachedAdSpend(db, start, end);
  const advertisingBeforeGrossProfit = estimatedProfitCents / 100;
  const contributionAfterAds = advertising.spend === null ? null : Number((advertisingBeforeGrossProfit - advertising.spend).toFixed(2));
  return {
    orders: Number(row?.orders || 0),
    revenue: Number(row?.revenue_cents || 0) / 100,
    units: Number(row?.units || 0),
    aov: Number(row?.orders || 0) ? Number(row?.revenue_cents || 0) / 100 / Number(row?.orders || 0) : 0,
    advertisingBeforeGrossProfit,
    contributionAfterAds,
    advertisingSpend: advertising.spend,
    advertisingCoverage: advertising.coverage,
    profitMode: Number(profit?.unknown_revenue_cents || 0) > 0 ? "estimated" : "cost-covered",
    costCoverage: Number(profit?.item_revenue_cents || 0) ? 1 - Number(profit?.unknown_revenue_cents || 0) / Number(profit?.item_revenue_cents || 0) : 0,
    marginRate: DEFAULT_MARGIN_RATE,
  };
}

export async function GET(request: Request) {
  try {
    const env = await bindings();
    const url = new URL(request.url);
    const start = assertDate(url.searchParams.get("start"), "start");
    const end = assertDate(url.searchParams.get("end"), "end");
    const span = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
    if (span < 1 || span > 366) return Response.json({ error: "日期范围需在 1–366 天内" }, { status: 400 });
    let sync: { refreshed?: boolean; syncedAt?: string; fetched?: number; stale?: boolean; error?: string };
    try { sync = await syncOrders(url.searchParams.get("refresh") === "1"); }
    catch (error) {
      const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first<{ count: number }>();
      if (!count?.count) throw error;
      sync = { stale: true, error: error instanceof Error ? error.message : "订单同步失败" };
    }
    const current = await metrics(start, end);
    const previousEnd = addDays(start, -1);
    const previousStart = addDays(previousEnd, -(span - 1));
    const previous = await metrics(previousStart, previousEnd);
    const endExclusive = addDays(end, 1);
    const daily = await env.DB.prepare(`SELECT date(po_date,'+8 hours') AS date, COUNT(*) AS orders, SUM(revenue_cents)/100.0 AS revenue, SUM(units) AS units FROM orders WHERE datetime(po_date) >= datetime(?) AND datetime(po_date) < datetime(?) GROUP BY date(po_date,'+8 hours') ORDER BY date`).bind(isoFromDate(start), isoFromDate(endExclusive)).all();
    const topSkus = await env.DB.prepare(`SELECT i.part_number AS partNumber, SUM(i.quantity) AS units, SUM(i.unit_price_cents*i.quantity)/100.0 AS revenue FROM order_items i JOIN orders o ON o.po_number=i.po_number WHERE datetime(o.po_date) >= datetime(?) AND datetime(o.po_date) < datetime(?) GROUP BY i.part_number ORDER BY revenue DESC LIMIT 8`).bind(isoFromDate(start), isoFromDate(endExclusive)).all();
    return Response.json({ source: "Wayfair Orders API", range: { start, end, previousStart, previousEnd }, current, previous, daily: daily.results, topSkus: topSkus.results, sync });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "订单数据读取失败" }, { status: 500 });
  }
}
