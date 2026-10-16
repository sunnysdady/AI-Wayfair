/**
 * Read model behind GET /api/ads/keywords and /api/ads/rank.
 * Reads stored rows only. `refresh=1` additionally pulls the report from
 * Wayfair, but only when ADS_EXTENDED_REPORTS_ENABLED=true; otherwise it is a
 * reported no-op. Never writes bids/budgets; output is advisory.
 */
import { lingxingDate } from "./lingxing-business-time.mjs";
import { addDays, assertDate } from "./ads-report-source.mjs";
import {
  extendedReportsEnabled, ensureExtendedTables, loadExtendedCoverage, loadExtendedRows, syncExtendedReports,
} from "./ads-extended-sync.mjs";
import { aggregateKeywords, aggregateRank, listingEconomicsMap } from "./ads-keyword-rank.mjs";
import {
  buildTacosGuard, loadListingReportRows, loadSalesContext, loadSkuCostMap,
} from "./ads-tacos-guard.mjs";

const ATTRIBUTION_DAYS = 14;
const MAX_SPAN_DAYS = 42;

export const KIND = Object.freeze({
  keywords: { reportType: "KEYWORD_PRODUCT_REPORT", label: "关键词表现", program: "SPN" },
  rank: { reportType: "PRODUCT_RANK_REPORT", label: "排名", program: "WSP" },
});

export function resolveRange({ start, end, days, today = lingxingDate() }) {
  const resolvedEnd = end ? assertDate(end, "end") : addDays(today, -1);
  const length = days === undefined || days === null || days === "" ? ATTRIBUTION_DAYS : Number(days);
  if (!Number.isInteger(length) || length < 1 || length > MAX_SPAN_DAYS) throw new Error(`days 需在 1–${MAX_SPAN_DAYS} 之间`);
  const resolvedStart = start ? assertDate(start, "start") : addDays(resolvedEnd, -(length - 1));
  if (resolvedStart > resolvedEnd) throw new Error("开始日期不能晚于结束日期");
  const span = Math.floor((Date.parse(`${resolvedEnd}T00:00:00Z`) - Date.parse(`${resolvedStart}T00:00:00Z`)) / 86400000) + 1;
  if (span > MAX_SPAN_DAYS) throw new Error(`展示周期需在 1–${MAX_SPAN_DAYS} 天内`);
  return { start: resolvedStart, end: resolvedEnd };
}

export async function buildExtendedView({ env, kind, start, end, days, refresh = false, adSpendFn, today = lingxingDate() }) {
  const spec = KIND[kind];
  if (!spec) throw new Error("未知视图");
  const range = resolveRange({ start, end, days, today });
  const db = env.DB;
  const enabled = extendedReportsEnabled(env);
  await ensureExtendedTables(db);

  let sync = null;
  if (refresh) {
    const [result] = await syncExtendedReports({ db, env, ...range, types: [spec.reportType] });
    sync = result;
  }

  const [rows, coverage, costByPart] = await Promise.all([
    loadExtendedRows(db, spec.reportType, range.start, range.end),
    loadExtendedCoverage(db, spec.reportType, range.start, range.end),
    loadSkuCostMap(db),
  ]);

  const matureThrough = addDays(today, -ATTRIBUTION_DAYS);

  // Listing-level economics + TACOS: from the existing listing report and orders.
  let guard = null;
  let guardError = null;
  let listingRows = [];
  try {
    listingRows = await loadListingReportRows(db, range.start, range.end);
    const [sales, adSpend] = await Promise.all([
      loadSalesContext(db, range.start, range.end),
      adSpendFn ? adSpendFn(db, range.start, range.end) : { spend: null, coverage: "UNAVAILABLE" },
    ]);
    guard = buildTacosGuard({ range, adSpend, sales, listingRows, costByPart, matureThrough });
  } catch (error) {
    guardError = error instanceof Error ? error.message : "TACOS 计算失败";
  }

  const listingParts = new Map();
  for (const row of listingRows) {
    const sku = String(row.listing || "");
    if (!sku) continue;
    const parts = String(row.first_10_part_numbers || "").split(",").map((part) => part.trim()).filter(Boolean);
    listingParts.set(sku, [...new Set([...(listingParts.get(sku) || []), ...parts])]);
  }
  const view = kind === "keywords"
    ? aggregateKeywords({ rows, ...range, costByPart, listingParts, matureThrough })
    : aggregateRank({ rows, ...range, listingEconomics: listingEconomicsMap(guard?.listings || [], new Map((guard?.listings || []).filter((row) => row.totalSales !== null).map((row) => [row.listing, row.totalSales])), guard?.account?.coverage) });

  const empty = view.rows.length === 0;
  const hints = [];
  if (!enabled) hints.push("扩展广告报表同步未开启（ADS_EXTENDED_REPORTS_ENABLED），页面只显示库里已有数据。");
  if (empty && coverage.syncedDays === 0) hints.push("还没有同步过这类报表。");
  if (empty && coverage.syncedDays > 0) hints.push(kind === "keywords"
    ? "已同步但没有关键词数据：关键词报表只覆盖关键词类广告（SPN），没有关键词广告时为空是正常的。"
    : "已同步但没有排名数据：排名报表只覆盖 WSP 商品广告。");
  if (kind === "keywords" && view.quality.missingColumns?.length) {
    hints.push(`关键词报表缺少这些列：${view.quality.missingColumns.join("、")}。缺列显示为“—”，不按 0 处理；缺订单列时不判断“零订单”，缺批发额(WSC)时不计算利润贡献。`);
  }
  if (kind === "keywords" && view.quality.duplicateRows > 0) hints.push(`${view.quality.duplicateRows} 行与同日同关键词重复，已合计；请核对报表是否有拆分行。`);
  if (view.quality.columnNotes?.length) hints.push(`列名匹配提示：${view.quality.columnNotes.join("；")}。`);
  if (kind === "rank" && view.quality.rowsUsed > 0) {
    if (view.quality.rowsWithoutRank > 0) hints.push(`${view.quality.rowsWithoutRank} 行没有可识别的排名列，排名为“—”。`);
    if (view.quality.rowsWithoutClassSize > 0) hints.push(`${view.quality.rowsWithoutClassSize} 行没有品类规模（报表本身不提供），位置显示“未知”，只展示排名数值与变化，不给领先/落后判断。`);
  }
  if (kind === "rank") hints.push("排名“建议”尚未用真实报表样本验证（列含义与阈值为推断），标为“待验证”，仅供参考。");
  if (view.quality.rowsWithoutDate > 0) hints.push(`${view.quality.rowsWithoutDate} 行没有可识别的日期，已忽略。`);
  if (guardError) hints.push(`TACOS/利润计算不可用：${guardError}`);

  return {
    kind,
    label: spec.label,
    program: spec.program,
    advisoryOnly: true,
    enabled,
    range,
    tacos: guard ? { line: guard.line, account: guard.account, alerts: guard.alerts, notes: guard.notes } : null,
    coverage,
    sync,
    hints,
    generatedAt: new Date().toISOString(),
    ...view,
  };
}
