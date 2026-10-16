/**
 * Advertising report source adapter.
 *
 * Wayfair announced that advertising reports move to a unified reporting
 * platform in 2027 Q1 (new request format, different metrics/date rollups).
 * Everything that knows how to *ask for* and *read* a report lives here so the
 * migration only needs to swap this file. Stored rows keep the raw CSV columns
 * (same convention as `ad_report_rows`), and normalisation happens at read
 * time, so a column rename never requires re-downloading history.
 *
 * Column names of KEYWORD_PRODUCT_REPORT / PRODUCT_RANK_REPORT are not in the
 * public docs, so every reader is alias/pattern based and reports what it
 * could not map instead of guessing.
 */

export const ATTRIBUTION_DAYS = 14;

/** Report types the adapter can request. `program` is dictated by Wayfair. */
export const REPORT_TYPES = Object.freeze({
  CAMPAIGN_REPORT: { program: "WSP", label: "Campaign" },
  LISTING_REPORT: { program: "WSP", label: "Listing" },
  KEYWORD_PRODUCT_REPORT: { program: "SPN", label: "关键词表现" },
  PRODUCT_RANK_REPORT: { program: "WSP", label: "排名" },
});

export const EXTENDED_REPORT_TYPES = Object.freeze(["KEYWORD_PRODUCT_REPORT", "PRODUCT_RANK_REPORT"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(value, name = "date") {
  if (!DATE_RE.test(String(value)) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} 必须是 YYYY-MM-DD`);
  }
  return String(value);
}

export function addDays(value, days) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function datesBetween(start, end) {
  const result = [];
  for (let value = start; value <= end; value = addDays(value, 1)) result.push(value);
  return result;
}

/** POST /advertising/v1/reports body. Create-only: this never touches bids. */
export function buildReportRequest({ reportType, start, end, groupBy = "DAY", namePrefix = "YB" }) {
  const spec = REPORT_TYPES[reportType];
  if (!spec) throw new Error(`不支持的广告报表类型：${reportType}`);
  assertDate(start, "start");
  assertDate(end, "end");
  if (start > end) throw new Error("开始日期不能晚于结束日期");
  return {
    name: `${namePrefix}_${reportType}_${start}_${end}`,
    reportType,
    groupBy,
    program: spec.program,
    fileType: "CSV",
    filters: { startDate: start, endDate: end },
    attributionWindow: ATTRIBUTION_DAYS,
  };
}

export function parseCsv(input) {
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() || [];
  return rows
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

export function canonicalHeader(header) {
  return String(header ?? "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || /^(n\/?a|null|-|--)$/i.test(text)) return null;
  const negative = /^\(.*\)$/.test(text);
  const percent = text.endsWith("%");
  const parsed = Number(text.replace(/[()$,%\s]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  const signed = negative ? -parsed : parsed;
  return percent ? signed / 100 : signed;
}

export function normalizeDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const day = text.slice(0, 10);
    return Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? null : day;
  }
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const day = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    return Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? null : day;
  }
  return null;
}

/**
 * Reader over one raw CSV row with tolerant column lookup.
 * `get(aliases, patterns)` tries exact canonical names first, then regexes;
 * for metrics that carry an attribution-window suffix it prefers `14`.
 */
export function rowReader(raw) {
  const byCanonical = new Map();
  for (const [header, value] of Object.entries(raw || {})) {
    const key = canonicalHeader(header);
    if (key && !byCanonical.has(key)) byCanonical.set(key, { header, value });
  }
  const used = new Set();
  const notes = new Set();
  /**
   * Exact aliases first, then patterns. A column already consumed by an earlier
   * field is never handed out twice. When a pattern matches several columns
   * (e.g. click_through and view_through variants of the same metric) we narrow
   * by the 14-day window, then by `prefer`, and record the choice; if it is
   * still ambiguous we return nothing instead of taking the first one.
   */
  function find(aliases = [], patterns = [], prefer = []) {
    for (const alias of aliases) {
      const hit = byCanonical.get(alias);
      if (hit && !used.has(alias)) return { key: alias, ...hit };
    }
    for (const pattern of patterns) {
      let candidates = [...byCanonical.entries()].filter(([key]) => pattern.test(key) && !used.has(key));
      if (!candidates.length) continue;
      const all = candidates.map(([key]) => key);
      if (candidates.length > 1) {
        const window14 = candidates.filter(([key]) => /(^|_)14(_|$)/.test(key));
        if (window14.length) candidates = window14;
      }
      if (candidates.length > 1) {
        for (const preference of prefer) {
          const narrowed = candidates.filter(([key]) => preference.test(key));
          if (narrowed.length && narrowed.length < candidates.length) { candidates = narrowed; break; }
        }
      }
      if (candidates.length > 1) {
        notes.add(`列 ${all.join(" / ")} 含义不明确，未取值`);
        return null;
      }
      if (all.length > 1) notes.add(`同时存在 ${all.join(" / ")}；选用 ${candidates[0][0]}`);
      return { key: candidates[0][0], ...candidates[0][1] };
    }
    return null;
  }
  return {
    text(aliases, patterns) {
      const hit = find(aliases, patterns);
      if (!hit) return "";
      used.add(hit.key);
      return String(hit.value ?? "").trim();
    },
    num(aliases, patterns, prefer) {
      const hit = find(aliases, patterns, prefer);
      if (!hit) return null;
      used.add(hit.key);
      return parseNumber(hit.value);
    },
    has: (aliases, patterns) => Boolean(find(aliases, patterns)),
    notes: () => [...notes],
    // Headers starting with `__` are loader-injected (e.g. __report_date), not report columns.
    unmapped: () => [...byCanonical.entries()].filter(([key, hit]) => !used.has(key) && !String(hit.header).startsWith("__")).map(([key]) => key),
    headers: () => [...byCanonical.keys()],
  };
}

export function rowDate(raw) {
  return normalizeDate(rowReader(raw).text(["date", "report_date", "day", "reporting_date", "week", "month"]));
}

function clip(value, max = 80) {
  return String(value ?? "").slice(0, max);
}

/** Stable primary-key part for ad_report_rows; the row index keeps true duplicates apart. */
export function entityKeyFor(reportType, raw, index) {
  const r = rowReader(raw);
  const campaign = r.text(["campaign_id", "campaignid"]);
  const sku = r.text(["listing", "wayfair_sku", "sku", "listing_id", "product_sku"]);
  if (reportType === "KEYWORD_PRODUCT_REPORT") {
    const keyword = r.text(["keyword", "keyword_text", "search_keyword", "keyword_name"]);
    const match = r.text(["keyword_match_type", "match_type", "matchtype"]);
    return `${clip(campaign || "unknown", 24)}:${clip(sku || "unknown", 40)}:${clip(keyword || "unknown")}:${clip(match, 20)}:${index}`;
  }
  return `${clip(campaign || "all", 24)}:${clip(sku || "unknown", 40)}:${index}`;
}

const WSC_PATTERN = [/^attributed_wholesale_cost/, /wholesale_cost/];

/** Shared metric block for keyword / listing style rows. */
function readMetrics(r) {
  // Attributed columns exist as click_through / view_through variants in Wayfair reports.
  // We follow the existing campaign/listing model (view_through, Day 14) and note the choice.
  const prefer = [/view_through/];
  const impressions = r.num(["impressions", "impression"]);
  const clicks = r.num(["clicks", "click"]);
  const spend = r.num(["spend_usd", "spend", "ad_spend_usd", "ad_spend"], [/^spend/]);
  const orders = r.num(["attributed_orders", "orders"], [/^attributed_orders/], prefer);
  const units = r.num(["attributed_units", "units"], [/^attributed_units/], prefer);
  const retail = r.num(["attributed_retail_sales", "retail_sales", "sales"], [/^attributed_retail_sales/, /^attributed_sales/], prefer);
  const wsc = r.num([], WSC_PATTERN, prefer);
  const reportedRoas = r.num(["roas", "retail_roas", "return_on_ad_spend"], [/(^|_)roas(_|$)/], prefer);
  return { impressions, clicks, spend, orders, units, retail, wsc, reportedRoas };
}

export function normalizeKeywordRow(raw) {
  const r = rowReader(raw);
  const m = readMetrics(r);
  const row = {
    date: normalizeDate(r.text(["date", "report_date", "day", "reporting_date"])),
    campaignId: r.text(["campaign_id", "campaignid"]),
    campaignName: r.text(["campaign_name", "campaign"]),
    sku: r.text(["listing", "wayfair_sku", "sku", "listing_id", "product_sku"]),
    parts: r.text(["first_10_part_numbers", "part_numbers", "supplier_part_number", "part_number"])
      .split(/[,;|]/).map((part) => part.trim()).filter(Boolean),
    productName: r.text(["product_name", "name"]),
    className: r.text(["class_name", "class"]),
    keyword: r.text(["keyword", "keyword_text", "search_keyword", "keyword_name"]),
    matchType: r.text(["keyword_match_type", "match_type", "matchtype"]),
    maxBid: r.num(["keyword_max_bid", "max_bid", "bid", "keyword_bid"]),
    ...m,
  };
  row.unmapped = r.unmapped();
  row.notes = r.notes();
  return row;
}

export function normalizeRankRow(raw) {
  const r = rowReader(raw);
  // Percentile is read first and `rank` patterns refuse percentile-like names, so a
  // percentile column can never be mistaken for the rank itself.
  const percentile = r.num(["rank_percentile", "percentile", "class_percentile"], [/percentile|(^|_)pct(_|$)|percent/]);
  const rank = r.num(
    ["rank", "sales_rank", "class_rank", "product_rank", "competitive_rank", "rank_in_class", "product_sales_rank"],
    [/^(?!.*(percentile|percent|pct)).*(^|_)rank(_|$)/],
  );
  const classSize = r.num(
    ["class_size", "total_products_in_class", "products_in_class", "total_in_class", "number_of_products_in_class"],
    [/(class|category).*(size|count|total)/, /(total|number).*(products|skus).*(class|category)/],
  );
  const row = {
    date: normalizeDate(r.text(["date", "report_date", "day", "reporting_date"])),
    sku: r.text(["listing", "wayfair_sku", "sku", "listing_id", "product_sku"]),
    parts: r.text(["first_10_part_numbers", "part_numbers", "supplier_part_number", "part_number"])
      .split(/[,;|]/).map((part) => part.trim()).filter(Boolean),
    productName: r.text(["product_name", "name"]),
    className: r.text(["class_name", "class"]),
    rank,
    classSize,
    percentile,
    sales: r.num(["sales", "retail_sales", "total_sales", "product_sales"], [/^(total_)?(retail_)?sales/]),
    adSpend: r.num(["spend_usd", "spend", "ad_spend_usd"], [/^spend/]),
  };
  row.rankMissing = rank === null;
  row.notes = r.notes();
  row.unmapped = r.unmapped();
  return row;
}

/** Which headers a report actually carried, for the trial/diagnostics output. */
export function describeColumns(rows) {
  const headers = new Set();
  for (const raw of rows.slice(0, 50)) for (const key of Object.keys(raw || {})) headers.add(key);
  return [...headers];
}

export const POLL_INTERVAL_MS = 3000;
export const POLL_ATTEMPTS = 60; // ≈3 minutes per report
export class ReportStillRunningError extends Error {
  constructor(reportId) {
    super("广告报表仍在生成，下次同步会继续取同一份报表；数据库会继续保留已有数据");
    this.name = "ReportStillRunningError";
    this.reportId = reportId;
  }
}

/**
 * Create (or resume) → poll → download. `api(path, init)` is injected (token +
 * retry live with the caller) so this stays testable and credential-free.
 * `resumeReportId` skips creation and polls an existing report; `onCreated` lets
 * the caller remember the id so a timeout never leaves an orphan that gets
 * re-created on the next run.
 * @param {{api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>, fetchImpl?: typeof fetch, wait?: (ms:number)=>Promise<void>, polls?: number, pollIntervalMs?: number, resumeReportId?: string, onCreated?: (id: string) => Promise<void>}} deps
 */
export async function fetchReportRows(deps, { reportType, start, end }) {
  const {
    api, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    polls = POLL_ATTEMPTS, pollIntervalMs = POLL_INTERVAL_MS, resumeReportId, onCreated,
  } = deps;
  let reportId = resumeReportId ? String(resumeReportId) : "";
  if (!reportId) {
    const created = await api("/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildReportRequest({ reportType, start, end })),
    });
    reportId = String(created.id || "");
    if (!reportId) throw new Error("Advertising API 未返回 reportId");
    if (onCreated) await onCreated(reportId);
  }
  for (let attempt = 0; attempt < polls; attempt += 1) {
    await wait(pollIntervalMs);
    const status = await api(`/reports?reportId=${encodeURIComponent(reportId)}`);
    if (status.status === "COMPLETED" && status.url) {
      const download = await fetchImpl(String(status.url));
      if (!download.ok) throw new Error(`广告报表下载失败（HTTP ${download.status}）`);
      return { reportId, rows: parseCsv(await download.text()), resumed: Boolean(resumeReportId) };
    }
    if (["FAILED", "ERROR", "CANCELLED"].includes(String(status.status))) {
      const error = new Error(`广告报表生成失败（${status.status}）`);
      error.terminal = true;
      throw error;
    }
  }
  throw new ReportStillRunningError(reportId);
}
