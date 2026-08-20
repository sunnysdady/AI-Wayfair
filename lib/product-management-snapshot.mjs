const MAX_ITEMS = 10_000;
const PART_NUMBER = /^[^\u0000-\u001f]{1,160}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function finiteMetric(value, label, index) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`第 ${index + 1} 行 ${label} 必须是有限数字或空值`);
  }
  return value;
}

function text(value, label, index, { required = false } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new Error(`第 ${index + 1} 行缺少 ${label}`);
    return "";
  }
  if (typeof value !== "string") throw new Error(`第 ${index + 1} 行 ${label} 必须是文本`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`第 ${index + 1} 行缺少 ${label}`);
  return normalized;
}

export function validateProductManagementSnapshot(input, { now = new Date() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("快照必须是对象");
  const snapshot = input;
  if (snapshot.schemaVersion !== 1) throw new Error("仅接受 schemaVersion=1 的 Product Management 快照");
  if (snapshot.sourceWindow !== "last_90_days") throw new Error("Product Management 快照必须使用 last_90_days 窗口");
  if (!/^\d+$/.test(String(snapshot.storeId || ""))) throw new Error("快照缺少有效 Store ID");
  if (typeof snapshot.extractedAt !== "string" || !Number.isFinite(Date.parse(snapshot.extractedAt))) {
    throw new Error("快照缺少有效 extractedAt");
  }
  if (Date.parse(snapshot.extractedAt) > now.getTime() + 10 * 60 * 1000) {
    throw new Error("快照 extractedAt 不能晚于当前时间 10 分钟以上");
  }
  if (!Array.isArray(snapshot.items) || snapshot.items.length === 0 || snapshot.items.length > MAX_ITEMS) {
    throw new Error(`items 必须是 1–${MAX_ITEMS} 条记录`);
  }
  if (snapshot.itemCount !== snapshot.items.length) throw new Error("itemCount 与 items 条数不一致");

  const seenParts = new Set();
  const seenSkus = new Set();
  let duplicateSkuRows = 0;
  let revenue90d = 0;
  let unitsSold90d = 0;
  for (const [index, row] of snapshot.items.entries()) {
    if (!Array.isArray(row) || (row.length !== 13 && row.length !== 14)) {
      throw new Error(`第 ${index + 1} 行必须包含 13 或 14 个字段`);
    }
    const partNumber = text(row[0], "Supplier Part #", index, { required: true });
    if (!PART_NUMBER.test(partNumber)) throw new Error(`第 ${index + 1} 行 Supplier Part # 格式无效`);
    if (seenParts.has(partNumber)) throw new Error(`Supplier Part # 重复：${partNumber}`);
    seenParts.add(partNumber);
    text(row[1], "状态", index, { required: true });
    const launchDate = text(row[6], "上架日期", index);
    if (launchDate && !ISO_DAY.test(launchDate)) throw new Error(`第 ${index + 1} 行上架日期格式无效`);
    const wayfairSku = text(row[7], "Wayfair SKU", index);
    if (wayfairSku) {
      // A single listing can legitimately contain multiple supplier parts; retain that lineage.
      if (seenSkus.has(wayfairSku)) duplicateSkuRows += 1;
      seenSkus.add(wayfairSku);
    }
    finiteMetric(row[2], "销量趋势", index);
    const revenue = finiteMetric(row[3], "90 天销售额", index);
    const units = finiteMetric(row[4], "90 天销量", index);
    const conversionRatePct = finiteMetric(row[5], "转化率", index);
    const uniqueVisits90d = finiteMetric(row[8], "访客数", index);
    const totalImpressions90d = finiteMetric(row[9], "曝光量", index);
    const impressionPercentile = finiteMetric(row[10], "曝光分位", index);
    const averageReviewRating = finiteMetric(row[11], "评分", index);
    const reviewCount = finiteMetric(row[12], "评价数", index);
    // Sales trend is a signed change metric; all base/count/rate metrics are non-negative.
    if ([revenue, units, conversionRatePct, uniqueVisits90d, totalImpressions90d, impressionPercentile, averageReviewRating, reviewCount].some((value) => value !== null && value < 0)) {
      throw new Error(`第 ${index + 1} 行运营指标不能为负数`);
    }
    if (revenue !== null) revenue90d += revenue;
    if (units !== null) unitsSold90d += units;
  }

  return {
    snapshot,
    audit: {
      schemaVersion: snapshot.schemaVersion,
      source: String(snapshot.source || "Product Management"),
      sourceWindow: snapshot.sourceWindow,
      storeId: String(snapshot.storeId),
      extractedAt: snapshot.extractedAt,
      rowCount: snapshot.items.length,
      uniquePartCount: seenParts.size,
      uniqueSkuCount: seenSkus.size,
      duplicateSkuRows,
      revenue90d: Number(revenue90d.toFixed(2)),
      unitsSold90d,
    },
  };
}
