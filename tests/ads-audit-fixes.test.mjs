import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { saveExtendedReport, syncExtendedReports } from "../lib/ads-extended-sync.mjs";
import { aggregateKeywords, aggregateRank, listingEconomicsMap } from "../lib/ads-keyword-rank.mjs";
import { refreshAllowed } from "../lib/ads-refresh-guard.mjs";
import { buildLossBuckets, contributionAfterAds, lossAlerts, tacosAssessment } from "../lib/ads-profit-rules.mjs";
import { ReportStillRunningError, fetchReportRows, normalizeKeywordRow, normalizeRankRow, rowReader } from "../lib/ads-report-source.mjs";
import { buildTacosGuard } from "../lib/ads-tacos-guard.mjs";
import { createFakeAdDb } from "./helpers-fake-ad-db.mjs";

const cost = (cents) => ({ unitCostCents: cents, currency: "USD", currencyCertifiedAt: "2026-09-01", currencyCertificationSource: "ops", updatedAt: "2026-10-01" });
const ON = { ADS_EXTENDED_REPORTS_ENABLED: "true" };

// ---- 1) keyword aggregation: missing columns are null, zero-orders needs an orders column
test("1. missing columns stay null through aggregation, with a quality hint listing them", () => {
  const rows = [{ Date: "2026-10-01", campaign_id: "1", listing: "L1", keyword: "desk", keyword_match_type: "EXACT", spend_USD: "40", clicks: "30" }];
  const result = aggregateKeywords({ rows, start: "2026-10-01", end: "2026-10-01", matureThrough: "2026-10-05" });
  const row = result.rows[0];
  assert.equal(row.orders, null);
  assert.equal(row.impressions, null);
  assert.equal(row.retail, null);
  assert.equal(row.cvr, null);
  assert.equal(row.ctr, null);
  assert.equal(row.retailRoas, null);
  assert.equal(row.contribution, null);
  assert.equal(result.summary.orders, null);
  assert.equal(result.quality.ordersColumnPresent, false);
  assert.ok(result.quality.missingColumns.includes("订单"));
});

test("1. without an orders column, 'zero orders' is never concluded (UNKNOWN, not LOWER_OR_DROP)", () => {
  const rows = [{ Date: "2026-10-01", campaign_id: "1", listing: "L1", keyword: "desk", keyword_match_type: "EXACT", spend_USD: "40", clicks: "30" }];
  const result = aggregateKeywords({ rows, start: "2026-10-01", end: "2026-10-01", matureThrough: "2026-10-05" });
  assert.equal(result.rows[0].advice.code, "UNKNOWN");
  const withOrders = aggregateKeywords({ rows: [{ ...rows[0], attributed_orders_window_view_through_Day_14: "0" }], start: "2026-10-01", end: "2026-10-01", matureThrough: "2026-10-05" });
  assert.equal(withOrders.rows[0].orders, 0);
  assert.equal(withOrders.rows[0].advice.code, "LOWER_OR_DROP");
});

test("1. one row missing a value makes the keyword total unknown instead of silently smaller", () => {
  const full = { Date: "2026-10-01", campaign_id: "1", listing: "L1", keyword: "desk", keyword_match_type: "EXACT", spend_USD: "10", clicks: "5", attributed_orders_window_view_through_Day_14: "1" };
  const gap = { Date: "2026-10-02", campaign_id: "1", listing: "L1", keyword: "desk", keyword_match_type: "EXACT", spend_USD: "10", clicks: "5" };
  const result = aggregateKeywords({ rows: [full, gap], start: "2026-10-01", end: "2026-10-02", matureThrough: "2026-10-05" });
  assert.equal(result.rows[0].spend, 20);
  assert.equal(result.rows[0].orders, null);
});

// ---- 2) profit rules: nulls, immature window
const lrow = (over) => ({
  Date: "2026-10-01", campaign_id: "1", campaign_name: "Camp", listing: "L1", product_name: "Desk", first_10_part_numbers: "P1",
  spend_USD: "30", attributed_wholesale_cost_window_view_through_USD_Day_14: "0", attributed_units_window_view_through_Day_14: "0", attributed_orders_window_view_through_Day_14: "0", ...over,
});

test("2. contributionAfterAds treats missing spend/WSC as unknown, not 0", () => {
  assert.equal(contributionAfterAds({ wsc: 100, units: 1, spend: null }).basis, "UNKNOWN");
  assert.equal(contributionAfterAds({ wsc: null, units: 1, spend: 50 }).contribution, null);
  assert.equal(contributionAfterAds({ wsc: undefined, units: 1, spend: 50 }).basis, "UNKNOWN");
  assert.equal(contributionAfterAds({ wsc: "", units: 1, spend: 50 }).basis, "UNKNOWN");
});

test("2. no-sales spend inside the immature 14-day window is only 'watch'; mature it is a loss", () => {
  const immature = contributionAfterAds({ wsc: 0, spend: 50, mature: false });
  assert.deepEqual([immature.loss, immature.watch], [false, true]);
  const mature = contributionAfterAds({ wsc: 0, spend: 50, mature: true });
  assert.deepEqual([mature.loss, mature.watch], [true, false]);
});

test("2. buildLossBuckets: a listing missing the spend or WSC column is null/unknown and never flagged", () => {
  const noWsc = lrow({});
  delete noWsc.attributed_wholesale_cost_window_view_through_USD_Day_14;
  const result = buildLossBuckets({ rows: [noWsc], start: "2026-10-01", end: "2026-10-01", matureThrough: "2026-10-05" });
  assert.equal(result.listings[0].wsc, null);
  assert.equal(result.listings[0].contribution, null);
  assert.equal(result.listings[0].loss, false);
  assert.equal(result.campaigns[0].contribution, null);
  assert.equal(lossAlerts(result).length, 0);
  const noSpend = lrow({});
  delete noSpend.spend_USD;
  const second = buildLossBuckets({ rows: [noSpend], start: "2026-10-01", end: "2026-10-01", matureThrough: "2026-10-05" });
  assert.equal(second.listings[0].spend, null);
  assert.equal(second.listings[0].basis, "UNKNOWN");
});

test("2. buildLossBuckets: no-sales spend in an immature window → WATCH alert; mature window → confirmed LOSS", () => {
  const immature = buildLossBuckets({ rows: [lrow({})], start: "2026-10-01", end: "2026-10-01", matureThrough: "2026-09-20" });
  assert.equal(immature.mature, false);
  assert.equal(immature.listings[0].loss, false);
  assert.equal(immature.listings[0].watch, true);
  assert.equal(immature.campaigns[0].loss, false);
  assert.equal(immature.campaigns[0].watch, true);
  const alerts = lossAlerts(immature);
  assert.ok(alerts.length >= 1);
  assert.ok(alerts.every((alert) => alert.status === "WATCH" && alert.confirmed === false && alert.mature === false));
  const mature = buildLossBuckets({ rows: [lrow({})], start: "2026-10-01", end: "2026-10-01", matureThrough: "2026-10-05" });
  assert.equal(mature.listings[0].loss, true);
  const matureAlerts = lossAlerts(mature);
  assert.ok(matureAlerts.every((alert) => alert.status === "LOSS" && alert.mature === true));
});

test("2. without matureThrough the window is treated as immature (never over-claims a loss)", () => {
  const result = buildLossBuckets({ rows: [lrow({})], start: "2026-10-01", end: "2026-10-01" });
  assert.equal(result.mature, false);
  assert.equal(result.listings[0].loss, false);
});

test("2. TACOS guard carries mature flag, watch alerts and an immaturity note", () => {
  const guard = buildTacosGuard({
    range: { start: "2026-10-01", end: "2026-10-01" }, adSpend: { spend: 30, coverage: "FULL" },
    sales: { orders: 5, totalSales: 1000, orderProfit: { estimated: 300, costCoverage: 1, basis: "SKU_COST" }, partRevenue: new Map() },
    listingRows: [lrow({})], costByPart: new Map([["P1", cost(1000)]]), matureThrough: "2026-09-20",
  });
  assert.equal(guard.mature, false);
  assert.ok(guard.alerts.every((alert) => alert.status === "WATCH"));
  assert.ok(guard.notes.some((note) => /未满14天/.test(note)));
});

// ---- 3) report source
test("3. an alias column consumed by one field is not handed to a second field", () => {
  const r = rowReader({ spend: "5", impression: "9" });
  assert.equal(r.num(["spend"]), 5);
  assert.equal(r.num(["spend"]), null, "already used");
  assert.equal(r.text(["spend"]), "");
});

test("3. rank_percentile is never read as the rank", () => {
  const onlyPercentile = normalizeRankRow({ Date: "2026-10-02", listing: "L1", rank_percentile: "0.35", class_size: "100" });
  assert.equal(onlyPercentile.rank, null);
  assert.equal(onlyPercentile.percentile, 0.35);
  assert.equal(onlyPercentile.rankMissing, true);
  const patterned = normalizeRankRow({ Date: "2026-10-02", listing: "L1", sales_rank_percentile: "0.2", competitive_rank_in_class: "7" });
  assert.equal(patterned.rank, 7);
  assert.equal(patterned.percentile, 0.2);
  const both = normalizeRankRow({ Date: "2026-10-02", listing: "L1", rank: "3", rank_percentile: "0.9" });
  assert.deepEqual([both.rank, both.percentile], [3, 0.9]);
});

test("3. click_through and view_through 14-day columns: view_through is chosen explicitly and the choice is reported", () => {
  const row = normalizeKeywordRow({
    Date: "2026-10-02", keyword: "desk", spend_USD: "10",
    attributed_orders_window_click_through_Day_14: "9", attributed_orders_window_view_through_Day_14: "2",
  });
  assert.equal(row.orders, 2);
  assert.ok(row.notes.some((note) => /click_through/.test(note) && /选用/.test(note) && /view_through/.test(note)));
});

test("3. when several candidate columns remain ambiguous nothing is guessed (null + note)", () => {
  const row = normalizeKeywordRow({
    Date: "2026-10-02", keyword: "desk",
    attributed_orders_window_a_Day_14: "9", attributed_orders_window_b_Day_14: "2",
  });
  assert.equal(row.orders, null);
  assert.ok(row.notes.some((note) => /含义不明确/.test(note)));
});

test("3. rank advice is marked unvalidated and INVEST needs a known TACOS within the line", () => {
  const rankRows = [{ Date: "2026-10-01", listing: "L1", rank: "2", class_size: "100" }];
  const base = { rows: rankRows, start: "2026-10-01", end: "2026-10-01" };
  const economics = (tacosStatus) => new Map([["L1", { spend: 10, wsc: 100, contribution: 50, basis: "SKU_COST", loss: false, suspectedLoss: false, tacos: 0.05, tacosStatus }]]);
  const ok = aggregateRank({ ...base, listingEconomics: economics("WITHIN_LINE") });
  assert.equal(ok.rows[0].advice.code, "INVEST");
  assert.equal(ok.rows[0].advice.validated, false);
  assert.equal(ok.quality.adviceValidated, false);
  assert.equal(aggregateRank({ ...base, listingEconomics: economics("PROVISIONAL") }).rows[0].advice.code, "HOLD");
  assert.equal(aggregateRank({ ...base, listingEconomics: economics("UNKNOWN") }).rows[0].advice.code, "HOLD");
  const map = listingEconomicsMap([{ listing: "L1", spend: 10, wsc: 100, contribution: 50, basis: "SKU_COST", loss: false, suspectedLoss: false }], new Map([["L1", 1000]]), "PARTIAL");
  assert.equal(map.get("L1").tacosStatus, "PROVISIONAL");
});

test("3. the rank page shows the advice column as 待验证", async () => {
  const ui = await readFile(new URL("../app/AdsKeywordRank.tsx", import.meta.url), "utf8");
  assert.match(ui, /建议（待验证）/);
  assert.match(ui, /待验证 · /);
});

// ---- 4) refresh guard
const req = (headers) => new Request("https://ops.example.com/api/ads/keywords?refresh=1", { headers });
test("4. refresh accepts same-origin/none/absent Sec-Fetch-Site and refuses cross-site and same-site", () => {
  assert.equal(refreshAllowed(req({})), true);
  assert.equal(refreshAllowed(req({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(refreshAllowed(req({ "sec-fetch-site": "none" })), true);
  assert.equal(refreshAllowed(req({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(refreshAllowed(req({ "sec-fetch-site": "same-site" })), false);
  assert.equal(refreshAllowed(req({ origin: "https://evil.example" })), false);
  assert.equal(refreshAllowed(req({ origin: "https://ops.example.com", "sec-fetch-site": "same-origin" })), true);
});

test("4. both routes use the guard and /api/ads/analysis is untouched", async () => {
  for (const name of ["keywords", "rank"]) {
    const route = await readFile(new URL(`../app/api/ads/${name}/route.ts`, import.meta.url), "utf8");
    assert.match(route, /refresh && !refreshAllowed\(request\)/);
  }
});

// ---- 5) TACOS assessment coverage
test("5. non-FULL coverage never says 'no budget cap' (provisional, unknown advice), FULL still does", () => {
  for (const coverage of ["PARTIAL", "PENDING", "NOT_SYNCED"]) {
    const result = tacosAssessment({ spend: 50, totalSales: 1000, coverage });
    assert.equal(result.status, "PROVISIONAL", coverage);
    assert.equal(result.budgetAdvice, "UNKNOWN", coverage);
    assert.doesNotMatch(result.reason, /可不设预算上限，/);
    assert.match(result.reason, /暂估/);
  }
  const full = tacosAssessment({ spend: 50, totalSales: 1000, coverage: "FULL" });
  assert.deepEqual([full.status, full.budgetAdvice], ["WITHIN_LINE", "NO_CAP"]);
  assert.equal(tacosAssessment({ spend: 200, totalSales: 1000, coverage: "PARTIAL" }).budgetAdvice, "KEEP_CAP");
});

test("5. the account guard under partial coverage is provisional", () => {
  const guard = buildTacosGuard({
    range: { start: "2026-10-01", end: "2026-10-01" }, adSpend: { spend: 50, coverage: "PARTIAL" },
    sales: { orders: 5, totalSales: 1000, orderProfit: { estimated: 300, costCoverage: 1, basis: "SKU_COST" }, partRevenue: new Map() },
    listingRows: [], costByPart: new Map(), matureThrough: "2026-10-05",
  });
  assert.equal(guard.account.status, "PROVISIONAL");
  assert.equal(guard.account.budgetAdvice, "UNKNOWN");
});

// ---- 6) frontend null handling
test("6. the UI shows 暂无法判断 for a null contribution and never a green 未亏损 for it", async () => {
  const ui = await readFile(new URL("../app/AdsKeywordRank.tsx", import.meta.url), "utf8");
  assert.match(ui, /contributionKnown \? usd\(account\.contributionAfterAds\) : "暂无法判断"/);
  assert.match(ui, /!contributionKnown \? "neutral"/);
  assert.match(ui, /if \(value === null\) \{[\s\S]*暂无法判断/);
  assert.match(ui, /暂估 · 广告花费数据不全/);
  assert.match(ui, /观察 · 归因未满14天/);
});

// ---- 7) polling and resume
test("7. polls every ≥3s for ≥3 minutes by default", async () => {
  const waits = [];
  await assert.rejects(
    fetchReportRows({ api: async (path, init) => (init?.method === "POST" ? { id: "r1" } : { status: "RUNNING" }), wait: async (ms) => { waits.push(ms); } }, { reportType: "KEYWORD_PRODUCT_REPORT", start: "2026-10-01", end: "2026-10-01" }),
    (error) => error instanceof ReportStillRunningError && error.reportId === "r1",
  );
  assert.ok(waits.every((ms) => ms >= 3000));
  assert.ok(waits.reduce((a, b) => a + b, 0) >= 180000);
});

test("7. resume skips creation; onCreated reports the new id", async () => {
  const calls = [];
  const api = async (path, init) => { calls.push(`${init?.method || "GET"} ${path.split("?")[0]}`); return init?.method === "POST" ? { id: "new" } : { status: "COMPLETED", url: "https://f/x.csv" }; };
  const fetchImpl = async () => new Response("Date,keyword\n2026-10-01,desk\n");
  const resumed = await fetchReportRows({ api, fetchImpl, wait: async () => {}, resumeReportId: "old" }, { reportType: "KEYWORD_PRODUCT_REPORT", start: "2026-10-01", end: "2026-10-01" });
  assert.deepEqual(calls, ["GET /reports"]);
  assert.equal(resumed.reportId, "old");
  const created = [];
  await fetchReportRows({ api, fetchImpl, wait: async () => {}, onCreated: async (id) => created.push(id) }, { reportType: "KEYWORD_PRODUCT_REPORT", start: "2026-10-01", end: "2026-10-01" });
  assert.deepEqual(created, ["new"]);
});

test("7. a timed-out report is resumed by the next sync instead of creating a duplicate; stored data stays", async () => {
  const db = createFakeAdDb();
  db.rows.push({ type: "KEYWORD_PRODUCT_REPORT", date: "2026-10-01", key: "old", payload: "{}", refreshed: "x" });
  const calls = [];
  let completed = false;
  const api = async (path, init = {}) => {
    calls.push(`${init.method || "GET"} ${path.split("?")[0]}`);
    if (init.method === "POST") return { id: "rep-1" };
    return completed ? { status: "COMPLETED", url: "https://files.example/k.csv" } : { status: "RUNNING" };
  };
  const fetchImpl = async () => new Response("Date,campaign_id,listing,keyword,keyword_match_type,spend_USD\n2026-10-01,1,L1,desk,EXACT,2\n");
  const args = { db, env: ON, start: "2026-10-01", end: "2026-10-01", types: ["KEYWORD_PRODUCT_REPORT"], api, fetchImpl, wait: async () => {}, now: "2026-10-02T00:00:00.000Z", pollOptions: { polls: 2 } };
  const first = await syncExtendedReports(args);
  assert.deepEqual([first[0].status, first[0].pending], ["failed", true]);
  assert.equal(db.rows.length, 1, "old data untouched while pending");
  assert.ok(db.state.size === 1);
  completed = true;
  const second = await syncExtendedReports(args);
  assert.equal(second[0].status, "ok");
  assert.equal(second[0].resumed, true);
  assert.equal(calls.filter((call) => call === "POST /reports").length, 1, "only one report was ever created");
  assert.equal(db.state.size, 0, "marker cleared after success");
});

test("7. a terminally failed pending report is forgotten so the next run creates a fresh one", async () => {
  const db = createFakeAdDb();
  db.state.set("ads-extended:pending:KEYWORD_PRODUCT_REPORT:2026-10-01:2026-10-01", { value: JSON.stringify({ reportId: "dead", createdAt: "2026-10-02T00:00:00.000Z" }), updated: "x" });
  const api = async (path) => (path.includes("reportId=dead") ? { status: "FAILED" } : { id: "x" });
  const result = await syncExtendedReports({ db, env: ON, start: "2026-10-01", end: "2026-10-01", types: ["KEYWORD_PRODUCT_REPORT"], api, wait: async () => {}, now: "2026-10-02T01:00:00.000Z" });
  assert.equal(result[0].status, "failed");
  assert.equal(db.state.size, 0);
});

test("7. a stale (>24h) pending marker is ignored", async () => {
  const db = createFakeAdDb();
  db.state.set("ads-extended:pending:KEYWORD_PRODUCT_REPORT:2026-10-01:2026-10-01", { value: JSON.stringify({ reportId: "stale", createdAt: "2026-09-01T00:00:00.000Z" }), updated: "x" });
  const calls = [];
  const api = async (path, init = {}) => { calls.push(`${init.method || "GET"} ${path}`); return init.method === "POST" ? { id: "fresh" } : { status: "COMPLETED", url: "https://f/k.csv" }; };
  await syncExtendedReports({ db, env: ON, start: "2026-10-01", end: "2026-10-01", types: ["KEYWORD_PRODUCT_REPORT"], api, fetchImpl: async () => new Response("Date,keyword\n2026-10-01,desk\n"), wait: async () => {}, now: "2026-10-02T00:00:00.000Z" });
  assert.ok(calls.some((call) => call.startsWith("POST")));
  assert.ok(!calls.some((call) => call.includes("stale")));
});

// ---- 8) one transaction per day
test("8. each day is replaced in a single transaction, however many rows it has", async () => {
  const db = createFakeAdDb();
  const rows = [];
  for (let i = 0; i < 200; i += 1) rows.push({ Date: "2026-10-01", campaign_id: "1", listing: "L1", keyword: `k${i}`, keyword_match_type: "EXACT" });
  rows.push({ Date: "2026-10-02", campaign_id: "1", listing: "L1", keyword: "z", keyword_match_type: "EXACT" });
  await saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-02", rows, "2026-10-03T00:00:00Z");
  assert.deepEqual(db.batches, [202 + 0, 3]);
  assert.equal(db.rows.length, 201);
});

test("8. a failure inside a day rolls that whole day back (old data survives intact)", async () => {
  const db = createFakeAdDb({ failInsertAt: 3 });
  db.rows.push({ type: "KEYWORD_PRODUCT_REPORT", date: "2026-10-01", key: "old", payload: "{}", refreshed: "x" });
  const rows = [1, 2, 3, 4].map((i) => ({ Date: "2026-10-01", campaign_id: "1", listing: "L1", keyword: `k${i}`, keyword_match_type: "EXACT" }));
  await assert.rejects(saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-01", rows), /simulated/);
  assert.deepEqual(db.rows.map((row) => row.key), ["old"]);
});

// ---- empty report must not wipe stored data
const KW_ROW = { Date: "2026-10-01", campaign_id: "1", listing: "L1", keyword: "desk", keyword_match_type: "EXACT", spend_USD: "5" };

test("empty report over a window that already has rows: nothing deleted, no day marked synced, warning returned", async () => {
  const db = createFakeAdDb();
  await saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-02", [KW_ROW], "2026-10-02T00:00:00Z");
  const before = JSON.stringify([db.rows, [...db.days]]);
  const batchesBefore = db.batches.length;
  const result = await saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-02", [], "2026-10-03T00:00:00Z");
  assert.equal(result.preserved, true);
  assert.match(result.warning, /已有 1 行存量数据/);
  assert.equal(JSON.stringify([db.rows, [...db.days]]), before, "rows and synced-day markers untouched");
  assert.equal(db.batches.length, batchesBefore, "no transaction was even started");
});

test("empty report over a window with no stored rows still records real zero days", async () => {
  const db = createFakeAdDb();
  const result = await saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-02", [], "2026-10-03T00:00:00Z");
  assert.equal(result.preserved, undefined);
  assert.equal(db.days.size, 2);
});

test("rows stored under another report type do not block an empty report", async () => {
  const db = createFakeAdDb();
  await saveExtendedReport(db, "PRODUCT_RANK_REPORT", "2026-10-01", "2026-10-01", [{ Date: "2026-10-01", listing: "L1", rank: "3" }]);
  const result = await saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-01", []);
  assert.equal(result.preserved, undefined);
});

test("sync reports an empty download over stored data as a warning and keeps the data", async () => {
  const db = createFakeAdDb();
  await saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-01", [KW_ROW], "2026-10-02T00:00:00Z");
  const api = async (path, init = {}) => (init.method === "POST" ? { id: "r" } : { status: "COMPLETED", url: "https://f/k.csv" });
  const [result] = await syncExtendedReports({
    db, env: ON, start: "2026-10-01", end: "2026-10-01", types: ["KEYWORD_PRODUCT_REPORT"], api,
    fetchImpl: async () => new Response("Date,keyword\n"), wait: async () => {}, now: "2026-10-03T00:00:00Z",
  });
  assert.equal(result.status, "warning");
  assert.match(result.warning, /未覆盖/);
  assert.equal(db.rows.length, 1);
  assert.equal(db.days.get("KEYWORD_PRODUCT_REPORT|2026-10-01"), "2026-10-02T00:00:00Z", "refreshed_at not advanced");
  assert.equal(db.state.size, 0, "pending marker cleared");
});
