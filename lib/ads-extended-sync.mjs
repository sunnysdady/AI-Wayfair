/**
 * Sync + storage for the extended advertising reports (keyword × product,
 * product rank). Storage reuses the existing `ad_report_days` /
 * `ad_report_rows` tables (no schema change); rows are keyed by report_type so
 * they can never mix with CAMPAIGN_REPORT / LISTING_REPORT.
 *
 * Safety properties:
 *  - OFF by default: nothing is requested from Wayfair unless
 *    ADS_EXTENDED_REPORTS_ENABLED=true.
 *  - Report creation only (POST /reports → GET /reports → download). No bid,
 *    budget or campaign write endpoint is referenced anywhere in this file.
 *  - Append/replace per (report_type, day) only; other report types untouched.
 *  - A report whose rows carry no readable date is rejected *before* any
 *    delete, so an unexpected column layout can never wipe stored days.
 *  - Each report type succeeds or fails on its own.
 */
import { fetchAdvertisingResponse } from "./wayfair-ad-retry.mjs";
import { WAYFAIR_ADVERTISING_AUDIENCE } from "./ad-action-queue.mjs";
import {
  EXTENDED_REPORT_TYPES, ReportStillRunningError, addDays, assertDate, datesBetween, entityKeyFor, fetchReportRows, rowDate,
} from "./ads-report-source.mjs";

const TOKEN_URL = "https://sso.auth.wayfair.com/oauth/token";
const API_BASE = "https://api.wayfair.io/advertising/v1";
export const DAILY_LOOKBACK_DAYS = 14;
export const BACKFILL_DEFAULT_DAYS = 56;
export const BACKFILL_CHUNK_DAYS = 14;

export function extendedReportsEnabled(env = {}) {
  return String(env.ADS_EXTENDED_REPORTS_ENABLED || "").trim().toLowerCase() === "true";
}

/** Window the 06:00 job refreshes: the last 14 closed days (attribution is still moving). */
export function dailySyncWindow(today) {
  assertDate(today, "today");
  return { start: addDays(today, -DAILY_LOOKBACK_DAYS), end: addDays(today, -1) };
}

export async function ensureExtendedTables(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_report_days (report_type TEXT NOT NULL, report_date TEXT NOT NULL, refreshed_at TEXT NOT NULL, PRIMARY KEY(report_type, report_date))").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_report_rows (report_type TEXT NOT NULL, report_date TEXT NOT NULL, entity_key TEXT NOT NULL, payload TEXT NOT NULL, refreshed_at TEXT NOT NULL, PRIMARY KEY(report_type, report_date, entity_key))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS ad_report_rows_range_idx ON ad_report_rows(report_type, report_date)").run();
  // Same DDL the cron route uses; holds the "report still running" markers below.
  await db.prepare("CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
}

const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const pendingKey = (type, start, end) => `ads-extended:pending:${type}:${start}:${end}`;

/** Best effort: a failure to read/write the marker must never fail the sync itself. */
async function readPending(db, type, start, end, now) {
  try {
    const row = await db.prepare("SELECT value FROM sync_state WHERE key=?").bind(pendingKey(type, start, end)).first();
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    const age = Date.parse(String(now)) - Date.parse(String(parsed.createdAt || ""));
    return parsed.reportId && age >= 0 && age < PENDING_MAX_AGE_MS ? String(parsed.reportId) : null;
  } catch { return null; }
}
async function writePending(db, type, start, end, reportId, now) {
  try {
    await db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
      .bind(pendingKey(type, start, end), JSON.stringify({ reportId, createdAt: now }), now).run();
  } catch { /* best effort */ }
}
async function clearPending(db, type, start, end) {
  try { await db.prepare("DELETE FROM sync_state WHERE key=?").bind(pendingKey(type, start, end)).run(); } catch { /* best effort */ }
}

/** Advertising API client. Credentials are read from env only and never logged. */
export function createAdvertisingApi(env, { fetchImpl = fetch } = {}) {
  let tokenPromise = null;
  async function token() {
    if (!env.WAYFAIR_AD_CLIENT_ID || !env.WAYFAIR_AD_CLIENT_SECRET) throw new Error("Advertising API 凭证未配置");
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetchImpl(TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_id: env.WAYFAIR_AD_CLIENT_ID, client_secret: env.WAYFAIR_AD_CLIENT_SECRET, audience: WAYFAIR_ADVERTISING_AUDIENCE }),
      });
      lastStatus = response.status;
      if (response.ok) {
        const body = await response.json();
        if (body?.access_token) return body.access_token;
      }
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
    throw new Error(`Advertising API OAuth 失败（HTTP ${lastStatus}）`);
  }
  return async function api(path, init = {}) {
    tokenPromise ||= token();
    const response = await fetchAdvertisingResponse(`${API_BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await tokenPromise}`, accept: "application/json", ...(init.headers || {}) },
    }, { fetchImpl });
    const text = await response.text();
    if (!response.ok) throw new Error(`Advertising API 请求失败（HTTP ${response.status}）：${text.slice(0, 160)}`);
    return JSON.parse(text);
  };
}

/**
 * Replace stored rows for each day in [start, end] of one report type.
 * An empty download never wipes a window that already has stored rows: nothing is
 * deleted, no day is marked synced, and a warning is returned instead.
 * @returns {{days: number, rows: number, skippedRows: number, preserved?: boolean, warning?: string}}
 */
export async function saveExtendedReport(db, reportType, start, end, rows, now = new Date().toISOString()) {
  if (!EXTENDED_REPORT_TYPES.includes(reportType)) throw new Error(`不是扩展报表类型：${reportType}`);
  const byDate = new Map();
  let skipped = 0;
  for (const row of rows) {
    const date = rowDate(row);
    if (!date) { skipped += 1; continue; }
    if (date < start || date > end) { skipped += 1; continue; }
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }
  if (rows.length === 0) {
    const existing = await db.prepare("SELECT COUNT(*) AS n FROM ad_report_rows WHERE report_type=? AND report_date>=? AND report_date<=?").bind(reportType, start, end).first();
    const stored = Number(existing?.n ?? 0);
    if (stored > 0) {
      return {
        days: 0, rows: 0, skippedRows: 0, preserved: true,
        warning: `报表为空但 ${start} 至 ${end} 已有 ${stored} 行存量数据：未覆盖、未标记已同步，请稍后重试或人工核对`,
      };
    }
  }
  if (rows.length > 0 && byDate.size === 0) {
    throw new Error("报表有数据但无法识别日期列，已拒绝写入（未改动任何已存数据）");
  }
  // One transaction per day (db.batch is BEGIN…COMMIT): a day is either fully replaced or untouched.
  // A failure part-way through a multi-day window leaves earlier days replaced and later days as they were.
  for (const date of datesBetween(start, end)) {
    const statements = [
      db.prepare("DELETE FROM ad_report_rows WHERE report_type=? AND report_date=?").bind(reportType, date),
      db.prepare("INSERT INTO ad_report_days(report_type,report_date,refreshed_at) VALUES(?,?,?) ON CONFLICT(report_type,report_date) DO UPDATE SET refreshed_at=excluded.refreshed_at").bind(reportType, date, now),
    ];
    for (const [index, row] of (byDate.get(date) || []).entries()) {
      statements.push(db.prepare("INSERT INTO ad_report_rows(report_type,report_date,entity_key,payload,refreshed_at) VALUES(?,?,?,?,?)").bind(reportType, date, entityKeyFor(reportType, row, index), JSON.stringify(row), now));
    }
    await db.batch(statements);
  }
  return { days: datesBetween(start, end).length, rows: rows.length - skipped, skippedRows: skipped };
}

/**
 * Fetch and store the given report types for one window. Types fail independently.
 * @returns {Promise<{type: string, status: "ok"|"warning"|"failed"|"skipped", rows?: number, days?: number, reportId?: string, error?: string}[]>}
 */
export async function syncExtendedReports({ db, env, start, end, types = EXTENDED_REPORT_TYPES, api, fetchImpl, wait, now, pollOptions = {} } = {}) {
  if (!extendedReportsEnabled(env)) return types.map((type) => ({ type, status: "skipped", error: "ADS_EXTENDED_REPORTS_ENABLED 未开启" }));
  assertDate(start, "start");
  assertDate(end, "end");
  await ensureExtendedTables(db);
  const client = api || createAdvertisingApi(env, { fetchImpl });
  const results = [];
  for (const type of types) {
    if (!EXTENDED_REPORT_TYPES.includes(type)) { results.push({ type, status: "failed", error: "不支持的报表类型" }); continue; }
    try {
      const stamp = now || new Date().toISOString();
      const resumeReportId = await readPending(db, type, start, end, stamp);
      const fetched = await fetchReportRows(
        { api: client, fetchImpl, wait, ...pollOptions, resumeReportId: resumeReportId || undefined, onCreated: (id) => writePending(db, type, start, end, id, stamp) },
        { reportType: type, start, end },
      );
      const saved = await saveExtendedReport(db, type, start, end, fetched.rows, now);
      await clearPending(db, type, start, end);
      if (saved.warning) {
        // `error` carries the text too so the 06:00 job records it as a warning like any non-ok step.
        results.push({ type, status: "warning", reportId: fetched.reportId, rows: 0, days: 0, warning: saved.warning, error: saved.warning });
        continue;
      }
      results.push({ type, status: "ok", reportId: fetched.reportId, resumed: Boolean(fetched.resumed), rows: saved.rows, days: saved.days, skippedRows: saved.skippedRows });
    } catch (error) {
      // A report that is merely still running keeps its marker so the next sync resumes it
      // instead of creating another one; a terminally failed report is forgotten.
      if (!(error instanceof ReportStillRunningError)) await clearPending(db, type, start, end);
      results.push({ type, status: "failed", pending: error instanceof ReportStillRunningError, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

/** Manual, chunked history fill. `dryRun` (default) only lists the windows. */
export async function backfillExtendedReports({ db, env, endDate, days = BACKFILL_DEFAULT_DAYS, chunkDays = BACKFILL_CHUNK_DAYS, types = EXTENDED_REPORT_TYPES, dryRun = true, ...deps } = {}) {
  assertDate(endDate, "endDate");
  if (!Number.isInteger(days) || days < 1 || days > 120) throw new Error("days 需在 1–120 之间");
  const windows = [];
  for (let end = endDate; end > addDays(endDate, -days); end = addDays(end, -chunkDays)) {
    const start = addDays(end, -(chunkDays - 1));
    windows.push({ start: start < addDays(endDate, -(days - 1)) ? addDays(endDate, -(days - 1)) : start, end });
  }
  windows.reverse();
  if (dryRun) return { dryRun: true, windows, types };
  const results = [];
  for (const window of windows) results.push({ ...window, results: await syncExtendedReports({ db, env, ...window, types, ...deps }) });
  return { dryRun: false, windows, results };
}

export async function loadExtendedRows(db, reportType, start, end) {
  const stored = await db.prepare("SELECT report_date, payload FROM ad_report_rows WHERE report_type=? AND report_date>=? AND report_date<=? ORDER BY report_date,entity_key")
    .bind(reportType, start, end).all();
  return (stored.results || []).map((item) => ({ ...JSON.parse(item.payload), __report_date: item.report_date }));
}

export async function loadExtendedCoverage(db, reportType, start, end) {
  const ledger = await db.prepare("SELECT report_date, refreshed_at FROM ad_report_days WHERE report_type=? AND report_date>=? AND report_date<=? ORDER BY report_date")
    .bind(reportType, start, end).all();
  const have = new Set((ledger.results || []).map((row) => row.report_date));
  const expected = datesBetween(start, end);
  const refreshed = (ledger.results || []).map((row) => row.refreshed_at).sort();
  return {
    expectedDays: expected.length,
    syncedDays: have.size,
    missingDays: expected.filter((day) => !have.has(day)),
    lastRefreshedAt: refreshed.at(-1) || null,
  };
}
