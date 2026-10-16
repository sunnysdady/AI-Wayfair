#!/usr/bin/env node
/**
 * Read-only probe for the Advertising API report endpoints.
 *
 * Creates (POST /reports), polls and downloads CAMPAIGN_REPORT,
 * KEYWORD_PRODUCT_REPORT and PRODUCT_RANK_REPORT for a short window, then prints
 * the column names, row counts and a few sample rows. It never calls a bid,
 * budget, or campaign write endpoint and never touches the database.
 *
 * Credentials come from WAYFAIR_AD_CLIENT_ID / WAYFAIR_AD_CLIENT_SECRET in the
 * process environment (run it where the app runs, e.g. inside the production
 * container). They are never printed or written to disk.
 *
 *   node scripts/probe-ads-reports.mjs --confirm-readonly [--end YYYY-MM-DD] [--days 7] [--samples 3]
 */
import { pathToFileURL } from "node:url";
import { createAdvertisingApi } from "../lib/ads-extended-sync.mjs";
import { addDays, describeColumns, fetchReportRows } from "../lib/ads-report-source.mjs";
import { lingxingDate } from "../lib/lingxing-business-time.mjs";

const TYPES = ["CAMPAIGN_REPORT", "KEYWORD_PRODUCT_REPORT", "PRODUCT_RANK_REPORT"];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

export async function probe({ env = process.env, end, days = 7, samples = 3, api, wait } = {}) {
  const resolvedEnd = end || addDays(lingxingDate(), -1);
  const start = addDays(resolvedEnd, -(days - 1));
  const client = api || createAdvertisingApi(env);
  const report = [];
  for (const reportType of TYPES) {
    try {
      const { reportId, rows } = await fetchReportRows({ api: client, wait }, { reportType, start, end: resolvedEnd });
      report.push({ reportType, ok: true, reportId, rows: rows.length, columns: describeColumns(rows), sample: rows.slice(0, samples) });
    } catch (error) {
      report.push({ reportType, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { window: { start, end: resolvedEnd }, report };
}

async function main() {
  if (!process.argv.includes("--confirm-readonly")) {
    console.error("Refusing to run without --confirm-readonly (this only creates and downloads reports).");
    process.exit(2);
  }
  const result = await probe({ end: arg("end"), days: Number(arg("days", 7)), samples: Number(arg("samples", 3)) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.report.some((item) => !item.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
