import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  backfillExtendedReports, dailySyncWindow, extendedReportsEnabled, loadExtendedCoverage, loadExtendedRows,
  saveExtendedReport, syncExtendedReports,
} from "../lib/ads-extended-sync.mjs";
import { createFakeAdDb } from "./helpers-fake-ad-db.mjs";

const ON = { ADS_EXTENDED_REPORTS_ENABLED: "true" };

function fakeApi(csvByType, calls = []) {
  let current = "";
  return {
    calls,
    api: async (path, init = {}) => {
      calls.push(`${init.method || "GET"} ${path.split("?")[0]}`);
      if (init.method === "POST") { current = JSON.parse(init.body).reportType; return { id: `id-${current}` }; }
      return { status: "COMPLETED", url: `https://files.example/${path.includes("KEYWORD") ? "k" : "r"}.csv` };
    },
    fetchImpl: async (url) => {
      const type = String(url).endsWith("k.csv") ? "KEYWORD_PRODUCT_REPORT" : "PRODUCT_RANK_REPORT";
      const body = csvByType[type];
      if (body instanceof Error) throw body;
      return new Response(body);
    },
  };
}

test("flag defaults to off and a disabled sync touches neither Wayfair nor the database", async () => {
  assert.equal(extendedReportsEnabled({}), false);
  assert.equal(extendedReportsEnabled({ ADS_EXTENDED_REPORTS_ENABLED: "false" }), false);
  assert.equal(extendedReportsEnabled(ON), true);
  const db = createFakeAdDb();
  const { api, calls } = fakeApi({});
  const result = await syncExtendedReports({ db, env: {}, start: "2026-10-01", end: "2026-10-02", api });
  assert.deepEqual(result.map((item) => item.status), ["skipped", "skipped"]);
  assert.equal(calls.length, 0);
  assert.equal(db.log.length, 0);
});

test("stores each report under its own type, replacing only the requested days", async () => {
  const db = createFakeAdDb();
  db.rows.push({ type: "LISTING_REPORT", date: "2026-10-01", key: "k", payload: "{}", refreshed: "x" });
  const { api, fetchImpl } = fakeApi({
    KEYWORD_PRODUCT_REPORT: "Date,campaign_id,listing,keyword,keyword_match_type,spend_USD\n2026-10-01,1,L1,desk,EXACT,2\n2026-10-01,1,L1,chair,EXACT,3\n2026-10-02,1,L1,desk,EXACT,1\n",
    PRODUCT_RANK_REPORT: "Date,listing,rank\n2026-10-01,L1,4\n",
  });
  const result = await syncExtendedReports({ db, env: ON, start: "2026-10-01", end: "2026-10-02", api, fetchImpl, wait: async () => {} });
  assert.deepEqual(result.map((item) => [item.type, item.status, item.rows]), [["KEYWORD_PRODUCT_REPORT", "ok", 3], ["PRODUCT_RANK_REPORT", "ok", 1]]);
  assert.equal((await loadExtendedRows(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-02")).length, 3);
  assert.equal(db.rows.filter((row) => row.type === "LISTING_REPORT").length, 1, "existing listing rows untouched");
  const coverage = await loadExtendedCoverage(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-03");
  assert.deepEqual([coverage.syncedDays, coverage.missingDays], [2, ["2026-10-03"]]);
});

test("re-running the same window is idempotent (replace, not append)", async () => {
  const db = createFakeAdDb();
  const csv = "Date,campaign_id,listing,keyword,keyword_match_type,spend_USD\n2026-10-01,1,L1,desk,EXACT,2\n";
  const options = () => ({ db, env: ON, start: "2026-10-01", end: "2026-10-01", types: ["KEYWORD_PRODUCT_REPORT"], ...fakeApi({ KEYWORD_PRODUCT_REPORT: csv }), wait: async () => {} });
  await syncExtendedReports(options());
  await syncExtendedReports(options());
  assert.equal(db.rows.length, 1);
});

test("a report without a readable date is rejected before anything is deleted", async () => {
  const db = createFakeAdDb();
  db.rows.push({ type: "KEYWORD_PRODUCT_REPORT", date: "2026-10-01", key: "old", payload: '{"keyword":"keep me"}', refreshed: "x" });
  await assert.rejects(saveExtendedReport(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-01", [{ keyword: "x", spend_USD: "1" }]), /无法识别日期列/);
  assert.equal(db.rows.length, 1);
  assert.ok(!db.log.some((sql) => /DELETE/i.test(sql)));
});

test("an empty report (e.g. no SPN campaigns) is stored as real zero days, not as missing", async () => {
  const db = createFakeAdDb();
  const result = await syncExtendedReports({ db, env: ON, start: "2026-10-01", end: "2026-10-02", types: ["KEYWORD_PRODUCT_REPORT"], ...fakeApi({ KEYWORD_PRODUCT_REPORT: "Date,keyword\n" }), wait: async () => {} });
  assert.equal(result[0].status, "ok");
  assert.equal(result[0].rows, 0);
  assert.equal((await loadExtendedCoverage(db, "KEYWORD_PRODUCT_REPORT", "2026-10-01", "2026-10-02")).syncedDays, 2);
});

test("the two report types fail independently", async () => {
  const db = createFakeAdDb();
  const result = await syncExtendedReports({
    db, env: ON, start: "2026-10-01", end: "2026-10-01",
    ...fakeApi({ KEYWORD_PRODUCT_REPORT: new Error("download exploded"), PRODUCT_RANK_REPORT: "Date,listing,rank\n2026-10-01,L1,4\n" }),
    wait: async () => {},
  });
  assert.deepEqual(result.map((item) => item.status), ["failed", "ok"]);
  assert.match(result[0].error, /download exploded/);
  assert.equal(db.rows.filter((row) => row.type === "PRODUCT_RANK_REPORT").length, 1);
});

test("rejects types outside the extended set so campaign/listing data can never be rewritten here", async () => {
  const db = createFakeAdDb();
  await assert.rejects(saveExtendedReport(db, "LISTING_REPORT", "2026-10-01", "2026-10-01", []), /不是扩展报表类型/);
  const result = await syncExtendedReports({ db, env: ON, start: "2026-10-01", end: "2026-10-01", types: ["LISTING_REPORT"], ...fakeApi({}) });
  assert.equal(result[0].status, "failed");
});

test("daily window is the last 14 closed days", () => {
  assert.deepEqual(dailySyncWindow("2026-10-16"), { start: "2026-10-02", end: "2026-10-15" });
});

test("backfill is a dry run by default and chunks 56 days into 14-day windows", async () => {
  const plan = await backfillExtendedReports({ db: null, env: {}, endDate: "2026-10-15" });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.windows.length, 4);
  assert.deepEqual(plan.windows[0], { start: "2026-08-21", end: "2026-09-03" });
  assert.deepEqual(plan.windows.at(-1), { start: "2026-10-02", end: "2026-10-15" });
  const flat = plan.windows.flatMap((window) => [window.start, window.end]);
  assert.equal(flat.length, 8);
  await assert.rejects(backfillExtendedReports({ db: null, env: {}, endDate: "2026-10-15", days: 500 }), /1–120/);
});

test("backfill with dryRun=false writes through the same guarded sync", async () => {
  const db = createFakeAdDb();
  const result = await backfillExtendedReports({
    db, env: ON, endDate: "2026-10-02", days: 2, dryRun: false, types: ["PRODUCT_RANK_REPORT"],
    ...fakeApi({ PRODUCT_RANK_REPORT: "Date,listing,rank\n2026-10-01,L1,4\n2026-10-02,L1,3\n" }), wait: async () => {},
  });
  assert.equal(result.results[0].results[0].status, "ok");
  assert.equal(db.rows.length, 2);
});

test("scripts: backfill refuses to write without --run AND the confirm variable", async () => {
  const { runBackfill } = await import("../scripts/backfill-ads-extended-reports.mjs");
  let touched = false;
  const bindings = async () => { touched = true; return { DB: {} }; };
  const dry = await runBackfill({ argv: ["node", "x", "--end", "2026-10-15"], env: {}, bindings, backfill: async (o) => ({ dryRun: o.dryRun }) });
  assert.equal(dry.dryRun, true);
  const half = await runBackfill({ argv: ["node", "x", "--run"], env: {}, bindings, backfill: async (o) => ({ dryRun: o.dryRun }) });
  assert.equal(half.dryRun, true);
  assert.equal(touched, false);
  const full = await runBackfill({ argv: ["node", "x", "--run"], env: { ADS_EXTENDED_BACKFILL_CONFIRM: "yes" }, bindings, backfill: async (o) => ({ dryRun: o.dryRun }) });
  assert.equal(full.dryRun, false);
  assert.equal(touched, true);
});

test("the probe reports columns and samples from injected reports and has no write-path code", async () => {
  const { probe } = await import("../scripts/probe-ads-reports.mjs");
  const { api, fetchImpl } = fakeApi({ KEYWORD_PRODUCT_REPORT: "Date,keyword\n2026-10-01,desk\n", PRODUCT_RANK_REPORT: "Date,rank\n2026-10-01,3\n" });
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const result = await probe({ api, end: "2026-10-01", days: 1, wait: async () => {} });
    assert.equal(result.report.length, 3);
    assert.deepEqual(result.report.find((item) => item.reportType === "PRODUCT_RANK_REPORT").columns, ["Date", "rank"]);
  } finally { globalThis.fetch = original; }
  const source = await readFile(new URL("../scripts/probe-ads-reports.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /modify-bids|DATABASE_URL|getRuntimeBindings/i);
});

test("new ad-report code never references bid/budget write endpoints or leaks credentials", async () => {
  for (const file of ["ads-report-source", "ads-extended-sync", "ads-keyword-rank", "ads-keyword-rank-service", "ads-profit-rules", "ads-tacos-guard"]) {
    const source = await readFile(new URL(`../lib/${file}.mjs`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /modify-bids|modifyBid|setBid|SET_LISTING_BID|ALLOW_WAYFAIR_AD_LIVE_CHANGES/i, file);
    assert.doesNotMatch(source, /console\.(log|error|warn)\(.*(SECRET|client_secret)/i, file);
  }
});
