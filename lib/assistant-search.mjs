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
  sku_cost: "SKU 成本",
  inventory: "库存",
  order_item: "订单",
  ad_action: "广告动作",
  operation: "运营任务",
  report: "报告",
  daily_brief: "日报",
};

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

export async function searchAssistantKnowledge(db, rawInput, options = {}) {
  const { query, limit } = parseAssistantSearchRequest(rawInput);
  const pattern = likePattern(query);
  const search = await db.prepare(SEARCH_SQL).bind(
    pattern, pattern, pattern, pattern, pattern,
    pattern, pattern, pattern, pattern, pattern, pattern,
    limit,
  ).all();
  const records = Array.isArray(search.results) ? search.results : [];
  const sources = sourceLabels(records);
  const searchedAt = (options.now || (() => new Date().toISOString()))();
  const auditId = (options.idFactory || (() => crypto.randomUUID()))();

  await db.prepare(`
    INSERT INTO assistant_query_audit (id, query_text, result_count, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(auditId, query, records.length, searchedAt).run();

  return {
    answer: answerFor(query, records, sources),
    resultCount: records.length,
    sources,
    records,
    searchedAt,
  };
}
