/**
 * Sunny's advertising rule (2026-10-16), advisory only — nothing here writes
 * a bid, budget or campaign state:
 *
 *   1. TACOS = ad spend / total sales. At or below 10% there is no budget cap.
 *   2. Even under the line, flag anything whose contribution AFTER ads is
 *      negative so a loss is raised in time.
 *
 * Money fields and where they come from:
 *   - spend            Advertising API report `spend_USD`
 *   - attributed WSC   Advertising API `attributed_wholesale_cost_..._USD_Day_14`
 *                      (wholesale cost Wayfair pays us for the attributed units)
 *   - unit cost        `sku_costs.unit_cost_cents` (USD-certified rows only)
 *   - contribution     WSC − units × unit cost − spend  (same basis the existing
 *                      contribution model uses before ads, minus spend)
 * If SKU cost is not covered the store margin (28.26%, the value already used by
 * /api/orders/summary) estimates it and the result is labelled ESTIMATE; if WSC
 * itself is missing nothing is invented and contribution stays null.
 */

export const TACOS_LINE = 0.1;
export const DEFAULT_MARGIN_RATE = 0.2826;
/** Below this spend a negative number is noise, not a loss worth an alert. */
export const MIN_SPEND_FOR_LOSS_FLAG = 5;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * @param {{spend: number|null, totalSales: number|null, coverage?: string}} input
 * `coverage` is the ad-spend ledger state (FULL | PARTIAL | PENDING | ...).
 */
export function tacosAssessment({ spend, totalSales, coverage = "FULL" } = {}) {
  const s = finite(spend);
  const t = finite(totalSales);
  const base = { line: TACOS_LINE, spend: s === null ? null : money(s), totalSales: t === null ? null : money(t), coverage };
  if (s === null) return { ...base, tacos: null, status: "UNKNOWN", budgetAdvice: "UNKNOWN", reason: "广告花费未同步，无法计算 TACOS" };
  if (t === null || t <= 0) {
    return { ...base, tacos: null, status: s > 0 ? "NO_SALES" : "UNKNOWN", budgetAdvice: s > 0 ? "KEEP_CAP" : "UNKNOWN", reason: "周期内没有总销售额，无法计算 TACOS" };
  }
  const tacos = s / t;
  const partial = coverage !== "FULL";
  const within = tacos <= TACOS_LINE;
  return {
    ...base,
    tacos: Number(tacos.toFixed(4)),
    status: within ? "WITHIN_LINE" : "OVER_LINE",
    budgetAdvice: within ? "NO_CAP" : "KEEP_CAP",
    reason: within
      ? `TACOS ${(tacos * 100).toFixed(1)}% ≤ ${(TACOS_LINE * 100).toFixed(0)}%，按规则可不设预算上限${partial ? "（广告花费仅部分覆盖，实际 TACOS 可能更高）" : ""}`
      : `TACOS ${(tacos * 100).toFixed(1)}% > ${(TACOS_LINE * 100).toFixed(0)}%，保留预算上限`,
    partial,
  };
}

function costedPart(cost) {
  return Boolean(cost)
    && finite(cost.unitCostCents) !== null && finite(cost.unitCostCents) > 0
    && String(cost.currency || "").toUpperCase() === "USD"
    && String(cost.currencyCertifiedAt || "").trim().length > 0
    && String(cost.currencyCertificationSource || "").trim().length > 0;
}

/**
 * Contribution after ads for one attributed bucket (keyword, campaign, listing).
 * @returns {{contribution: number|null, basis: "SKU_COST"|"NO_SALES"|"ESTIMATE"|"UNKNOWN", loss: boolean, suspectedLoss: boolean, reason: string}}
 */
export function contributionAfterAds({ wsc, units, spend, parts = [], costByPart = new Map(), marginRate = DEFAULT_MARGIN_RATE } = {}) {
  const w = finite(wsc);
  const u = finite(units);
  const s = finite(spend) ?? 0;
  if (w === null || w <= 0) {
    // No attributed sales: cost of the ads is a pure loss only if we really spent.
    if (w === 0 && s > 0) {
      const contribution = money(-s);
      const flag = s >= MIN_SPEND_FOR_LOSS_FLAG;
      return { contribution, basis: "NO_SALES", loss: flag, suspectedLoss: false, reason: "有花费无归因销售" };
    }
    return { contribution: null, basis: "UNKNOWN", loss: false, suspectedLoss: false, reason: "缺少归因批发额（WSC），不估算利润" };
  }
  const costs = parts.map((part) => costByPart.get(part));
  const covered = parts.length > 0 && costs.every(costedPart) && u !== null && u > 0;
  let contribution;
  let basis;
  if (covered) {
    const unitCost = Math.max(...costs.map((cost) => Number(cost.unitCostCents))) / 100; // conservative, as in ad-contribution-economics
    contribution = w - u * unitCost - s;
    basis = "SKU_COST";
  } else {
    contribution = w * marginRate - s;
    basis = "ESTIMATE";
  }
  contribution = money(contribution);
  const negative = contribution < 0 && s >= MIN_SPEND_FOR_LOSS_FLAG;
  return {
    contribution,
    basis,
    loss: negative && basis === "SKU_COST",
    suspectedLoss: negative && basis === "ESTIMATE",
    reason: basis === "SKU_COST" ? "WSC − 件数×SKU成本 − 广告花费" : `SKU 成本未覆盖，按店铺毛利 ${(marginRate * 100).toFixed(2)}% 估算`,
  };
}

/**
 * Group listing-report rows (raw CSV rows) into campaign / listing buckets and
 * mark the ones whose contribution after ads is negative.
 * @param {{rows: Record<string,string>[], start: string, end: string, costByPart?: Map<string, object>}} input
 */
export function buildLossBuckets({ rows, start, end, costByPart = new Map() }) {
  const num = (row, key) => finite(row[key]) ?? 0;
  const bucket = (map, key, seed) => {
    if (!map.has(key)) map.set(key, { ...seed, spend: 0, wsc: 0, units: 0, orders: 0, parts: new Set() });
    return map.get(key);
  };
  const campaigns = new Map();
  const listings = new Map();
  for (const row of rows) {
    const date = String(row.Date || "").slice(0, 10);
    if (date < start || date > end) continue;
    const parts = String(row.first_10_part_numbers || "").split(",").map((part) => part.trim()).filter(Boolean);
    const fields = {
      spend: num(row, "spend_USD"),
      wsc: num(row, "attributed_wholesale_cost_window_view_through_USD_Day_14"),
      units: num(row, "attributed_units_window_view_through_Day_14"),
      orders: num(row, "attributed_orders_window_view_through_Day_14"),
    };
    const campaignId = String(row.campaign_id || "unknown");
    const listing = String(row.listing || "unknown");
    for (const target of [
      bucket(campaigns, campaignId, { campaignId, campaignName: row.campaign_name || "" }),
      bucket(listings, listing, { listing, productName: row.product_name || "" }),
    ]) {
      for (const [key, value] of Object.entries(fields)) target[key] += value;
      for (const part of parts) target.parts.add(part);
    }
  }
  // A campaign spans several listings with different costs: compute campaign
  // contribution per (campaign, listing) pair so unit costs are not mixed.
  const pairs = new Map();
  for (const row of rows) {
    const date = String(row.Date || "").slice(0, 10);
    if (date < start || date > end) continue;
    const campaignId = String(row.campaign_id || "unknown");
    const listing = String(row.listing || "unknown");
    const pair = bucket(pairs, `${campaignId}::${listing}`, { campaignId, listing });
    pair.spend += num(row, "spend_USD");
    pair.wsc += num(row, "attributed_wholesale_cost_window_view_through_USD_Day_14");
    pair.units += num(row, "attributed_units_window_view_through_Day_14");
    pair.orders += num(row, "attributed_orders_window_view_through_Day_14");
    for (const part of String(row.first_10_part_numbers || "").split(",").map((p) => p.trim()).filter(Boolean)) pair.parts.add(part);
  }
  const pairResult = [...pairs.values()].map((pair) => ({
    ...pair,
    parts: [...pair.parts],
    ...contributionAfterAds({ wsc: pair.wsc, units: pair.units, spend: pair.spend, parts: [...pair.parts], costByPart }),
  }));
  const campaignResult = [...campaigns.values()].map((campaign) => {
    const members = pairResult.filter((pair) => pair.campaignId === campaign.campaignId);
    const known = members.filter((pair) => pair.contribution !== null);
    const contribution = known.length ? money(known.reduce((sum, pair) => sum + pair.contribution, 0)) : null;
    const basis = !known.length ? "UNKNOWN" : members.every((pair) => pair.basis === "SKU_COST" || pair.basis === "NO_SALES") ? "SKU_COST" : "ESTIMATE";
    const loss = members.some((pair) => pair.loss) && contribution !== null && contribution < 0;
    const suspectedLoss = !loss && contribution !== null && contribution < 0 && campaign.spend >= MIN_SPEND_FOR_LOSS_FLAG;
    return { campaignId: campaign.campaignId, campaignName: campaign.campaignName, spend: money(campaign.spend), wsc: money(campaign.wsc), units: campaign.units, orders: campaign.orders, contribution, basis, loss, suspectedLoss };
  });
  const listingResult = [...listings.values()].map((listing) => {
    const parts = [...listing.parts];
    return {
      listing: listing.listing, productName: listing.productName, parts,
      spend: money(listing.spend), wsc: money(listing.wsc), units: listing.units, orders: listing.orders,
      ...contributionAfterAds({ wsc: listing.wsc, units: listing.units, spend: listing.spend, parts, costByPart }),
    };
  });
  const byContribution = (a, b) => (a.contribution ?? Infinity) - (b.contribution ?? Infinity);
  return {
    campaigns: campaignResult.sort(byContribution),
    listings: listingResult.sort(byContribution),
  };
}

/** Loss rows for the alert strip: SKU_COST losses first, then suspected ones. */
export function lossAlerts(buckets, limit = 10) {
  const rows = [
    ...buckets.listings.filter((row) => row.loss || row.suspectedLoss).map((row) => ({ level: "listing", id: row.listing, label: row.productName || row.listing, ...row })),
    ...buckets.campaigns.filter((row) => row.loss || row.suspectedLoss).map((row) => ({ level: "campaign", id: row.campaignId, label: row.campaignName || `Campaign ${row.campaignId}`, ...row })),
  ];
  return rows
    .sort((a, b) => Number(Boolean(b.loss)) - Number(Boolean(a.loss)) || a.contribution - b.contribution)
    .slice(0, limit)
    .map((row) => ({
      level: row.level, id: row.id, label: row.label, spend: row.spend, wsc: row.wsc, contribution: row.contribution,
      basis: row.basis, confirmed: Boolean(row.loss),
    }));
}
