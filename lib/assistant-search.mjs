import { LINGXING_TIME_ZONE } from "./lingxing-business-time.mjs";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;
const MAX_QUERY_LENGTH = 120;

export class AssistantSearchInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssistantSearchInputError";
  }
}

export function parseAssistantSearchRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AssistantSearchInputError("请求体必须是对象");
  }
  if (typeof input.query !== "string") {
    throw new AssistantSearchInputError("请输入要查询的 SKU、订单号或关键词");
  }

  const query = input.query.trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    throw new AssistantSearchInputError(`查询内容需为 2–${MAX_QUERY_LENGTH} 个字符`);
  }

  const limit = input.limit === undefined ? DEFAULT_LIMIT : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new AssistantSearchInputError(`结果数量需为 1–${MAX_LIMIT} 的整数`);
  }
  return { query, limit };
}

function likePattern(query) {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

const SOURCE_LABELS = {
  daily_sales: "日销售汇总",
  sku_cost: "SKU 成本",
  inventory: "库存",
  order_item: "订单",
  ad_action: "广告动作",
  operation: "运营任务",
  report: "报告",
  daily_brief: "日报",
  daily_report: "运营日报",
  inventory_shortage: "缺货库存",
};

const DAILY_SALES_SQL = `
  WITH requested_day AS (SELECT ?::date AS value)
  SELECT
    COUNT(*) AS orders,
    COALESCE(SUM(units), 0) AS units,
    COALESCE(SUM(revenue_cents), 0) AS revenue_cents
  FROM orders, requested_day
  WHERE po_date >= (requested_day.value::timestamp AT TIME ZONE '${LINGXING_TIME_ZONE}')
    AND po_date < ((requested_day.value + INTERVAL '1 day')::timestamp AT TIME ZONE '${LINGXING_TIME_ZONE}')
    AND revenue_cents > 0
`;

const DAILY_SALES_TERMS = /销量|销售额|销售|营收|成交|gmv|订单(?:量|数)?|多少(?:单|件)|卖(?:了)?多少/i;

const SKU_MONTH_ORDERS_SQL = `
  WITH requested_sku AS (SELECT ?::TEXT AS value),
       requested_month AS (SELECT ?::date AS first_day)
  SELECT
    MAX(items.part_number) AS part_number,
    COUNT(DISTINCT orders.po_number) AS orders,
    COALESCE(SUM(items.quantity), 0) AS units,
    COALESCE(SUM(items.quantity * items.unit_price_cents), 0) AS revenue_cents
  FROM orders
  JOIN order_items items ON items.po_number = orders.po_number
  CROSS JOIN requested_sku
  CROSS JOIN requested_month
  WHERE items.part_number = requested_sku.value
    AND orders.po_date >= (requested_month.first_day::timestamp AT TIME ZONE '${LINGXING_TIME_ZONE}')
    AND orders.po_date < ((requested_month.first_day + INTERVAL '1 month')::timestamp AT TIME ZONE '${LINGXING_TIME_ZONE}')
`;

const SKU_PATTERN = /(?<![A-Z0-9-])([A-Z][A-Z0-9-]{2,})(?![A-Z0-9-])/gi;

// ─── 意图识别：把自然语言映射到数据域 ────────────────────────────────────────

const INTENT_PATTERNS = {
  inventory: /库存|现货|在途|缺货|断货|仓库|补货|可售|supply|stock|inventory/i,
  cost: /成本|进价|采购价|供货价|单价|cost|价格/i,
  order: /订单|采购|下单|po\b|到货|补单/i,
  ad: /广告|campaign|投放|roas|花费|广告费|ads/i,
  task: /任务|待办|跟进|待处理|运营(?:动作)?|todo/i,
  report: /报告|周报|月报|报表|复盘|review/i,
  daily: /日报|每日运营|今天运营|今日运营|daily/i,
};

const SHORTAGE_TERMS = /缺货|断货|库存风险|无货|售罄|补货|零库存/i;

/** 识别意图域，返回第一个命中的意图名（或 null）。 */
export function detectIntent(query) {
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(query)) return intent;
  }
  return null;
}

function dateString(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return candidate.toISOString().slice(0, 10);
}

function currentYear(now) {
  const candidate = new Date(now);
  return Number.isNaN(candidate.getTime()) ? new Date().getUTCFullYear() : candidate.getUTCFullYear();
}

function monthStart(year, month) {
  return dateString(year, month, 1);
}

function skuIn(query) {
  const matches = [...query.matchAll(SKU_PATTERN)]
    .map((match) => match[1].toUpperCase())
    .filter((value) => /\d/.test(value));
  return matches[0] || null;
}

function monthIn(query, now) {
  const fullMonth = query.match(/(20\d{2})年\s*(\d{1,2})月/);
  const shortMonth = query.match(/(?:^|\D)(\d{1,2})\s*月/);
  const year = fullMonth ? Number(fullMonth[1]) : currentYear(now);
  const month = Number(fullMonth ? fullMonth[2] : shortMonth?.[1]);
  return Number.isInteger(month) ? monthStart(year, month) : null;
}

export function resolveAssistantCommand(query, now = new Date().toISOString()) {
  if (!DAILY_SALES_TERMS.test(query)) return null;

  const fullDate = query.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
  const shortDate = query.match(/(?:^|\D)(\d{1,2})[月./-](\d{1,2})日?(?:\D|$)/);
  const date = fullDate
    ? dateString(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]))
    : shortDate
      ? dateString(currentYear(now), Number(shortDate[1]), Number(shortDate[2]))
      : null;

  if (date) {
    return {
      type: "daily_sales",
      date,
      description: `查询 ${date} 的订单、销量和销售额`,
    };
  }

  const sku = skuIn(query);
  const monthStartDate = sku ? monthIn(query, now) : null;
  if (!sku || !monthStartDate) return null;
  const month = monthStartDate.slice(0, 7);
  return {
    type: "sku_month_orders",
    sku,
    month,
    description: `查询 SKU ${sku} 在 ${month} 的订单、销量和销售额`,
  };
}

// ─── 意图定向 SQL ───────────────────────────────────────────────────────────

const LATEST_SNAPSHOT_SUBQUERY = `(SELECT id FROM inventory_snapshots ORDER BY created_at DESC LIMIT 1)`;

const INVENTORY_SHORTAGE_SQL = `
  SELECT rows.part_number, rows.quantity_on_hand, rows.quantity_on_order, rows.warehouse, snapshots.created_at
  FROM inventory_snapshot_rows rows
  JOIN inventory_snapshots snapshots ON snapshots.id = rows.snapshot_id
  WHERE snapshots.id = ${LATEST_SNAPSHOT_SUBQUERY}
    AND rows.quantity_on_hand = 0
  ORDER BY rows.quantity_on_order DESC
  LIMIT ?
`;

const INVENTORY_SKU_SQL = `
  SELECT rows.part_number, rows.quantity_on_hand, rows.quantity_on_order, rows.warehouse, snapshots.created_at
  FROM inventory_snapshot_rows rows
  JOIN inventory_snapshots snapshots ON snapshots.id = rows.snapshot_id
  WHERE snapshots.id = ${LATEST_SNAPSHOT_SUBQUERY}
    AND rows.part_number ILIKE ? ESCAPE '\\'
  ORDER BY rows.quantity_on_hand DESC
  LIMIT ?
`;

const INVENTORY_OVERVIEW_SQL = `
  SELECT
    COUNT(DISTINCT rows.part_number) AS skus,
    COALESCE(SUM(rows.quantity_on_hand), 0) AS on_hand,
    COALESCE(SUM(rows.quantity_on_order), 0) AS on_order,
    snapshots.created_at
  FROM inventory_snapshot_rows rows
  JOIN inventory_snapshots snapshots ON snapshots.id = rows.snapshot_id
  WHERE snapshots.id = ${LATEST_SNAPSHOT_SUBQUERY}
`;

const COST_SKU_SQL = `
  SELECT part_number, unit_cost_cents, currency, updated_at
  FROM sku_costs
  WHERE part_number ILIKE ? ESCAPE '\\'
  ORDER BY updated_at DESC
  LIMIT ?
`;

const LATEST_DAILY_REPORT_SQL = `
  SELECT report_date, payload, generated_at
  FROM daily_operating_reports
  ORDER BY generated_at DESC
  LIMIT 1
`;

const LATEST_DAILY_BRIEF_SQL = `
  SELECT brief_date, payload, synced_at
  FROM outlook_daily_briefs
  ORDER BY synced_at DESC
  LIMIT 1
`;

const RECENT_AD_ACTIONS_SQL = `
  SELECT listing, action_type, campaign_id, status, updated_at
  FROM ad_action_queue
  ORDER BY updated_at DESC
  LIMIT ?
`;

const RECENT_TASKS_SQL = `
  SELECT id, title, owner, status, updated_at
  FROM operations
  ORDER BY updated_at DESC
  LIMIT ?
`;

const RECENT_ORDERS_SQL = `
  SELECT po_number, po_date, revenue_cents, units, item_count
  FROM orders
  ORDER BY po_date DESC
  LIMIT ?
`;

const REPORTS_SQL = `
  SELECT title, kind, file_name, created_at
  FROM report_uploads
  ORDER BY created_at DESC
  LIMIT ?
`;

const SEARCH_SQL = `
  SELECT source, reference, title, detail, occurred_at
  FROM (
    SELECT
      'sku_cost' AS source,
      part_number AS reference,
      'SKU 成本' AS title,
      '成本 $' || ROUND(unit_cost_cents::NUMERIC / 100, 2)::TEXT || ' · ' || currency AS detail,
      updated_at AS occurred_at
    FROM sku_costs
    WHERE part_number ILIKE ? ESCAPE '\\'

    UNION ALL

    SELECT
      'inventory' AS source,
      rows.part_number AS reference,
      '最新库存' AS title,
      '现货 ' || rows.quantity_on_hand::TEXT || ' · 在途 ' || rows.quantity_on_order::TEXT || ' · 仓库 ' || rows.warehouse AS detail,
      snapshots.created_at AS occurred_at
    FROM inventory_snapshot_rows rows
    JOIN inventory_snapshots snapshots ON snapshots.id = rows.snapshot_id
    WHERE snapshots.id = ${LATEST_SNAPSHOT_SUBQUERY}
      AND rows.part_number ILIKE ? ESCAPE '\\'

    UNION ALL

    SELECT
      'order_item' AS source,
      items.part_number AS reference,
      '订单 SKU' AS title,
      COUNT(DISTINCT orders.po_number)::TEXT || ' 个采购订单 · ' || COALESCE(SUM(items.quantity), 0)::TEXT || ' 件' AS detail,
      MAX(orders.po_date)::TEXT AS occurred_at
    FROM order_items items
    JOIN orders ON orders.po_number = items.po_number
    WHERE items.part_number ILIKE ? ESCAPE '\\'
    GROUP BY items.part_number

    UNION ALL

    SELECT
      'ad_action' AS source,
      listing AS reference,
      '广告动作 · ' || action_type AS title,
      status || ' · Campaign ' || campaign_id AS detail,
      updated_at AS occurred_at
    FROM ad_action_queue
    WHERE listing ILIKE ? ESCAPE '\\' OR campaign_id ILIKE ? ESCAPE '\\'

    UNION ALL

    SELECT
      'operation' AS source,
      id AS reference,
      title,
      status || ' · ' || owner AS detail,
      updated_at::TEXT AS occurred_at
    FROM operations
    WHERE title ILIKE ? ESCAPE '\\'
      OR object_id ILIKE ? ESCAPE '\\'
      OR source_id ILIKE ? ESCAPE '\\'

    UNION ALL

    SELECT
      'report' AS source,
      id AS reference,
      title,
      kind || ' · ' || file_name AS detail,
      created_at AS occurred_at
    FROM report_uploads
    WHERE title ILIKE ? ESCAPE '\\' OR file_name ILIKE ? ESCAPE '\\'

    UNION ALL

    SELECT
      'daily_brief' AS source,
      brief_date AS reference,
      '已存档 Outlook 日报' AS title,
      '日报日期 ' || brief_date AS detail,
      synced_at AS occurred_at
    FROM outlook_daily_briefs
    WHERE payload ILIKE ? ESCAPE '\\'
  ) matches
  ORDER BY occurred_at DESC NULLS LAST
  LIMIT ?
`;

// ─── 意图命令解析与知识构建 ─────────────────────────────────────────────────

function resolveIntentCommand(query, now) {
  const sku = skuIn(query);
  const intent = detectIntent(query);

  if (intent === "inventory" && SHORTAGE_TERMS.test(query)) {
    return { type: "inventory_shortage", description: "查询最新快照中现货为零的 SKU（缺货清单）" };
  }
  if (intent === "inventory" && sku) {
    return { type: "inventory_sku", sku, description: `查询 SKU ${sku} 的最新库存（现货、在途、仓库）` };
  }
  if (intent === "inventory") {
    return { type: "inventory_overview", description: "查询最新库存快照的 SKU 数、现货与在途总量" };
  }
  if (intent === "cost" && sku) {
    return { type: "cost_sku", sku, description: `查询 SKU ${sku} 的成本` };
  }
  if (intent === "daily") {
    return { type: "daily_report", description: "查询最新运营日报与 Outlook 邮件日报" };
  }
  if (intent === "ad") {
    return { type: "ad_actions", description: "查询最近记录的广告动作" };
  }
  if (intent === "task") {
    return { type: "tasks", description: "查询最近的运营任务" };
  }
  if (intent === "order") {
    return { type: "orders_recent", description: "查询最近的采购订单" };
  }
  if (intent === "report") {
    return { type: "reports", description: "查询已上传的报告" };
  }
  return null;
}

function parseJsonObject(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function money(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function knowledgeForIntentCommand(command, search) {
  const rows = Array.isArray(search.results) ? search.results : [];
  switch (command.type) {
    case "inventory_shortage": {
      if (rows.length === 0) {
        return {
          answer: `最新库存快照（${search.snapshotDate || "最近一次"}）中未发现现货为零的 SKU。`,
          records: [],
        };
      }
      const skus = rows.slice(0, 8).map((row) => `${row.part_number}（现货 0 · 在途 ${row.quantity_on_order} · ${row.warehouse}）`).join("；");
      return {
        answer: `最新库存快照（${search.snapshotDate || ""}）中缺货（现货为 0）的 SKU 共 ${rows.length} 个：${skus}。`,
        records: rows.map((row) => ({
          source: "inventory_shortage",
          reference: row.part_number,
          title: "缺货 SKU",
          detail: `现货 0 · 在途 ${row.quantity_on_order} · 仓库 ${row.warehouse}`,
          occurred_at: row.created_at,
        })),
      };
    }
    case "inventory_sku": {
      if (rows.length === 0) {
        return { answer: `未在最新库存快照中找到 ${command.sku} 的库存记录。`, records: [] };
      }
      const lines = rows.slice(0, 3).map((row) =>
        `${row.part_number}：现货 ${row.quantity_on_hand} · 在途 ${row.quantity_on_order} · 仓库 ${row.warehouse}`);
      return {
        answer: `${command.sku} 当前库存（快照 ${search.snapshotDate || "最近一次"}）：${lines.join("；")}。`,
        records: rows.map((row) => ({
          source: "inventory",
          reference: row.part_number,
          title: "最新库存",
          detail: `现货 ${row.quantity_on_hand} · 在途 ${row.quantity_on_order} · 仓库 ${row.warehouse}`,
          occurred_at: row.created_at,
        })),
      };
    }
    case "inventory_overview": {
      const row = rows[0];
      if (!row) return { answer: "暂无库存快照数据。", records: [] };
      return {
        answer: `最新库存快照（${row.created_at || ""}）覆盖 ${row.skus} 个 SKU，现货合计 ${row.on_hand} 件，在途合计 ${row.on_order} 件。`,
        records: [{
          source: "inventory",
          reference: "overview",
          title: "库存概览",
          detail: `SKU ${row.skus} · 现货 ${row.on_hand} · 在途 ${row.on_order}`,
          occurred_at: row.created_at,
        }],
      };
    }
    case "cost_sku": {
      if (rows.length === 0) {
        return { answer: `未找到 ${command.sku} 的成本记录。`, records: [] };
      }
      const lines = rows.slice(0, 3).map((row) => `${row.part_number}：成本 ${money(row.unit_cost_cents)}（${row.currency}）`).join("；");
      return {
        answer: `${command.sku} 成本：${lines}。`,
        records: rows.map((row) => ({
          source: "sku_cost",
          reference: row.part_number,
          title: "SKU 成本",
          detail: `成本 ${money(row.unit_cost_cents)} · ${row.currency}`,
          occurred_at: row.updated_at,
        })),
      };
    }
    case "daily_report": {
      const report = rows.find((row) => row.report_date);
      const brief = rows.find((row) => row.brief_date);
      const parts = [];
      if (report) {
        const payload = parseJsonObject(report.payload);
        const perf = payload?.performance?.daily || {};
        const delta = payload?.performance?.delta || {};
        parts.push(
          `运营日报（${report.report_date}）：订单 ${perf.orders ?? "—"}、销量 ${perf.units ?? "—"}、收入 ${perf.revenue != null ? `$${perf.revenue}` : "—"}、广告花费 ${perf.adSpend != null ? `$${perf.adSpend}` : "—"}、广告后贡献 ${perf.contributionAfterAds != null ? `$${perf.contributionAfterAds}` : "—"}` +
          (delta.orders != null ? `（订单较前日 ${delta.orders > 0 ? "+" : ""}${delta.orders}）` : "")
        );
      }
      if (brief) {
        const payload = parseJsonObject(brief.payload);
        const summary = payload?.summary || {};
        parts.push(
          `Outlook 日报（${brief.brief_date}）：邮件 ${summary.total ?? "—"} 封、待处理 ${summary.actionRequired ?? "—"} 项、最高优先级 ${summary.highestPriority ?? "—"}`
        );
      }
      if (parts.length === 0) return { answer: "暂无已存档的日报数据。", records: [] };
      return {
        answer: parts.join("；"),
        records: [
          ...(report ? [{
            source: "daily_report",
            reference: report.report_date,
            title: "每日运营报告",
            detail: parts[0],
            occurred_at: report.generated_at,
          }] : []),
          ...(brief ? [{
            source: "daily_brief",
            reference: brief.brief_date,
            title: "Outlook 日报",
            detail: parts[parts.length - 1],
            occurred_at: brief.synced_at,
          }] : []),
        ],
      };
    }
    case "ad_actions": {
      if (rows.length === 0) return { answer: "暂无已记录的广告动作。", records: [] };
      const lines = rows.map((row) =>
        `${row.listing}：${row.action_type}（${row.status} · Campaign ${row.campaign_id}）`).join("；");
      return {
        answer: `最近广告动作 ${rows.length} 条：${lines}。`,
        records: rows.map((row) => ({
          source: "ad_action",
          reference: row.listing,
          title: `广告动作 · ${row.action_type}`,
          detail: `${row.status} · Campaign ${row.campaign_id}`,
          occurred_at: row.updated_at,
        })),
      };
    }
    case "tasks": {
      if (rows.length === 0) return { answer: "暂无运营任务记录。", records: [] };
      const lines = rows.map((row) => `${row.title}（${row.status} · ${row.owner}）`).join("；");
      return {
        answer: `最近运营任务 ${rows.length} 条：${lines}。`,
        records: rows.map((row) => ({
          source: "operation",
          reference: row.id,
          title: row.title,
          detail: `${row.status} · ${row.owner}`,
          occurred_at: row.updated_at,
        })),
      };
    }
    case "orders_recent": {
      if (rows.length === 0) return { answer: "暂无订单记录。", records: [] };
      const lines = rows.map((row) =>
        `${row.po_number}（${String(row.po_date || "").slice(0, 10)} · ${row.units} 件 · ${money(row.revenue_cents)}）`).join("；");
      return {
        answer: `最近采购订单 ${rows.length} 条：${lines}。`,
        records: rows.map((row) => ({
          source: "order_item",
          reference: row.po_number,
          title: "采购订单",
          detail: `${row.units} 件 · ${money(row.revenue_cents)}`,
          occurred_at: row.po_date,
        })),
      };
    }
    case "reports": {
      if (rows.length === 0) return { answer: "暂无已上传的报告。", records: [] };
      const lines = rows.map((row) => `${row.title}（${row.kind} · ${row.file_name}）`).join("；");
      return {
        answer: `已存报告 ${rows.length} 份：${lines}。`,
        records: rows.map((row) => ({
          source: "report",
          reference: row.id,
          title: row.title,
          detail: `${row.kind} · ${row.file_name}`,
          occurred_at: row.created_at,
        })),
      };
    }
    default:
      return null;
  }
}

function intentSearchSql(command) {
  switch (command.type) {
    case "inventory_shortage": return { sql: INVENTORY_SHORTAGE_SQL, bind: (limit) => [limit] };
    case "inventory_sku": return { sql: INVENTORY_SKU_SQL, bind: (limit, commandValue) => [likePattern(commandValue.sku), limit] };
    case "inventory_overview": return { sql: INVENTORY_OVERVIEW_SQL, bind: () => [] };
    case "cost_sku": return { sql: COST_SKU_SQL, bind: (limit, commandValue) => [likePattern(commandValue.sku), limit] };
    case "daily_report": return { sql: LATEST_DAILY_REPORT_SQL, bind: () => [] };
    case "ad_actions": return { sql: RECENT_AD_ACTIONS_SQL, bind: (limit) => [limit] };
    case "tasks": return { sql: RECENT_TASKS_SQL, bind: (limit) => [limit] };
    case "orders_recent": return { sql: RECENT_ORDERS_SQL, bind: (limit) => [limit] };
    case "reports": return { sql: REPORTS_SQL, bind: (limit) => [limit] };
    default: return null;
  }
}

function sourceLabels(rows) {
  return [...new Set(rows.map((row) => SOURCE_LABELS[row.source] || row.source))];
}

function answerFor(query, rows, sources) {
  if (rows.length === 0) {
    return `未在已同步的数据中找到与“${query}”相关的记录。可尝试完整 SKU、采购订单号或报告标题。`;
  }
  return `已从${sources.join("、")}找到 ${rows.length} 条与“${query}”相关的已保存记录。`;
}

function dailySalesKnowledge(command, search) {
  const row = Array.isArray(search.results) ? search.results[0] : null;
  const orders = Number(row?.orders || 0);
  const units = Number(row?.units || 0);
  const revenueCents = Number(row?.revenue_cents || 0);
  const revenue = (revenueCents / 100).toFixed(2);
  const detail = `销量 ${units} 件 · 订单 ${orders} 个 · 销售额 $${revenue}`;
  return {
    answer: `${command.date} 的销量为 ${units} 件，共 ${orders} 个订单，销售额 $${revenue}。`,
    records: [{
      source: "daily_sales",
      reference: command.date,
      title: "日销售汇总",
      detail,
      occurred_at: command.date,
    }],
  };
}

function skuMonthOrdersKnowledge(command, search) {
  const row = Array.isArray(search.results) ? search.results[0] : null;
  const orders = Number(row?.orders || 0);
  const units = Number(row?.units || 0);
  const revenueCents = Number(row?.revenue_cents || 0);
  const revenue = (revenueCents / 100).toFixed(2);
  const detail = `${command.month} · 订单 ${orders} 个 · 销量 ${units} 件 · 销售额 $${revenue}`;
  return {
    answer: `${command.sku} 在 ${command.month} 共 ${orders} 个采购订单，销量 ${units} 件，销售额 $${revenue}。`,
    records: [{
      source: "order_item",
      reference: command.sku,
      title: "SKU 月度订单汇总",
      detail,
      occurred_at: command.month,
    }],
  };
}

export async function searchAssistantKnowledge(db, rawInput, options = {}) {
  const { query, limit } = parseAssistantSearchRequest(rawInput);
  const searchedAt = (options.now || (() => new Date().toISOString()))();
  const command = resolveAssistantCommand(query, searchedAt);
  const intentCommand = command ? null : resolveIntentCommand(query, searchedAt);

  let search;
  if (command?.type === "daily_sales") {
    search = await db.prepare(DAILY_SALES_SQL).bind(command.date).all();
  } else if (command?.type === "sku_month_orders") {
    search = await db.prepare(SKU_MONTH_ORDERS_SQL).bind(command.sku, `${command.month}-01`).all();
  } else if (intentCommand) {
    if (intentCommand.type === "daily_report") {
      const [report, brief] = await Promise.all([
        db.prepare(LATEST_DAILY_REPORT_SQL).bind().all(),
        db.prepare(LATEST_DAILY_BRIEF_SQL).bind().all(),
      ]);
      search = {
        results: [
          ...(Array.isArray(report.results) ? report.results : []),
          ...(Array.isArray(brief.results) ? brief.results : []),
        ],
      };
    } else {
      const mapping = intentSearchSql(intentCommand);
      search = await db.prepare(mapping.sql).bind(...mapping.bind(limit, intentCommand)).all();
    }
    search = {
      ...search,
      snapshotDate: search.results?.[0]?.created_at
        ? String(search.results[0].created_at).slice(0, 10)
        : null,
    };
  } else {
    search = await db.prepare(SEARCH_SQL).bind(
      ...Array(11).fill(likePattern(query)),
      limit,
    ).all();
  }

  const interpreted = command?.type === "daily_sales"
    ? dailySalesKnowledge(command, search)
    : command?.type === "sku_month_orders"
      ? skuMonthOrdersKnowledge(command, search)
      : intentCommand
        ? knowledgeForIntentCommand(intentCommand, search)
        : null;
  const records = interpreted?.records || (Array.isArray(search.results) ? search.results : []);
  const sources = sourceLabels(records);
  const auditId = (options.idFactory || (() => crypto.randomUUID()))();

  await db.prepare(`
    INSERT INTO assistant_query_audit (id, query_text, result_count, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(auditId, query, records.length, searchedAt).run();

  return {
    answer: interpreted?.answer || answerFor(query, records, sources),
    command: command || intentCommand,
    resultCount: records.length,
    sources,
    records,
    searchedAt,
  };
}
