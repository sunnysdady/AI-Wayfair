#!/usr/bin/env node
/**
 * Manual history fill for KEYWORD_PRODUCT_REPORT / PRODUCT_RANK_REPORT.
 * DEFAULT: dry run (prints the 14-day windows it would request, touches nothing).
 *
 * To really write you need ALL of:
 *   --run  +  ADS_EXTENDED_BACKFILL_CONFIRM=yes  +  ADS_EXTENDED_REPORTS_ENABLED=true
 * It only replaces rows of these two report types (per day); campaign/listing
 * data is never touched. Re-running is idempotent.
 *
 *   node scripts/backfill-ads-extended-reports.mjs [--end YYYY-MM-DD] [--days 56] [--type KEYWORD_PRODUCT_REPORT]
 */
import { pathToFileURL } from "node:url";
import { addDays } from "../lib/ads-report-source.mjs";
import { BACKFILL_DEFAULT_DAYS, backfillExtendedReports } from "../lib/ads-extended-sync.mjs";
import { lingxingDate } from "../lib/lingxing-business-time.mjs";
import { getRuntimeBindings } from "../lib/runtime-bindings.mjs";


export async function runBackfill({ argv = process.argv, env = process.env, bindings = getRuntimeBindings, backfill = backfillExtendedReports } = {}) {
  const wantsRun = argv.includes("--run");
  const confirmed = env.ADS_EXTENDED_BACKFILL_CONFIRM === "yes";
  const dryRun = !(wantsRun && confirmed);
  const endIndex = argv.indexOf("--end");
  const daysIndex = argv.indexOf("--days");
  const typeIndex = argv.indexOf("--type");
  const options = {
    endDate: endIndex > -1 ? argv[endIndex + 1] : addDays(lingxingDate(), -1),
    days: daysIndex > -1 ? Number(argv[daysIndex + 1]) : BACKFILL_DEFAULT_DAYS,
    ...(typeIndex > -1 ? { types: [argv[typeIndex + 1]] } : {}),
    dryRun,
  };
  if (dryRun) return { ...(await backfill({ db: null, env, ...options })), note: wantsRun ? "缺少 ADS_EXTENDED_BACKFILL_CONFIRM=yes，按演练处理" : "演练模式：加 --run 且设置确认变量才会写库" };
  const runtime = await bindings();
  return backfill({ db: runtime.DB, env: runtime, ...options });
}

async function main() {
  const result = await runBackfill();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.dryRun && result.results?.some((window) => window.results.some((item) => item.status === "failed"))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
