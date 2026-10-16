import assert from "node:assert/strict";
import test from "node:test";

import { buildTacosGuard, loadSalesContext, loadSkuCostMap, salesByListing } from "../lib/ads-tacos-guard.mjs";
import { buildExtendedView, resolveRange } from "../lib/ads-keyword-rank-service.mjs";
import { createFakeAdDb } from "./helpers-fake-ad-db.mjs";

const cost = (cents) => ({ unitCostCents: cents, currency: "USD", currencyCertifiedAt: "2026-09-01", currencyCertificationSource: "ops", updatedAt: "2026-10-01" });
const sales = (over = {}) => ({ orders: 10, totalSales: 1000, orderProfit: { estimated: 300, costCoverage: 1, basis: "SKU_COST" }, partRevenue: new Map([["P1", 600], ["P2", 400]]), ...over });
const listingRow = (over) => ({
  Date: "2026-10-01", campaign_id: "1", campaign_name: "Camp", listing: "L1", product_name: "Desk", first_10_part_numbers: "P1",
  spend_USD: "50", attributed_wholesale_cost_window_view_through_USD_Day_14: "300", attributed_units_window_view_through_Day_14: "3", attributed_orders_window_view_through_Day_14: "3", ...over,
});

test("account guard: 8% TACOS is under the line and says no cap; order contribution subtracts ad spend", () => {
  const guard = buildTacosGuard({ range: { start: "2026-10-01", end: "2026-10-01" }, adSpend: { spend: 80, coverage: "FULL" }, sales: sales(), listingRows: [], costByPart: new Map() });
  assert.equal(guard.account.tacos, 0.08);
  assert.equal(guard.account.budgetAdvice, "NO_CAP");
  assert.equal(guard.account.contributionAfterAds, 220);
  assert.equal(guard.account.loss, false);
});

test("an account under 10% TACOS can still be flagged when order profit does not cover ads", () => {
  const guard = buildTacosGuard({ range: { start: "2026-10-01", end: "2026-10-01" }, adSpend: { spend: 90, coverage: "FULL" }, sales: sales({ orderProfit: { estimated: 60, costCoverage: 0.5, basis: "ESTIMATE" } }), listingRows: [], costByPart: new Map() });
  assert.equal(guard.account.status, "WITHIN_LINE");
  assert.equal(guard.account.loss, true);
  assert.equal(guard.account.contributionAfterAds, -30);
  assert.equal(guard.account.contributionBasis, "ESTIMATE");
});

test("unsynced ad spend gives unknown TACOS and null contribution — never a fake zero", () => {
  const guard = buildTacosGuard({ range: { start: "2026-10-01", end: "2026-10-01" }, adSpend: { spend: null, coverage: "NOT_SYNCED" }, sales: sales(), listingRows: [], costByPart: new Map() });
  assert.equal(guard.account.status, "UNKNOWN");
  assert.equal(guard.account.contributionAfterAds, null);
  assert.equal(guard.account.loss, false);
});

test("listing level TACOS uses part revenue from orders; shared parts are flagged", () => {
  const rows = [listingRow({}), listingRow({ listing: "L2", first_10_part_numbers: "P1,P2", spend_USD: "10" })];
  const guard = buildTacosGuard({ range: { start: "2026-10-01", end: "2026-10-01" }, adSpend: { spend: 60, coverage: "FULL" }, sales: sales(), listingRows: rows, costByPart: new Map([["P1", cost(2000)], ["P2", cost(2000)]]) });
  const l1 = guard.listings.find((item) => item.listing === "L1");
  assert.equal(l1.totalSales, 600);
  assert.equal(l1.tacos, 0.0833);
  assert.equal(l1.sharedParts, true);
  assert.ok(guard.notes.some((note) => /共用同一 Part/.test(note)));
  const { sales: bySku } = salesByListing([{ listing: "X", parts: [] }], new Map());
  assert.equal(bySku.has("X"), false);
});

test("guard flags SKU/campaign losses with the cost source", () => {
  const rows = [listingRow({ attributed_wholesale_cost_window_view_through_USD_Day_14: "100", attributed_units_window_view_through_Day_14: "2", spend_USD: "60" })];
  const guard = buildTacosGuard({ range: { start: "2026-10-01", end: "2026-10-01" }, adSpend: { spend: 60, coverage: "FULL" }, sales: sales(), listingRows: rows, costByPart: new Map([["P1", cost(4000)]]) });
  assert.equal(guard.alerts.length, 2);
  assert.ok(guard.alerts.every((alert) => alert.confirmed && alert.basis === "SKU_COST" && alert.contribution === -40));
});

test("loadSalesContext applies the same business-day window and zero-revenue (sample) exclusion as the orders summary", async () => {
  const seen = [];
  const db = createFakeAdDb({
    extra: {
      "FROM orders WHERE po_date": (args, sql) => { seen.push(["orders", args, sql]); return { first: { orders: 2, revenue_cents: 25000 } }; },
      "LEFT JOIN sku_costs": (args, sql) => { seen.push(["profit", args, sql]); return { first: { known_profit_cents: 6000, unknown_revenue_cents: 10000, item_revenue_cents: 25000 } }; },
      "GROUP BY i.part_number": (args, sql) => { seen.push(["parts", args, sql]); return { results: [{ part_number: "P1", revenue_cents: 15000 }] }; },
    },
  });
  const context = await loadSalesContext(db, "2026-10-01", "2026-10-02");
  assert.equal(context.totalSales, 250);
  assert.equal(context.orders, 2);
  assert.equal(context.orderProfit.estimated, 60 + 100 * 0.2826);
  assert.equal(context.orderProfit.basis, "ESTIMATE");
  assert.equal(context.partRevenue.get("P1"), 150);
  assert.match(seen[0][2], /revenue_cents > 0/);
  assert.equal(seen[0][1][0] < seen[0][1][1], true);
});

test("loadSkuCostMap tolerates a missing cost table", async () => {
  const db = createFakeAdDb({ extra: { "FROM sku_costs": () => { throw new Error("no such table"); } } });
  assert.equal((await loadSkuCostMap(db)).size, 0);
});

test("range resolution defaults to the last 14 closed days and enforces 1–42 days", () => {
  assert.deepEqual(resolveRange({ today: "2026-10-16" }), { start: "2026-10-02", end: "2026-10-15" });
  assert.deepEqual(resolveRange({ today: "2026-10-16", days: "7" }), { start: "2026-10-09", end: "2026-10-15" });
  assert.throws(() => resolveRange({ today: "2026-10-16", days: 60 }), /1–42/);
  assert.throws(() => resolveRange({ start: "2026-10-05", end: "2026-10-01" }), /不能晚于/);
  assert.throws(() => resolveRange({ start: "bad", end: "2026-10-01" }), /YYYY-MM-DD/);
});

function viewDb() {
  return createFakeAdDb({
    extra: {
      "FROM sku_costs": () => ({ results: [{ part_number: "P1", unit_cost_cents: 4000, currency: "USD", currency_certified_at: "2026-09-01", currency_certification_source: "ops", updated_at: "2026-10-01" }] }),
      "FROM orders WHERE po_date": () => ({ first: { orders: 3, revenue_cents: 100000 } }),
      "LEFT JOIN sku_costs": () => ({ first: { known_profit_cents: 30000, unknown_revenue_cents: 0, item_revenue_cents: 100000 } }),
      "GROUP BY i.part_number": () => ({ results: [{ part_number: "P1", revenue_cents: 60000 }] }),
    },
  });
}

test("keyword view: reads stored rows only, never calls Wayfair without refresh, reports disabled flag", async () => {
  const db = viewDb();
  db.rows.push(
    { type: "KEYWORD_PRODUCT_REPORT", date: "2026-10-01", key: "a", refreshed: "x", payload: JSON.stringify({ Date: "2026-10-01", campaign_id: "1", listing: "L1", keyword: "desk", keyword_match_type: "EXACT", clicks: "30", spend_USD: "100", attributed_orders_window_view_through_Day_14: "1", attributed_units_window_view_through_Day_14: "1", attributed_wholesale_cost_window_view_through_USD_Day_14: "80" }) },
    { type: "LISTING_REPORT", date: "2026-10-01", key: "l", refreshed: "x", payload: JSON.stringify({ Date: "2026-10-01", campaign_id: "1", listing: "L1", first_10_part_numbers: "P1", spend_USD: "100", attributed_wholesale_cost_window_view_through_USD_Day_14: "80", attributed_units_window_view_through_Day_14: "1" }) },
  );
  const view = await buildExtendedView({ env: { DB: db }, kind: "keywords", start: "2026-10-01", end: "2026-10-02", today: "2026-10-30", adSpendFn: async () => ({ spend: 100, coverage: "FULL" }) });
  assert.equal(view.enabled, false);
  assert.equal(view.advisoryOnly, true);
  assert.equal(view.sync, null);
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].contribution, 80 - 40 - 100);
  assert.equal(view.rows[0].loss, true);
  assert.equal(view.tacos.account.tacos, 0.1);
  assert.equal(view.tacos.account.status, "WITHIN_LINE");
  assert.ok(view.hints.some((hint) => /未开启/.test(hint)));
  assert.equal(view.tacos.alerts.some((alert) => alert.level === "listing" && alert.id === "L1"), true);
});

test("refresh with the flag off is a reported no-op; empty SPN data is explained, not an error", async () => {
  const db = viewDb();
  const view = await buildExtendedView({ env: { DB: db }, kind: "keywords", start: "2026-10-01", end: "2026-10-02", refresh: true, today: "2026-10-30" });
  assert.equal(view.sync.status, "skipped");
  assert.deepEqual(view.rows, []);
  assert.ok(view.hints.some((hint) => /还没有同步过/.test(hint)));
});

test("a TACOS failure degrades to a hint and never breaks the keyword view", async () => {
  const db = createFakeAdDb({ extra: { "FROM sku_costs": () => ({ results: [] }) } });
  const view = await buildExtendedView({ env: { DB: db }, kind: "rank", start: "2026-10-01", end: "2026-10-02", today: "2026-10-30" });
  assert.equal(view.tacos, null);
  assert.ok(view.hints.some((hint) => /TACOS\/利润计算不可用/.test(hint)));
});

test("rank view joins listing economics from the listing report", async () => {
  const db = viewDb();
  db.rows.push(
    { type: "PRODUCT_RANK_REPORT", date: "2026-10-01", key: "a", refreshed: "x", payload: JSON.stringify({ Date: "2026-10-01", listing: "L1", rank: "90", class_size: "100" }) },
    { type: "LISTING_REPORT", date: "2026-10-01", key: "l", refreshed: "x", payload: JSON.stringify({ Date: "2026-10-01", campaign_id: "1", listing: "L1", first_10_part_numbers: "P1", spend_USD: "100", attributed_wholesale_cost_window_view_through_USD_Day_14: "80", attributed_units_window_view_through_Day_14: "1" }) },
  );
  const view = await buildExtendedView({ env: { DB: db }, kind: "rank", start: "2026-10-01", end: "2026-10-02", today: "2026-10-30", adSpendFn: async () => ({ spend: 100, coverage: "FULL" }) });
  assert.equal(view.rows[0].tier, "TRAIL");
  assert.equal(view.rows[0].advice.code, "REDUCE");
  assert.equal(view.rows[0].contribution, -60);
});
