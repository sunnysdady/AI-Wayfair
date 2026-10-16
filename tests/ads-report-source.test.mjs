import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportRequest, canonicalHeader, entityKeyFor, fetchReportRows, normalizeDate, normalizeKeywordRow,
  normalizeRankRow, parseCsv, parseNumber, rowDate,
} from "../lib/ads-report-source.mjs";

test("builds the documented create-report bodies per report type (program is dictated by Wayfair)", () => {
  const keyword = buildReportRequest({ reportType: "KEYWORD_PRODUCT_REPORT", start: "2026-10-01", end: "2026-10-14" });
  assert.equal(keyword.program, "SPN");
  assert.equal(keyword.groupBy, "DAY");
  assert.equal(keyword.fileType, "CSV");
  assert.equal(keyword.attributionWindow, 14);
  assert.deepEqual(keyword.filters, { startDate: "2026-10-01", endDate: "2026-10-14" });
  assert.equal(buildReportRequest({ reportType: "PRODUCT_RANK_REPORT", start: "2026-10-01", end: "2026-10-01" }).program, "WSP");
  assert.equal(buildReportRequest({ reportType: "LISTING_REPORT", start: "2026-10-01", end: "2026-10-01" }).program, "WSP");
});

test("rejects unknown report types, bad dates and inverted ranges", () => {
  assert.throws(() => buildReportRequest({ reportType: "MODIFY_BIDS", start: "2026-10-01", end: "2026-10-02" }), /不支持/);
  assert.throws(() => buildReportRequest({ reportType: "PRODUCT_RANK_REPORT", start: "10/01/2026", end: "2026-10-02" }), /YYYY-MM-DD/);
  assert.throws(() => buildReportRequest({ reportType: "PRODUCT_RANK_REPORT", start: "2026-10-03", end: "2026-10-02" }), /不能晚于/);
});

test("parses quoted CSV with BOM, CRLF and embedded commas/quotes", () => {
  const rows = parseCsv('\uFEFFDate,keyword,spend_USD\r\n2026-10-01,"desk, standing ""L""",3.5\r\n,,\r\n');
  assert.deepEqual(rows, [{ Date: "2026-10-01", keyword: 'desk, standing "L"', spend_USD: "3.5" }]);
});

test("number and date parsing is tolerant", () => {
  assert.equal(parseNumber("$1,234.50"), 1234.5);
  assert.equal(parseNumber("12.5%"), 0.125);
  assert.equal(parseNumber("(3.00)"), -3);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("n/a"), null);
  assert.equal(normalizeDate("2026-10-14T03:00:00Z"), "2026-10-14");
  assert.equal(normalizeDate("10/4/2026"), "2026-10-04");
  assert.equal(normalizeDate("garbage"), null);
  assert.equal(canonicalHeader("Attributed Orders (Window) Day-14"), "attributed_orders_window_day_14");
});

test("keyword rows map by exact alias, then pattern, preferring the 14-day attribution columns", () => {
  const row = normalizeKeywordRow({
    Date: "2026-10-02", campaign_id: "77", listing: "DMOM1021", keyword: "Standing Desk", keyword_match_type: "SMART_EXACT",
    impressions: "1,000", clicks: "20", spend_USD: "12.30",
    attributed_orders_window_view_through_Day_7: "1", attributed_orders_window_view_through_Day_14: "3",
    attributed_units_window_view_through_Day_14: "4",
    attributed_retail_sales_window_view_through_USD_Day_14: "400",
    attributed_wholesale_cost_window_view_through_USD_Day_14: "250", extra_col: "x",
  });
  assert.equal(row.date, "2026-10-02");
  assert.equal(row.sku, "DMOM1021");
  assert.equal(row.keyword, "Standing Desk");
  assert.equal(row.matchType, "SMART_EXACT");
  assert.equal(row.impressions, 1000);
  assert.equal(row.orders, 3);
  assert.equal(row.units, 4);
  assert.equal(row.wsc, 250);
  assert.ok(row.unmapped.includes("extra_col"));
});

test("missing columns stay null instead of becoming zero", () => {
  const row = normalizeKeywordRow({ Date: "2026-10-02", keyword: "desk", spend_USD: "1" });
  assert.equal(row.wsc, null);
  assert.equal(row.orders, null);
  assert.equal(row.clicks, null);
});

test("rank rows read rank and class size under varying names and never confuse rank with sales", () => {
  const row = normalizeRankRow({ Date: "2026-10-02", listing: "L1", sales_rank: "12", products_in_class: "80", sales: "1500", class_name: "Desks" });
  assert.equal(row.rank, 12);
  assert.equal(row.classSize, 80);
  assert.equal(row.sales, 1500);
  const patterned = normalizeRankRow({ Date: "2026-10-02", listing: "L1", competitive_sales_rank_in_class: "5", sales_in_usd: "10" });
  assert.equal(patterned.rank, 5);
  assert.notEqual(patterned.sales, 5);
  assert.equal(normalizeRankRow({ Date: "2026-10-02", listing: "L1" }).rankMissing, true);
});

test("date comes from Date or the stored report_date fallback", () => {
  assert.equal(rowDate({ Date: "2026-10-05" }), "2026-10-05");
  assert.equal(rowDate({ __report_date: "2026-10-06", listing: "x" }), "2026-10-06");
  assert.equal(rowDate({ listing: "x" }), null);
});

test("entity keys differ per keyword/match type and per duplicate index", () => {
  const a = entityKeyFor("KEYWORD_PRODUCT_REPORT", { campaign_id: "1", listing: "L", keyword: "a", keyword_match_type: "X" }, 0);
  const b = entityKeyFor("KEYWORD_PRODUCT_REPORT", { campaign_id: "1", listing: "L", keyword: "b", keyword_match_type: "X" }, 0);
  const c = entityKeyFor("KEYWORD_PRODUCT_REPORT", { campaign_id: "1", listing: "L", keyword: "a", keyword_match_type: "X" }, 1);
  assert.equal(new Set([a, b, c]).size, 3);
});

test("create → poll → download only ever calls the reports endpoints", async () => {
  const calls = [];
  const api = async (path, init = {}) => {
    calls.push(`${init.method || "GET"} ${path.split("?")[0]}`);
    if (init.method === "POST") return { id: "r1" };
    return calls.filter((call) => call.startsWith("GET")).length < 2
      ? { status: "RUNNING" }
      : { status: "COMPLETED", url: "https://files.example/r1.csv" };
  };
  const result = await fetchReportRows(
    { api, wait: async () => {}, fetchImpl: async () => new Response("Date,keyword\n2026-10-01,desk\n") },
    { reportType: "KEYWORD_PRODUCT_REPORT", start: "2026-10-01", end: "2026-10-01" },
  );
  assert.deepEqual(result.rows, [{ Date: "2026-10-01", keyword: "desk" }]);
  assert.deepEqual([...new Set(calls)], ["POST /reports", "GET /reports"]);
});

test("surfaces failed reports and never hangs forever", async () => {
  await assert.rejects(fetchReportRows(
    { api: async (path, init) => (init?.method === "POST" ? { id: "r" } : { status: "FAILED" }), wait: async () => {} },
    { reportType: "PRODUCT_RANK_REPORT", start: "2026-10-01", end: "2026-10-01" },
  ), /生成失败/);
  await assert.rejects(fetchReportRows(
    { api: async (path, init) => (init?.method === "POST" ? { id: "r" } : { status: "RUNNING" }), wait: async () => {}, polls: 3 },
    { reportType: "PRODUCT_RANK_REPORT", start: "2026-10-01", end: "2026-10-01" },
  ), /仍在生成/);
});
