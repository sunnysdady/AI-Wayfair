/**
 * TACOS line + loss guard for the advertising pages (advisory only).
 * Combines: ad spend (Advertising API ledger), total sales (orders table),
 * attributed WSC (listing report) and SKU cost (sku_costs).
 * See ads-profit-rules.mjs for the rule and the field provenance.
 */
import { lingxingDayStart } from "./lingxing-business-time.mjs";
import { addDays } from "./ads-report-source.mjs";
import {
  DEFAULT_MARGIN_RATE, TACOS_LINE, buildLossBuckets, lossAlerts, tacosAssessment,
} from "./ads-profit-rules.mjs";

const toDollars = (cents) => Number(cents || 0) / 100;

export async function loadSkuCostMap(db) {
  const result = new Map();
  try {
    const rows = await db.prepare("SELECT part_number,unit_cost_cents,currency,currency_certified_at,currency_certification_source,updated_at FROM sku_costs").all();
    for (const row of rows.results || []) {
      result.set(String(row.part_number), {
        unitCostCents: Number(row.unit_cost_cents || 0),
        currency: String(row.currency || "").toUpperCase(),
        currencyCertifiedAt: String(row.currency_certified_at || ""),
        currencyCertificationSource: String(row.currency_certification_source || ""),
        updatedAt: String(row.updated_at || ""),
      });
    }
  } catch { /* no cost evidence → estimates stay labelled ESTIMATE */ }
  return result;
}

/** Orders-side numbers for [start, end], same definitions as /api/orders/summary. */
export async function loadSalesContext(db, start, end) {
  const from = lingxingDayStart(start);
  const to = lingxingDayStart(addDays(end, 1));
  const totals = await db.prepare("SELECT COUNT(*) AS orders, COALESCE(SUM(revenue_cents),0) AS revenue_cents FROM orders WHERE po_date >= ? AND po_date < ? AND revenue_cents > 0")
    .bind(from, to).first();
  const profit = await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN c.unit_cost_cents IS NOT NULL THEN (i.unit_price_cents-c.unit_cost_cents)*i.quantity ELSE 0 END),0) AS known_profit_cents,
    COALESCE(SUM(CASE WHEN c.unit_cost_cents IS NULL THEN i.unit_price_cents*i.quantity ELSE 0 END),0) AS unknown_revenue_cents,
    COALESCE(SUM(i.unit_price_cents*i.quantity),0) AS item_revenue_cents
    FROM order_items i JOIN orders o ON o.po_number=i.po_number LEFT JOIN sku_costs c ON c.part_number=i.part_number
    WHERE o.po_date >= ? AND o.po_date < ?`).bind(from, to).first();
  const parts = await db.prepare("SELECT i.part_number AS part_number, SUM(i.unit_price_cents*i.quantity) AS revenue_cents FROM order_items i JOIN orders o ON o.po_number=i.po_number WHERE o.po_date >= ? AND o.po_date < ? AND o.revenue_cents > 0 GROUP BY i.part_number")
    .bind(from, to).all();
  const knownProfit = toDollars(profit?.known_profit_cents);
  const unknownRevenue = toDollars(profit?.unknown_revenue_cents);
  const itemRevenue = toDollars(profit?.item_revenue_cents);
  return {
    orders: Number(totals?.orders || 0),
    totalSales: toDollars(totals?.revenue_cents),
    orderProfit: {
      estimated: knownProfit + unknownRevenue * DEFAULT_MARGIN_RATE,
      costCoverage: itemRevenue ? 1 - unknownRevenue / itemRevenue : 0,
      basis: unknownRevenue > 0 ? "ESTIMATE" : "SKU_COST",
    },
    partRevenue: new Map((parts.results || []).map((row) => [String(row.part_number), toDollars(row.revenue_cents)])),
  };
}

export async function loadListingReportRows(db, start, end) {
  const stored = await db.prepare("SELECT payload FROM ad_report_rows WHERE report_type='LISTING_REPORT' AND report_date>=? AND report_date<=?").bind(start, end).all();
  return (stored.results || []).map((row) => JSON.parse(row.payload));
}

/** listing → total order revenue over the window, via part numbers; shared parts are flagged. */
export function salesByListing(listingBuckets, partRevenue) {
  const partOwners = new Map();
  for (const row of listingBuckets) for (const part of row.parts) partOwners.set(part, (partOwners.get(part) || 0) + 1);
  const sales = new Map();
  const shared = new Set();
  for (const row of listingBuckets) {
    if (!row.parts.length) continue;
    let sum = 0;
    for (const part of row.parts) {
      sum += partRevenue.get(part) || 0;
      if ((partOwners.get(part) || 0) > 1) shared.add(row.listing);
    }
    sales.set(row.listing, Number(sum.toFixed(2)));
  }
  return { sales, shared };
}

/**
 * @param {object} input
 * @param {{start:string,end:string}} input.range
 * @param {{spend:number|null, coverage?:string}} input.adSpend
 * @param {Awaited<ReturnType<typeof loadSalesContext>>} input.sales
 * @param {Record<string,string>[]} input.listingRows
 * @param {Map<string, object>} input.costByPart
 */
export function buildTacosGuard({ range, adSpend, sales, listingRows, costByPart }) {
  const coverage = adSpend.coverage || "FULL";
  const account = tacosAssessment({ spend: adSpend.spend, totalSales: sales.totalSales, coverage });
  const orderContribution = adSpend.spend === null || adSpend.spend === undefined
    ? null
    : Number((sales.orderProfit.estimated - adSpend.spend).toFixed(2));
  const buckets = buildLossBuckets({ rows: listingRows, start: range.start, end: range.end, costByPart });
  const { sales: listingSales, shared } = salesByListing(buckets.listings, sales.partRevenue);
  const listings = buckets.listings.map((row) => {
    const total = listingSales.get(row.listing);
    const t = total === undefined ? null : tacosAssessment({ spend: row.spend, totalSales: total, coverage });
    return { ...row, totalSales: total ?? null, tacos: t?.tacos ?? null, tacosStatus: t?.status ?? "UNKNOWN", budgetAdvice: t?.budgetAdvice ?? "UNKNOWN", sharedParts: shared.has(row.listing) };
  });
  const notes = [
    "TACOS = 广告花费 ÷ 订单总销售额（orders 表，与经营总览同口径）；10% 线以内可不设预算上限，仅为建议，系统不会自动改预算或出价。",
    "利润贡献（活动/SKU/关键词）= 归因批发额 WSC − 归因件数×SKU 成本 − 广告花费；SKU 成本未覆盖时按店铺毛利 28.26% 估算并标“估算”。",
    "归因窗口 14 天：最近 14 天内的订单归因可能还会增加，亏损提示可能随之收窄。",
  ];
  if (coverage !== "FULL") notes.push(`广告花费数据覆盖为 ${coverage}，TACOS 可能被低估。`);
  if (listings.some((row) => row.sharedParts)) notes.push("部分 Listing 共用同一 Part，Listing 级 TACOS 的总销售额可能重复计入。");
  return {
    line: TACOS_LINE,
    range,
    account: {
      ...account,
      orders: sales.orders,
      contributionAfterAds: orderContribution,
      contributionBasis: sales.orderProfit.basis,
      costCoverage: Number(sales.orderProfit.costCoverage.toFixed(4)),
      loss: orderContribution !== null && orderContribution < 0,
    },
    campaigns: buckets.campaigns,
    listings,
    alerts: lossAlerts({ campaigns: buckets.campaigns, listings: buckets.listings }),
    notes,
  };
}
