import assert from "node:assert/strict";
import test from "node:test";

import { aggregateKeywords, aggregateRank, listingEconomicsMap } from "../lib/ads-keyword-rank.mjs";

const cost = (cents) => ({ unitCostCents: cents, currency: "USD", currencyCertifiedAt: "2026-09-01", currencyCertificationSource: "ops", updatedAt: "2026-10-01" });
const kw = (over) => ({
  Date: "2026-10-01", campaign_id: "1", campaign_name: "SPN A", listing: "L1", product_name: "Desk", keyword: "standing desk", keyword_match_type: "SMART_EXACT",
  keyword_max_bid: "1.2", impressions: "500", clicks: "25", spend_USD: "20",
  attributed_orders_window_view_through_Day_14: "2", attributed_units_window_view_through_Day_14: "2",
  attributed_retail_sales_window_view_through_USD_Day_14: "300", attributed_wholesale_cost_window_view_through_USD_Day_14: "200", ...over,
});
const base = { start: "2026-10-01", end: "2026-10-02", matureThrough: "2026-10-05", costByPart: new Map(), listingParts: new Map([["L1", ["P1"]], ["L2", ["P2"]]]) };

test("sums days into one keyword×SKU×match row and computes ratios", () => {
  const out = aggregateKeywords({ ...base, rows: [kw({}), kw({ Date: "2026-10-02", spend_USD: "10" })] });
  assert.equal(out.rows.length, 1);
  const row = out.rows[0];
  assert.equal(row.spend, 30);
  assert.equal(row.clicks, 50);
  assert.equal(row.orders, 4);
  assert.equal(row.wsc, 400);
  assert.equal(row.wscRoas, 13.33);
  assert.equal(row.cpc, 0.6);
  assert.equal(row.cvr, 0.08);
});

test("flags a negative contribution with SKU costs as confirmed loss and keeps it first", () => {
  const rows = [
    kw({ keyword: "ok keyword", attributed_wholesale_cost_window_view_through_USD_Day_14: "500", spend_USD: "10" }),
    kw({ keyword: "loser", spend_USD: "150" }),
  ];
  const out = aggregateKeywords({ ...base, rows, costByPart: new Map([["P1", cost(5000)]]) });
  assert.equal(out.rows[0].keyword, "loser");
  assert.equal(out.rows[0].loss, true);
  assert.equal(out.rows[0].contribution, 200 - 2 * 50 - 150);
  assert.equal(out.rows[0].advice.code, "LOSS_CONFIRMED");
  assert.equal(out.summary.lossCount, 1);
});

test("estimated costs only ever produce 'suspected' loss wording", () => {
  const out = aggregateKeywords({ ...base, rows: [kw({ spend_USD: "190" })] });
  assert.equal(out.rows[0].contributionBasis, "ESTIMATE");
  assert.equal(out.rows[0].loss, false);
  assert.equal(out.rows[0].suspectedLoss, true);
  assert.equal(out.rows[0].advice.code, "LOSS_SUSPECTED");
});

test("zero-order spend is 'lower or drop' only once attribution is mature, otherwise watch", () => {
  const zero = kw({ attributed_orders_window_view_through_Day_14: "0", attributed_units_window_view_through_Day_14: "0", attributed_wholesale_cost_window_view_through_USD_Day_14: "0", attributed_retail_sales_window_view_through_USD_Day_14: "0", spend_USD: "25" });
  assert.equal(aggregateKeywords({ ...base, rows: [zero] }).rows[0].advice.code, "LOWER_OR_DROP");
  assert.equal(aggregateKeywords({ ...base, matureThrough: "2026-09-20", rows: [zero] }).rows[0].advice.code, "WATCH");
});

test("tiny samples stay 'observe' — no advice from 3 clicks", () => {
  const out = aggregateKeywords({ ...base, rows: [kw({ clicks: "3", spend_USD: "2", attributed_orders_window_view_through_Day_14: "0" })] });
  assert.equal(out.rows[0].advice.code, "OBSERVE");
});

test("a report without a WSC column never invents profit", () => {
  const row = kw({});
  delete row.attributed_wholesale_cost_window_view_through_USD_Day_14;
  const out = aggregateKeywords({ ...base, rows: [row] });
  assert.equal(out.rows[0].contribution, null);
  assert.equal(out.rows[0].wsc, null);
  assert.equal(out.rows[0].wscRoas, null);
  assert.equal(out.quality.wscColumnPresent, false);
  assert.equal(out.summary.contribution, null);
});

test("ignores out-of-range days and rows without dates, and reports them", () => {
  const out = aggregateKeywords({ ...base, rows: [kw({ Date: "2026-09-01" }), kw({ Date: "" }), kw({})] });
  assert.equal(out.rows.length, 1);
  assert.equal(out.quality.rowsWithoutDate, 1);
  assert.equal(out.quality.rowsUsed, 1);
});

test("keyword and match type grouping is case-insensitive and campaign-scoped", () => {
  const out = aggregateKeywords({ ...base, rows: [kw({}), kw({ keyword: "Standing Desk" }), kw({ campaign_id: "2" })] });
  assert.equal(out.rows.length, 2);
});

const rk = (over) => ({ Date: "2026-10-01", listing: "L1", product_name: "Desk", class_name: "Desks", rank: "5", class_size: "100", ...over });

test("rank tiers: top 20% lead, bottom 40% trail, none without class size", () => {
  const out = aggregateRank({
    start: "2026-10-01", end: "2026-10-02",
    rows: [rk({ listing: "A", rank: "10" }), rk({ listing: "B", rank: "50" }), rk({ listing: "C", rank: "90" }), rk({ listing: "D", class_size: "" })],
  });
  const tier = Object.fromEntries(out.rows.map((row) => [row.sku, row.tier]));
  assert.deepEqual(tier, { A: "LEAD", B: "MID", C: "TRAIL", D: "UNKNOWN" });
});

test("rank change compares first and last day (positive = moved up)", () => {
  const out = aggregateRank({ start: "2026-10-01", end: "2026-10-05", rows: [rk({ Date: "2026-10-01", rank: "30" }), rk({ Date: "2026-10-05", rank: "12" })] });
  assert.equal(out.rows[0].rank, 12);
  assert.equal(out.rows[0].rankChange, 18);
});

test("rank advice joins listing economics: trailing + loss → reduce; leading + profit + TACOS ok → invest", () => {
  const econ = listingEconomicsMap(
    [
      { listing: "A", spend: 20, wsc: 300, contribution: 120, basis: "SKU_COST", loss: false, suspectedLoss: false },
      { listing: "C", spend: 60, wsc: 100, contribution: -50, basis: "SKU_COST", loss: true, suspectedLoss: false },
      { listing: "E", spend: 90, wsc: 400, contribution: 10, basis: "SKU_COST", loss: false, suspectedLoss: false },
    ],
    new Map([["A", 1000], ["C", 400], ["E", 500]]),
  );
  const out = aggregateRank({
    start: "2026-10-01", end: "2026-10-01", listingEconomics: econ,
    rows: [rk({ listing: "A", rank: "10" }), rk({ listing: "C", rank: "90" }), rk({ listing: "E", rank: "5" })],
  });
  const advice = Object.fromEntries(out.rows.map((row) => [row.sku, row.advice.code]));
  assert.equal(advice.A, "INVEST");
  assert.equal(advice.C, "REDUCE");
  assert.equal(advice.E, "HOLD", "leading but TACOS 18% is over the 10% line");
});

test("rank rows without a rank column are counted, not guessed", () => {
  const out = aggregateRank({ start: "2026-10-01", end: "2026-10-01", rows: [{ Date: "2026-10-01", listing: "Z" }] });
  assert.equal(out.rows[0].rank, null);
  assert.equal(out.quality.rowsWithoutRank, 1);
  assert.equal(out.rows[0].advice.code, "UNKNOWN");
});
