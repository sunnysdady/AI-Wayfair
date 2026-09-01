export const FULFILLMENT_COLUMNS = [
  ["A", "日期", "orderDate"],
  ["B", "系统单号", "systemOrderNumber"],
  ["C", "单号", "orderNumber"],
  ["D", "国家", "country"],
  ["E", "客人姓名", "customerName"],
  ["F", "地址1", "addressLine1"],
  ["G", "地址2", "addressLine2"],
  ["H", "城市", "city"],
  ["I", "州", "stateRegion"],
  ["J", "邮编", "postalCode"],
  ["K", "电话", "phone"],
  ["L", "云仓SKU编码", "warehouseSkuCode"],
  ["M", "跟踪号", "trackingNumber"],
  ["N", "SKU", "sku"],
  ["O", "数量", "quantity"],
  ["P", "发货状态", "shippingStatus"],
];

export const FULFILLMENT_FORMAL_START_DATE = "2026-09-01";
export const FULFILLMENT_STATUSES = ["待获取面单", "SKU待映射", "面单待核验", "已归档面单", "待出库", "已出库", "已发货", "异常"];

const TEXT_FIELDS = {
  sourceKey: ["来源键", 242, true],
  source: ["来源", 80, true],
  orderDate: ["日期", 10, false],
  systemOrderNumber: ["系统单号", 242, false],
  parentOrderNumber: ["原始订单号", 242, true],
  orderNumber: ["单号", 242, true],
  country: ["国家", 3, false],
  customerName: ["客人姓名", 240, false],
  addressLine1: ["地址1", 500, false],
  addressLine2: ["地址2", 500, false],
  city: ["城市", 160, false],
  stateRegion: ["州", 160, false],
  postalCode: ["邮编", 40, false],
  phone: ["电话", 80, false],
  warehouseSkuCode: ["云仓SKU编码", 242, false],
  trackingNumber: ["跟踪号", 242, false],
  sku: ["SKU", 242, false],
  shippingStatus: ["发货状态", 80, false],
  labelObjectKey: ["面单对象键", 1_000, false],
  labelFileName: ["面单文件名", 300, false],
};

function safeText(value, name, maxLength, required) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw new Error(`${name}不能为空`);
  if (normalized.length > maxLength) throw new Error(`${name}不能超过 ${maxLength} 个字符`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name}包含无效控制字符`);
  return normalized;
}

function quantity(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized !== 1) {
    throw new Error("拆分包裹数量必须是 1");
  }
  return normalized;
}

function date(value) {
  const normalized = String(value ?? "").trim();
  if (normalized && (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`)))) {
    throw new Error("日期必须是 YYYY-MM-DD");
  }
  return normalized;
}

export function labelFileNameForOrder(orderNumber) {
  const normalized = safeText(orderNumber, "单号", 242, true);
  const safeName = normalized.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[_\.]+|[_\.]+$/g, "");
  if (!safeName) throw new Error("单号无法生成安全的面单文件名");
  return `${safeName}.pdf`;
}

export function validateFulfillmentRecord(input = {}) {
  const normalized = {};
  for (const [field, [name, maxLength, required]] of Object.entries(TEXT_FIELDS)) {
    normalized[field] = safeText(input[field], name, maxLength, required);
  }
  normalized.orderDate = date(input.orderDate);
  normalized.country = normalized.country.toUpperCase();
  if (normalized.country && !/^[A-Z]{2,3}$/.test(normalized.country)) throw new Error("国家必须是 2 或 3 位国家代码");
  normalized.quantity = quantity(input.quantity);
  if (normalized.orderNumber !== normalized.parentOrderNumber && !normalized.orderNumber.startsWith(`${normalized.parentOrderNumber}-`)) {
    throw new Error("拆分单号必须以原始订单号加连字符开头");
  }
  if (!normalized.labelFileName) normalized.labelFileName = labelFileNameForOrder(normalized.orderNumber);
  return normalized;
}

// A shipping record represents one physical parcel. A multi-unit PO therefore becomes
// PO-1, PO-2 … in deterministic item/line order, each with quantity 1 and a matching label name.
export function splitOrderLines(order, items = [], skuMappings = new Map()) {
  const parentOrderNumber = safeText(order?.poNumber, "原始订单号", 242, true);
  const units = [];
  for (const item of items) {
    const count = Number(item?.quantity || 0);
    if (!Number.isInteger(count) || count < 1) continue;
    for (let unitIndex = 1; unitIndex <= count; unitIndex += 1) {
      units.push({
        lineKey: safeText(item?.lineKey, "订单行", 242, true),
        unitIndex,
        sku: safeText(item?.partNumber, "SKU", 242, true),
      });
    }
  }
  const isSplit = units.length > 1;
  return units.map((unit, index) => {
    const orderNumber = isSplit ? `${parentOrderNumber}-${index + 1}` : parentOrderNumber;
    const warehouseSkuCode = String(skuMappings.get(unit.sku) || "").trim();
    const address = order?.shipTo || order?.shippingAddress || {};
    return {
      sourceKey: `wayfair:${parentOrderNumber}:${unit.lineKey}:${unit.unitIndex}`,
      source: "wayfair_orders",
      orderDate: String(order?.poDate || "").slice(0, 10),
      systemOrderNumber: String(order?.orderId || ""),
      parentOrderNumber,
      orderNumber,
      country: String(order?.customerCountry || address?.country || "US").toUpperCase(),
      customerName: String(order?.customerName || address?.name || ""),
      addressLine1: String(order?.customerAddress1 || address?.address1 || ""),
      addressLine2: String(order?.customerAddress2 || address?.address2 || ""),
      city: String(order?.customerCity || address?.city || ""),
      stateRegion: String(order?.customerState || address?.state || ""),
      postalCode: String(order?.customerPostalCode || address?.postalCode || address?.zip || ""),
      phone: String(address?.phone || order?.customerPhone || ""),
      warehouseSkuCode,
      trackingNumber: "",
      sku: unit.sku,
      quantity: 1,
      shippingStatus: warehouseSkuCode ? "待获取面单" : "SKU待映射",
      labelObjectKey: "",
      labelFileName: labelFileNameForOrder(orderNumber),
    };
  });
}

function rowToRecord(row) {
  return {
    sourceKey: String(row.sourceKey),
    source: String(row.source),
    orderDate: String(row.orderDate || "").slice(0, 10),
    systemOrderNumber: String(row.systemOrderNumber || ""),
    parentOrderNumber: String(row.parentOrderNumber),
    orderNumber: String(row.orderNumber),
    country: String(row.country || ""),
    customerName: String(row.customerName || ""),
    addressLine1: String(row.addressLine1 || ""),
    addressLine2: String(row.addressLine2 || ""),
    city: String(row.city || ""),
    stateRegion: String(row.stateRegion || ""),
    postalCode: String(row.postalCode || ""),
    phone: String(row.phone || ""),
    warehouseSkuCode: String(row.warehouseSkuCode || ""),
    trackingNumber: String(row.trackingNumber || ""),
    sku: String(row.sku || ""),
    quantity: Number(row.quantity || 1),
    shippingStatus: String(row.shippingStatus || "待补全"),
    labelObjectKey: String(row.labelObjectKey || ""),
    labelFileName: String(row.labelFileName || ""),
  };
}

export function parseFulfillmentFilters({ start, end, status, limit = 500 } = {}) {
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 500, 2_000));
  const normalizedStart = start ? date(start) : FULFILLMENT_FORMAL_START_DATE;
  const normalizedEnd = end ? date(end) : "";
  if (normalizedStart && normalizedStart < FULFILLMENT_FORMAL_START_DATE) throw new Error(`订单台账仅支持 ${FULFILLMENT_FORMAL_START_DATE} 起的订单`);
  if (normalizedEnd && normalizedStart && normalizedEnd < normalizedStart) throw new Error("结束日期不能早于开始日期");
  const normalizedStatus = String(status || "").trim();
  if (normalizedStatus && !FULFILLMENT_STATUSES.includes(normalizedStatus)) throw new Error("订单状态筛选无效");
  return { start: normalizedStart || FULFILLMENT_FORMAL_START_DATE, end: normalizedEnd, status: normalizedStatus, limit: cappedLimit };
}

export async function listFulfillmentRecords(db, filters = {}) {
  const { start, end, status, limit } = parseFulfillmentFilters(filters);
  const predicates = ["order_date >= ?"];
  const values = [start];
  if (end) { predicates.push("order_date <= ?"); values.push(end); }
  if (status) { predicates.push("shipping_status = ?"); values.push(status); }
  values.push(limit);
  const stored = await db.prepare(`SELECT
    source_key AS sourceKey, source, order_date AS orderDate, system_order_number AS systemOrderNumber,
    parent_order_number AS parentOrderNumber, order_number AS orderNumber, country,
    customer_name AS customerName, address_line_1 AS addressLine1, address_line_2 AS addressLine2,
    city, state_region AS stateRegion, postal_code AS postalCode, phone,
    warehouse_sku_code AS warehouseSkuCode, tracking_number AS trackingNumber, sku, quantity,
    shipping_status AS shippingStatus, label_object_key AS labelObjectKey, label_file_name AS labelFileName
    FROM fulfillment_order_lines WHERE ${predicates.join(" AND ")}
    ORDER BY order_date DESC NULLS LAST, order_number ASC LIMIT ?`).bind(...values).all();
  return stored.results.map(rowToRecord);
}

export async function upsertFulfillmentRecord(db, input) {
  const record = validateFulfillmentRecord(input);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO fulfillment_order_lines (
    source_key, source, order_date, system_order_number, parent_order_number, order_number,
    country, customer_name, address_line_1, address_line_2, city, state_region, postal_code, phone,
    warehouse_sku_code, tracking_number, sku, quantity, shipping_status, label_object_key,
    label_file_name, source_updated_at, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(source_key) DO UPDATE SET
    source=excluded.source, order_date=excluded.order_date, system_order_number=excluded.system_order_number,
    parent_order_number=excluded.parent_order_number, order_number=excluded.order_number, country=excluded.country,
    customer_name=excluded.customer_name, address_line_1=excluded.address_line_1, address_line_2=excluded.address_line_2,
    city=excluded.city, state_region=excluded.state_region, postal_code=excluded.postal_code, phone=excluded.phone,
    warehouse_sku_code=excluded.warehouse_sku_code, tracking_number=excluded.tracking_number, sku=excluded.sku,
    quantity=excluded.quantity, shipping_status=excluded.shipping_status, label_object_key=excluded.label_object_key,
    label_file_name=excluded.label_file_name, source_updated_at=excluded.source_updated_at, updated_at=excluded.updated_at`).bind(
    record.sourceKey, record.source, record.orderDate || null, record.systemOrderNumber,
    record.parentOrderNumber, record.orderNumber, record.country, record.customerName,
    record.addressLine1, record.addressLine2, record.city, record.stateRegion, record.postalCode,
    record.phone, record.warehouseSkuCode, record.trackingNumber, record.sku, record.quantity,
    record.shippingStatus, record.labelObjectKey, record.labelFileName, now, now, now,
  ).run();
  return record;
}
