/**
 * Read-side analytics for KEYWORD_PRODUCT_REPORT and PRODUCT_RANK_REPORT.
 * Pure functions over stored raw rows; every output is an *advisory* label.
 * Nothing in here, or in the routes that call it, writes a bid.
 */
import { normalizeKeywordRow, normalizeRankRow } from "./ads-report-source.mjs";
import { contributionAfterAds, tacosAssessment, TACOS_LINE, MIN_SPEND_FOR_LOSS_FLAG } from "./ads-profit-rules.mjs";

const MIN_CLICKS_FOR_ADVICE = 20;
const MIN_SPEND_FOR_ADVICE = 10;
const ZERO_ORDER_SPEND = 15;

const round = (value, digits = 2) => (value === null || value === undefined ? null : Number(value.toFixed(digits)));

export const ADVICE_LABELS = Object.freeze({
  OBSERVE: "样本不足，继续观察",
  WATCH: "归因未满14天，先观察",
  KEEP_HIGH: "盈利且回报高，建议保留",
  KEEP: "盈利，建议保留",
  LOWER_OR_DROP: "有花费无订单，建议降价或剔除",
  LOSS_CONFIRMED: "扣广告后亏损，建议降价或剔除",
  LOSS_SUSPECTED: "疑似亏损（成本为估算），请核对成本后处理",
  UNKNOWN: "缺少归因批发额，无法判断盈亏",
});

function keywordAdvice({ spend, clicks, orders, contribution, loss, suspectedLoss }, mature) {
  const sample = spend >= MIN_SPEND_FOR_ADVICE || clicks >= MIN_CLICKS_FOR_ADVICE;
  if (!sample) return "OBSERVE";
  const zeroOrders = orders === 0 && spend >= ZERO_ORDER_SPEND && clicks >= MIN_CLICKS_FOR_ADVICE;
  const lossish = zeroOrders || loss || suspectedLoss;
  if (lossish && !mature) return "WATCH";
  if (zeroOrders) return "LOWER_OR_DROP";
  if (loss) return "LOSS_CONFIRMED";
  if (suspectedLoss) return "LOSS_SUSPECTED";
  if (contribution === null) return "UNKNOWN";
  if (orders >= 2 && contribution >= spend) return "KEEP_HIGH";
  return orders >= 1 ? "KEEP" : "OBSERVE";
}

/**
 * @param {object} input
 * @param {Record<string,string>[]} input.rows raw stored rows
 * @param {string} input.start inclusive YYYY-MM-DD
 * @param {string} input.end inclusive YYYY-MM-DD
 * @param {Map<string, object>} [input.costByPart] sku_costs by part number
 * @param {Map<string, string[]>} [input.listingParts] listing → part numbers (from the listing report)
 * @param {string} [input.matureThrough] last date whose 14-day attribution is closed
 */
export function aggregateKeywords({ rows, start, end, costByPart = new Map(), listingParts = new Map(), matureThrough = "" }) {
  const groups = new Map();
  const unmapped = new Set();
  let used = 0;
  let wscSeen = 0;
  let noDate = 0;
  for (const raw of rows) {
    const n = normalizeKeywordRow(raw);
    if (!n.date) { noDate += 1; continue; }
    if (n.date < start || n.date > end) continue;
    used += 1;
    for (const column of n.unmapped) unmapped.add(column);
    const key = [n.campaignId, n.sku, n.keyword.toLowerCase(), n.matchType.toLowerCase()].join("\u0001");
    if (!groups.has(key)) {
      groups.set(key, {
        campaignId: n.campaignId, campaignName: n.campaignName, sku: n.sku, productName: n.productName, className: n.className,
        keyword: n.keyword, matchType: n.matchType, maxBid: n.maxBid,
        impressions: 0, clicks: 0, spend: 0, orders: 0, units: 0, retail: 0, wsc: 0, wscRows: 0, rows: 0,
        parts: new Set(), lastDate: n.date,
      });
    }
    const g = groups.get(key);
    g.rows += 1;
    for (const field of ["impressions", "clicks", "spend", "orders", "units", "retail"]) g[field] += n[field] ?? 0;
    if (n.wsc !== null) { g.wsc += n.wsc; g.wscRows += 1; wscSeen += 1; }
    for (const part of n.parts.length ? n.parts : listingParts.get(n.sku) || []) g.parts.add(part);
    if (n.date >= g.lastDate) { g.lastDate = n.date; if (n.maxBid !== null) g.maxBid = n.maxBid; }
  }
  const mature = Boolean(matureThrough) && end <= matureThrough;
  const out = [];
  for (const g of groups.values()) {
    const parts = [...g.parts];
    const wscKnown = g.wscRows === g.rows && g.rows > 0;
    const econ = wscKnown
      ? contributionAfterAds({ wsc: g.wsc, units: g.units, spend: g.spend, parts, costByPart })
      : { contribution: null, basis: "UNKNOWN", loss: false, suspectedLoss: false, reason: "报表缺少批发额（WSC）列，不估算利润" };
    const adviceCode = keywordAdvice({ spend: g.spend, clicks: g.clicks, orders: g.orders, ...econ }, mature);
    out.push({
      campaignId: g.campaignId, campaignName: g.campaignName, sku: g.sku, productName: g.productName, className: g.className,
      keyword: g.keyword, matchType: g.matchType, maxBid: g.maxBid,
      impressions: Math.round(g.impressions), clicks: Math.round(g.clicks), spend: round(g.spend), orders: Math.round(g.orders), units: Math.round(g.units),
      retail: round(g.retail), wsc: wscKnown ? round(g.wsc) : null,
      ctr: g.impressions ? round(g.clicks / g.impressions, 4) : 0,
      cvr: g.clicks ? round(g.orders / g.clicks, 4) : 0,
      cpc: g.clicks ? round(g.spend / g.clicks) : 0,
      retailRoas: g.spend ? round(g.retail / g.spend) : 0,
      wscRoas: wscKnown && g.spend ? round(g.wsc / g.spend) : null,
      contribution: econ.contribution, contributionBasis: econ.basis, loss: econ.loss, suspectedLoss: econ.suspectedLoss,
      advice: { code: adviceCode, label: ADVICE_LABELS[adviceCode] },
    });
  }
  const severity = (row) => (row.loss ? 0 : row.suspectedLoss ? 1 : 2);
  out.sort((a, b) => severity(a) - severity(b) || b.spend - a.spend);
  const totalSpend = out.reduce((sum, row) => sum + row.spend, 0);
  const knownContribution = out.filter((row) => row.contribution !== null);
  return {
    rows: out,
    summary: {
      keywords: out.length,
      spend: round(totalSpend),
      orders: out.reduce((sum, row) => sum + row.orders, 0),
      lossCount: out.filter((row) => row.loss).length,
      suspectedLossCount: out.filter((row) => row.suspectedLoss).length,
      contribution: knownContribution.length ? round(knownContribution.reduce((sum, row) => sum + row.contribution, 0)) : null,
      contributionCoverage: out.length ? round(knownContribution.length / out.length, 2) : 0,
      mature,
      matureThrough: matureThrough || null,
    },
    quality: { rowsUsed: used, rowsWithoutDate: noDate, wscColumnPresent: wscSeen > 0, unmappedColumns: [...unmapped].sort() },
  };
}

function rankTier(rank, classSize) {
  if (rank === null || !classSize) return "UNKNOWN";
  const relative = rank / classSize;
  return relative <= 0.2 ? "LEAD" : relative > 0.6 ? "TRAIL" : "MID";
}

export const RANK_ADVICE_LABELS = Object.freeze({
  INVEST: "领先且扣广告后盈利，可考虑加投",
  REDUCE: "落后且扣广告后亏损，建议控制投入",
  OPTIMIZE_LISTING: "落后但仍盈利，先优化 Listing 再加投",
  HOLD: "维持现状",
  UNKNOWN: "排名或盈亏数据不足，无法给出建议",
});

/**
 * @param {Map<string, {spend:number, wsc:number, contribution:number|null, basis:string, loss:boolean, suspectedLoss:boolean, tacos?:number|null}>} [input.listingEconomics]
 */
export function aggregateRank({ rows, start, end, listingEconomics = new Map() }) {
  const bySku = new Map();
  const unmapped = new Set();
  let used = 0;
  let missing = 0;
  let noDate = 0;
  for (const raw of rows) {
    const n = normalizeRankRow(raw);
    if (!n.date) { noDate += 1; continue; }
    if (n.date < start || n.date > end) continue;
    used += 1;
    if (n.rankMissing) missing += 1;
    for (const column of n.unmapped) unmapped.add(column);
    const key = n.sku || "unknown";
    if (!bySku.has(key)) bySku.set(key, []);
    bySku.get(key).push(n);
  }
  const out = [];
  for (const [sku, list] of bySku) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const withRank = list.filter((item) => item.rank !== null);
    const first = withRank[0] || null;
    const last = withRank.at(-1) || null;
    const latest = list.at(-1);
    const classSize = last?.classSize ?? latest.classSize ?? null;
    const tier = rankTier(last?.rank ?? null, classSize);
    const econ = listingEconomics.get(sku) || null;
    let code = "UNKNOWN";
    if (tier !== "UNKNOWN" && econ && econ.contribution !== null) {
      const losing = econ.contribution < 0 && (econ.loss || econ.suspectedLoss);
      const overLine = econ.tacos !== null && econ.tacos !== undefined && econ.tacos > TACOS_LINE;
      if (tier === "TRAIL" && losing) code = "REDUCE";
      else if (tier === "TRAIL") code = "OPTIMIZE_LISTING";
      else if (tier === "LEAD" && !losing && !overLine) code = "INVEST";
      else code = "HOLD";
    }
    out.push({
      sku, productName: latest.productName, className: latest.className,
      latestDate: latest.date, rank: last?.rank ?? null, classSize, tier,
      rankChange: first && last && first !== last ? first.rank - last.rank : null, // positive = moved up
      percentile: last?.percentile ?? latest.percentile ?? null,
      sales: latest.sales,
      adSpend: econ ? econ.spend : null,
      wsc: econ ? econ.wsc : null,
      contribution: econ ? econ.contribution : null,
      contributionBasis: econ ? econ.basis : "UNKNOWN",
      loss: Boolean(econ?.loss), suspectedLoss: Boolean(econ?.suspectedLoss),
      tacos: econ?.tacos ?? null,
      advice: { code, label: RANK_ADVICE_LABELS[code] },
    });
  }
  const tierOrder = { TRAIL: 0, MID: 1, LEAD: 2, UNKNOWN: 3 };
  out.sort((a, b) => Number(b.loss) - Number(a.loss) || tierOrder[a.tier] - tierOrder[b.tier] || (a.rank ?? 1e9) - (b.rank ?? 1e9));
  return {
    rows: out,
    summary: {
      products: out.length,
      lead: out.filter((row) => row.tier === "LEAD").length,
      trail: out.filter((row) => row.tier === "TRAIL").length,
      lossCount: out.filter((row) => row.loss).length,
    },
    quality: { rowsUsed: used, rowsWithoutDate: noDate, rowsWithoutRank: missing, unmappedColumns: [...unmapped].sort() },
  };
}

/** Per-listing economics + TACOS for the rank join, from listing buckets and order sales. */
export function listingEconomicsMap(listingBuckets, salesByListing = new Map(), coverage = "FULL") {
  const map = new Map();
  for (const row of listingBuckets) {
    const sales = salesByListing.get(row.listing);
    const t = sales === undefined ? null : tacosAssessment({ spend: row.spend, totalSales: sales, coverage });
    map.set(row.listing, { spend: row.spend, wsc: row.wsc, contribution: row.contribution, basis: row.basis, loss: row.loss, suspectedLoss: row.suspectedLoss, tacos: t?.tacos ?? null });
  }
  return map;
}

export { MIN_SPEND_FOR_LOSS_FLAG };
