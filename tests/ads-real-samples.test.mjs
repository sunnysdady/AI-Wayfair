import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { saveExtendedReport, loadExtendedRows } from "../lib/ads-extended-sync.mjs";
import { aggregateKeywords, aggregateRank } from "../lib/ads-keyword-rank.mjs";
import { entityKeyFor, normalizeKeywordRow, normalizeRankRow, rowDate } from "../lib/ads-report-source.mjs";
import { buildLossBuckets } from "../lib/ads-profit-rules.mjs";
import { createFakeAdDb } from "./helpers-fake-ad-db.mjs";

// Sanitized rows from the real read-only probe (column names are the real ones).
const real = JSON.parse(await readFile(new URL("./fixtures/ads-real-samples.json", import.meta.url), "utf8"));
const [kw1, kw2, kw3] = real.KEYWORD_PRODUCT_REPORT;
const WSC = "attributed_wholesale_cost_window_view_through_USD_Day_14";
const UNITS = "attributed_units_window_view_through_Day_14";
const ORDERS = "attributed_orders_window_view_through_Day_14";
const RETAIL = "attributed_retail_sales_window_view_through_USD_Day_14";

test("real keyword row: keyword text, id, match type, bid, sku, class and date all map", () => {
  const row = normalizeKeywordRow(kw1);
  assert.equal(row.date, "2026-10-08");
  assert.equal(row.keyword, "printer stand file cabinet");
  assert.match(row.keywordId, /^\d+$/);
  assert.equal(row.matchType, "Smart Phrase");
  assert.equal(row.maxBid, 0.05);
  assert.equal(row.sku, "DMOM1021");
  assert.equal(row.className, "Filing Cabinets");
  assert.equal(row.campaignName, "LFC-keywords");
  assert.equal(row.impressions, 6);
  assert.equal(row.clicks, 0);
  assert.equal(row.spend, 0);
  assert.equal(row.orders, 0);
  assert.equal(row.units, 0);
  assert.equal(row.wsc, 0);
  assert.equal(row.notes.length, 0, "no ambiguity notes on the real column set");
});

test("real column names carry wsc / units / orders / retail through when non-zero", () => {
  const row = normalizeKeywordRow({ ...kw1, clicks: "30", spend_USD: "20.50", [WSC]: "310.25", [UNITS]: "3", [ORDERS]: "2", [RETAIL]: "420.00" });
  assert.deepEqual([row.clicks, row.spend, row.wsc, row.units, row.orders, row.retail], [30, 20.5, 310.25, 3, 2, 420]);
  assert.equal(row.reportedRoas, 0, "the real retail_roas column (0.0000) is read, not confused with wholesale ROAS");
  const withRoas = normalizeKeywordRow({ ...kw1, retail_roas_window_view_through_Day_14: "2.5", wholesale_cost_roas_window_view_through_Day_14: "1.9" });
  assert.equal(withRoas.reportedRoas, 2.5);
  assert.equal(withRoas.notes.length, 0, "retail vs wholesale ROAS is no longer an 'ambiguous column'");
});

test("keyword_default_bid is the bid; the date comes from the real Date column", () => {
  assert.equal(normalizeKeywordRow(kw2).maxBid, 0.05);
  assert.equal(rowDate(kw2), "2026-10-08");
});

test("real unmapped columns are only the harmless descriptive/derived ones", () => {
  const unmapped = normalizeKeywordRow(kw1).unmapped;
  assert.ok(!unmapped.includes("keyword_value") && !unmapped.includes("keyword_id") && !unmapped.includes("keyword_default_bid"));
});

test("entity keys: different keywords of one SKU/campaign differ; same keyword differs only by row index", () => {
  const a = entityKeyFor("KEYWORD_PRODUCT_REPORT", kw1, 0);
  const b = entityKeyFor("KEYWORD_PRODUCT_REPORT", { ...kw1, keyword_id: "99", keyword_value: "other words" }, 1);
  assert.notEqual(a, b);
  assert.match(a, new RegExp(`:${normalizeKeywordRow(kw1).keywordId}:Smart Phrase:0$`), "keyword_id is the stable part of the key");
  // Same keyword on the same day twice keeps both rows distinct in storage (never a primary-key clash).
  assert.notEqual(entityKeyFor("KEYWORD_PRODUCT_REPORT", kw1, 0), entityKeyFor("KEYWORD_PRODUCT_REPORT", kw1, 1));
  // Same text, different match type, different keywords: still separate.
  assert.notEqual(
    entityKeyFor("KEYWORD_PRODUCT_REPORT", { ...kw1, keyword_id: "5", keyword_match_type: "Exact" }, 0),
    entityKeyFor("KEYWORD_PRODUCT_REPORT", { ...kw1, keyword_id: "5", keyword_match_type: "Phrase" }, 0),
  );
});

test("storing the real rows keeps every keyword (no collapsing) and re-syncing does not double count", async () => {
  const db = createFakeAdDb();
  const rows = [kw1, kw2, kw3];
  await saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-08", "2026-10-08", rows, "2026-10-09T00:00:00Z");
  await saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-08", "2026-10-08", rows, "2026-10-10T00:00:00Z");
  assert.equal(db.rows.length, 3);
  const stored = await loadExtendedRows(db, "KEYWORD_PRODUCT_REPORT", "2026-10-08", "2026-10-08");
  const view = aggregateKeywords({ rows: stored, start: "2026-10-08", end: "2026-10-08", matureThrough: "2026-10-20" });
  assert.equal(view.rows.length, 3);
  assert.deepEqual(view.rows.map((row) => row.keyword).sort(), ["file cabinet", "file cabinets", "printer stand file cabinet"]);
  assert.equal(view.rows.reduce((sum, row) => sum + row.impressions, 0), 6 + 1 + 2);
  assert.equal(view.quality.duplicateRows, 0);
  assert.deepEqual(view.quality.missingColumns, []);
});

test("aggregation: different keywords stay apart, the same keyword across days is summed once per row, duplicates are surfaced", () => {
  const day = (date, over) => ({ ...kw1, Date: date, clicks: "10", spend_USD: "5", ...over });
  const rows = [
    day("2026-10-08", {}), day("2026-10-09", {}),
    day("2026-10-08", { keyword_id: "88", keyword_value: "second keyword" }),
  ];
  const result = aggregateKeywords({ rows, start: "2026-10-08", end: "2026-10-09", matureThrough: "2026-10-20" });
  assert.equal(result.rows.length, 2);
  const first = result.rows.find((row) => row.keyword === "printer stand file cabinet");
  assert.equal(first.spend, 10);
  assert.equal(first.clicks, 20);
  assert.equal(result.quality.duplicateRows, 0);
  const dup = aggregateKeywords({ rows: [day("2026-10-08", {}), day("2026-10-08", {})], start: "2026-10-08", end: "2026-10-08", matureThrough: "2026-10-20" });
  assert.equal(dup.rows.length, 1);
  assert.equal(dup.quality.duplicateRows, 1, "an identical same-day row is summed but flagged, not silently hidden");
});

test("real rank rows parse; the report has no sales / spend / class size and nothing becomes NaN or advice", () => {
  const [r1, r2, r3] = real.PRODUCT_RANK_REPORT;
  const parsed = normalizeRankRow(r1);
  assert.deepEqual([parsed.date, parsed.sku, parsed.className, parsed.rank], ["2026-10-08", "DMOM1018", "Filing Cabinets", 181]);
  assert.equal(parsed.classSize, null);
  assert.equal(parsed.sales, null);
  assert.equal(parsed.adSpend, null);
  assert.equal(parsed.rankMissing, false);
  const view = aggregateRank({ rows: [r1, r2, r3, { ...r1, Date: "2026-10-09", "Class Rank": "150" }], start: "2026-10-08", end: "2026-10-09" });
  assert.equal(view.rows.length, 3);
  const first = view.rows.find((row) => row.sku === "DMOM1018");
  assert.equal(first.rank, 150);
  assert.equal(first.rankChange, 31, "181 → 150 moved up 31");
  for (const row of view.rows) {
    assert.equal(row.tier, "UNKNOWN");
    assert.equal(row.advice.code, "UNKNOWN");
    assert.equal(row.advice.validated, false);
    assert.equal(row.classSize, null);
    assert.equal(row.sales, null);
    assert.equal(row.adSpend, null);
    for (const value of Object.values(row)) assert.ok(!(typeof value === "number" && Number.isNaN(value)));
  }
  assert.equal(view.quality.rowsWithoutClassSize, 4);
  assert.equal(view.quality.adviceValidated, false);
  assert.doesNotMatch(JSON.stringify(view), /NaN/);
});

test("the rank UI renders null rank / class size / spend / TACOS without NaN", async () => {
  const ui = await readFile(new URL("../app/AdsKeywordRank.tsx", import.meta.url), "utf8");
  assert.match(ui, /row\.rank === null \? "—" : row\.classSize \?/);
  assert.match(ui, /value === null \|\| value === undefined/);
  assert.match(ui, /待验证 · /);
});

test("CAMPAIGN_REPORT rows are unaffected: no keyword aliasing touches them and the existing loss buckets still read them", () => {
  const [c1] = real.CAMPAIGN_REPORT;
  assert.equal(c1.campaign_name.startsWith("SAMPLE_CAMPAIGN_"), true);
  // The keyword/rank normalizers are only used by the extended types; entity keys for other types stay as before.
  assert.equal(entityKeyFor("CAMPAIGN_REPORT", c1, 3), `${c1.campaign_id}:unknown:3`);
  const buckets = buildLossBuckets({ rows: [{ ...c1, listing: "L1", first_10_part_numbers: "P1" }], start: "2026-10-08", end: "2026-10-08", matureThrough: "2026-10-20" });
  assert.equal(buckets.campaigns.length, 1);
  assert.equal(buckets.campaigns[0].spend, 0);
});
