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
    WHERE snapshots.id = (
      SELECT id FROM inventory_snapshots ORDER BY created_at DESC LIMIT 1
    )
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
  const search = command?.type === "daily_sales"
    ? await db.prepare(DAILY_SALES_SQL).bind(command.date).all()
    : command?.type === "sku_month_orders"
      ? await db.prepare(SKU_MONTH_ORDERS_SQL).bind(command.sku, `${command.month}-01`).all()
      : await db.prepare(SEARCH_SQL).bind(
      ...Array(11).fill(likePattern(query)),
      limit,
    ).all();
  const interpreted = command?.type === "daily_sales"
    ? dailySalesKnowledge(command, search)
    : command?.type === "sku_month_orders"
      ? skuMonthOrdersKnowledge(command, search)
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
    command,
    resultCount: records.length,
    sources,
    records,
    searchedAt,
  };
}
