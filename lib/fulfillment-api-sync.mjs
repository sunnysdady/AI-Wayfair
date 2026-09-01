import { PDFDocument } from "pdf-lib";
import inventoryMapping from "./inventory-mapping.json" with { type: "json" };
import {
  FULFILLMENT_FORMAL_START_DATE,
  labelFileNameForOrder,
  listFulfillmentRecordsBySourceKeys,
  splitOrderLines,
  upsertFulfillmentRecord,
} from "./fulfillment-ledger.mjs";
import { lingxingDate, lingxingDayStart } from "./lingxing-business-time.mjs";
import { fetchAllDropshipOrders } from "./wayfair-orders-pagination.mjs";

const TOKEN_URL = "https://sso.auth.wayfair.com/oauth/token";
const ORDER_ENDPOINT = "https://api.wayfair.com/v1/graphql";
const PAGE_SIZE = 2_000;
const ORDER_QUERY = `query FulfillmentOrders($fromDate: IsoDateTime!) {
  getDropshipPurchaseOrders(limit: 2000, fromDate: $fromDate, sortOrder: ASC) {
    poNumber poDate orderId customerName customerAddress1 customerAddress2 customerCity customerState customerPostalCode customerCountry
    products { partNumber quantity }
  }
}`;
const LABEL_QUERY = `query FulfillmentLabel($number: String!) {
  labelGenerationEvents(filters: [{ field: poNumber, equals: $number }], limit: 1, offset: 0) {
    poNumber
    consolidatedShippingLabel { url }
    shippingLabelInfo { trackingNumber }
  }
}`;
const HISTORICAL_LABEL_QUERY = `query HistoricalLabelCheck($before: String!) {
  labelGenerationEvents(filters: [{ field: eventDate, lessThan: $before }], limit: 5, offset: 0) {
    poNumber consolidatedShippingLabel { url }
  }
}`;

function ensureDate(value, name) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error(`${name}必须是 YYYY-MM-DD`);
  return text;
}

function skuMappingMap() {
  return new Map((inventoryMapping.skuMappings || []).map((item) => [String(item.supplierPartNumber || "").trim(), String(item.lingxingSku || "").trim()]).filter(([part, sku]) => part && sku));
}

function labelNumber(poNumber) {
  const match = String(poNumber || "").trim().match(/^[A-Za-z]{2}(\d{9})$/);
  return match?.[1] || "";
}

async function accessToken(env) {
  if (!env.WAYFAIR_OPS_CLIENT_ID || !env.WAYFAIR_OPS_CLIENT_SECRET) throw new Error("Ops API 凭证未配置");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: env.WAYFAIR_OPS_CLIENT_ID, client_secret: env.WAYFAIR_OPS_CLIENT_SECRET, audience: "https://api.wayfair.com/" }),
  });
  if (!response.ok) throw new Error(`Ops API OAuth 失败（HTTP ${response.status}）`);
  const body = await response.json();
  if (!body.access_token) throw new Error("Ops API OAuth 缺少 access_token");
  return body.access_token;
}

async function graphQL(token, query, variables) {
  const response = await fetch(ORDER_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Wayfair 履约 API 请求失败（HTTP ${response.status}）`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((item) => item.message || "Wayfair API GraphQL 错误").join("；"));
  return body.data || {};
}

function safeLabelKey(orderNumber) {
  return `fulfillment-labels/${labelFileNameForOrder(orderNumber)}`;
}

function keepMoreAdvancedStatus(current, next) {
  return ["已发货", "已出库", "已归档面单"].includes(current) ? current : next;
}

async function splitAndArchivePdf({ files, url, records }) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`面单下载失败（HTTP ${response.status}）`);
  const source = await PDFDocument.load(await response.arrayBuffer());
  if (source.getPageCount() !== records.length) return { status: "面单待核验", archived: 0 };
  let archived = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const key = safeLabelKey(record.orderNumber);
    if (!await files.get(key)) {
      const document = await PDFDocument.create();
      const [page] = await document.copyPages(source, [index]);
      document.addPage(page);
      await files.put(key, await document.save(), { httpMetadata: { contentType: "application/pdf" } });
    }
    record.labelObjectKey = key;
    record.labelFileName = labelFileNameForOrder(record.orderNumber);
    record.shippingStatus = keepMoreAdvancedStatus(record.shippingStatus, "已归档面单");
    archived += 1;
  }
  return { status: "已归档面单", archived };
}

async function enrichLabels({ env, token, records }) {
  const groups = new Map();
  for (const record of records) groups.set(record.parentOrderNumber, [...(groups.get(record.parentOrderNumber) || []), record]);
  const parents = [...groups.entries()]
    .filter(([, groupedRecords]) => groupedRecords.some((record) => !record.labelObjectKey || !record.trackingNumber))
    .map(([parent]) => parent);
  if (!parents.some(labelNumber)) return { archived: 0, checked: 0 };
  let archived = 0;
  for (const parent of parents) {
    const recordsForParent = groups.get(parent);
    const number = labelNumber(parent);
    if (!number) continue;
    const data = await graphQL(token, LABEL_QUERY, { number });
    // The server applies the PO filter. The event's poNumber can be the primary PO of a
    // consolidated label, so using it again as a client-side lookup key loses valid labels.
    const event = (data.labelGenerationEvents || [])[0];
    const info = event?.shippingLabelInfo?.[0];
    for (const record of recordsForParent) {
      if (info?.trackingNumber) record.trackingNumber = String(info.trackingNumber);
    }
    if (recordsForParent.every((record) => record.labelObjectKey)) continue;
    const url = String(event?.consolidatedShippingLabel?.url || "");
    if (!url) continue;
    try { archived += (await splitAndArchivePdf({ files: env.FILES, url, records: recordsForParent })).archived; }
    catch { for (const record of recordsForParent) record.shippingStatus = keepMoreAdvancedStatus(record.shippingStatus, "面单待核验"); }
  }
  return { archived, checked: parents.length };
}

function hydrateStoredLabelState(records, storedRecords) {
  const storedByKey = new Map(storedRecords.map((record) => [record.sourceKey, record]));
  for (const record of records) {
    const stored = storedByKey.get(record.sourceKey);
    if (!stored) continue;
    if (stored.trackingNumber) record.trackingNumber = stored.trackingNumber;
    if (stored.labelObjectKey) {
      record.labelObjectKey = stored.labelObjectKey;
      record.labelFileName = stored.labelFileName || labelFileNameForOrder(record.orderNumber);
      record.shippingStatus = keepMoreAdvancedStatus(stored.shippingStatus, record.shippingStatus);
    }
  }
}

export async function syncFulfillmentOrders(env, { start = FULFILLMENT_FORMAL_START_DATE } = {}) {
  const fromDate = ensureDate(start, "开始日期");
  if (fromDate < FULFILLMENT_FORMAL_START_DATE) throw new Error(`履约同步不允许读取 ${FULFILLMENT_FORMAL_START_DATE} 前的历史订单`);
  const token = await accessToken(env);
  const result = await fetchAllDropshipOrders({
    fromDate: lingxingDayStart(fromDate),
    pageSize: PAGE_SIZE,
    fetchPage: async ({ fromDate: cursor }) => (await graphQL(token, ORDER_QUERY, { fromDate: cursor })).getDropshipPurchaseOrders || [],
  });
  const today = lingxingDate();
  const records = result.orders
    .filter((order) => String(order?.poDate || "").slice(0, 10) >= FULFILLMENT_FORMAL_START_DATE && String(order?.poDate || "").slice(0, 10) <= today)
    .flatMap((order) => splitOrderLines(order, (order.products || []).map((item, index) => ({ ...item, lineKey: `${item.partNumber}:${index}` })), skuMappingMap()));
  hydrateStoredLabelState(records, await listFulfillmentRecordsBySourceKeys(env.DB, records.map((record) => record.sourceKey)));
  const labels = await enrichLabels({ env, token, records });
  for (const record of records) await upsertFulfillmentRecord(env.DB, record);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .bind("fulfillment:orders", JSON.stringify({ fromDate, records: records.length, pages: result.pages, complete: result.complete, labels }), now).run();
  return { fromDate, records: records.length, pages: result.pages, complete: result.complete, labels };
}

// Historical validation is deliberately read-only: it does not access DB/S3 and never downloads a label file.
export async function verifyHistoricalLabelRead(env) {
  const token = await accessToken(env);
  const data = await graphQL(token, HISTORICAL_LABEL_QUERY, { before: lingxingDayStart(FULFILLMENT_FORMAL_START_DATE) });
  const events = data.labelGenerationEvents || [];
  const ready = events.filter((event) => String(event?.consolidatedShippingLabel?.url || "")).length;
  if (events.length < 5 || ready < 5) throw new Error("历史面单只读验证未取得 5 笔可用面单事件");
  return { checked: 5, readable: 5, downloaded: 0, persisted: 0 };
}
