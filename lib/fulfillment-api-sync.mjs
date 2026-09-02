import { PDFDocument } from "pdf-lib";
import inventoryMapping from "./inventory-mapping.json" with { type: "json" };
import {
  FULFILLMENT_FORMAL_START_DATE,
  labelArchiveMode,
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
  labelGenerationEvents(filters: [{ field: poNumber, equals: $number }], limit: 10, offset: 0) {
    id poNumber eventDate
    consolidatedShippingLabel { url }
    shippingLabelInfo { trackingNumber }
  }
}`;
const REGISTER_LABEL_MUTATION = `mutation RegisterShippingLabel($registrationInput: RegistrationInput!) {
  purchaseOrders {
    register(registrationInput: $registrationInput) {
      id poNumber eventDate
      consolidatedShippingLabel { url }
      shippingLabelInfo { trackingNumber }
    }
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
  // Wayfair PO prefixes are alphabetic; the numeric suffix length is not fixed.
  // Preserve the complete suffix so a newer PO format cannot be silently skipped.
  const match = String(poNumber || "").trim().match(/^[A-Za-z]{2}(\d+)$/);
  return match?.[1] || "";
}

export function labelLookupNumbers(poNumber) {
  const numericNumber = labelNumber(poNumber);
  return numericNumber ? [numericNumber] : [];
}

export function selectLabelEvent(events = []) {
  if (!Array.isArray(events)) return null;
  return events.find((event) => String(event?.consolidatedShippingLabel?.url || ""))
    || events.find((event) => event?.shippingLabelInfo?.some((info) => info?.trackingNumber))
    || events[0]
    || null;
}

function eventPoNumber(event) {
  return String(event?.poNumber || "").trim();
}

function eventLabelInfo(event) {
  return Array.isArray(event?.shippingLabelInfo) ? event.shippingLabelInfo : [];
}

// A label event is usable only when Wayfair identifies it as the requested PO.
// The API can expose a consolidated document in the result set for other POs;
// never infer ownership from a shared document URL or tracking number.
export function selectLabelEventForParent(events = [], parentOrderNumber) {
  const lookup = new Set(labelLookupNumbers(parentOrderNumber));
  const exact = (Array.isArray(events) ? events : []).filter((event) => lookup.has(eventPoNumber(event)));
  return selectLabelEvent(exact);
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

async function splitAndArchivePdf({ files, token, url, records }) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`面单下载失败（HTTP ${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const source = await PDFDocument.load(bytes);
  const mode = labelArchiveMode(source.getPageCount(), records.length);
  if (mode === "error") return { status: "面单待核验", archived: 0 };
  if (mode === "whole") {
    const [record] = records;
    const key = safeLabelKey(record.orderNumber);
    if (!await files.get(key)) await files.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
    record.labelObjectKey = key;
    record.labelFileName = labelFileNameForOrder(record.orderNumber);
    record.shippingStatus = keepMoreAdvancedStatus(record.shippingStatus, "已归档面单");
    return { status: "已归档面单", archived: 1 };
  }
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

function setWaitingForLabel(records) {
  for (const record of records) record.shippingStatus = keepMoreAdvancedStatus(record.shippingStatus, "待平台生成面单");
}

async function registerLabelEvent(token, parentOrderNumber) {
  const poNumber = labelLookupNumbers(parentOrderNumber)[0];
  if (!poNumber) return null;
  const data = await graphQL(token, REGISTER_LABEL_MUTATION, { registrationInput: { poNumber } });
  return data?.purchaseOrders?.register || null;
}

async function archiveLabelEvent({ env, token, event, parentOrderNumber, records, trackingOwners }) {
  const url = String(event?.consolidatedShippingLabel?.url || "");
  if (!url) {
    setWaitingForLabel(records);
    return { archived: 0, ready: false };
  }
  const trackingNumbers = [...new Set(eventLabelInfo(event)
    .map((item) => String(item?.trackingNumber || "").trim())
    .filter(Boolean))];
  // A carrier tracking number belongs to exactly one parent PO. Refuse an
  // archive before downloading it when the current sync already associates
  // that number with a different PO.
  if (trackingNumbers.length === 1 && [...(trackingOwners.get(trackingNumbers[0]) || [])].some((owner) => owner !== parentOrderNumber)) {
    for (const record of records) record.shippingStatus = keepMoreAdvancedStatus(record.shippingStatus, "面单待核验");
    return { archived: 0, ready: true };
  }
  const archiveResult = await splitAndArchivePdf({ files: env.FILES, token, url, records });
  if (!archiveResult.archived) {
    for (const record of records) record.shippingStatus = keepMoreAdvancedStatus(record.shippingStatus, archiveResult.status);
    return { archived: 0, ready: true };
  }
  if (records.length === 1) {
    if (trackingNumbers.length === 1) {
      records[0].trackingNumber = trackingNumbers[0];
      trackingOwners.set(trackingNumbers[0], new Set([parentOrderNumber]));
    }
  }
  return { archived: archiveResult.archived, ready: true };
}

async function enrichLabels({ env, token, records }) {
  const groups = new Map();
  for (const record of records) groups.set(record.parentOrderNumber, [...(groups.get(record.parentOrderNumber) || []), record]);
  const trackingOwners = new Map();
  for (const record of records) {
    const trackingNumber = String(record.trackingNumber || "").trim();
    if (!trackingNumber) continue;
    const owners = trackingOwners.get(trackingNumber) || new Set();
    owners.add(record.parentOrderNumber);
    trackingOwners.set(trackingNumber, owners);
  }
  const parents = [...groups.entries()]
    .filter(([, groupedRecords]) => groupedRecords.some((record) => !record.labelObjectKey || !record.trackingNumber))
    .map(([parent]) => parent);
  if (!parents.some((parent) => labelLookupNumbers(parent).length)) {
    return { archived: 0, checked: 0, matched: 0, ready: 0, unavailable: 0, requested: 0, errors: 0, attempts: 0 };
  }
  let archived = 0;
  let matched = 0;
  let ready = 0;
  let unavailable = 0;
  let requested = 0;
  let errors = 0;
  let attempts = 0;
  for (const parent of parents) {
    const recordsForParent = groups.get(parent);
    let event = null;
    let sawExistingEventForPo = false;
    for (const number of labelLookupNumbers(parent)) {
      attempts += 1;
      const data = await graphQL(token, LABEL_QUERY, { number });
      const events = data.labelGenerationEvents || [];
      sawExistingEventForPo ||= events.some((candidate) => labelLookupNumbers(parent).includes(eventPoNumber(candidate)));
      const candidate = selectLabelEventForParent(events, parent);
      if (candidate && !event) event = candidate;
      if (candidate?.consolidatedShippingLabel?.url) {
        event = candidate;
        break;
      }
    }
    if (!event) {
      // A label-generation event already belongs to this PO, but its document is
      // not yet safely attributable. Do not register again: that could duplicate it.
      if (sawExistingEventForPo) {
        unavailable += 1;
        for (const record of recordsForParent) record.shippingStatus = keepMoreAdvancedStatus(record.shippingStatus, "面单待核验");
        continue;
      }
      try {
        event = await registerLabelEvent(token, parent);
        requested += 1;
      } catch {
        errors += 1;
        for (const record of recordsForParent) record.shippingStatus = keepMoreAdvancedStatus(record.shippingStatus, "异常");
        continue;
      }
      if (!event || !selectLabelEventForParent([event], parent)) {
        unavailable += 1;
        setWaitingForLabel(recordsForParent);
        continue;
      }
    }
    matched += 1;
    if (recordsForParent.every((record) => record.labelObjectKey)) continue;
    try {
      const archiveResult = await archiveLabelEvent({ env, token, event, parentOrderNumber: parent, records: recordsForParent, trackingOwners });
      archived += archiveResult.archived;
      if (archiveResult.ready) ready += 1;
      else unavailable += 1;
    }
    catch {
      errors += 1;
      for (const record of recordsForParent) record.shippingStatus = keepMoreAdvancedStatus(record.shippingStatus, "异常");
    }
  }
  return { archived, checked: parents.length, matched, ready, unavailable, requested, errors, attempts };
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

// A tracking number must not be shared by distinct Wayfair POs. Older syncs
// could save one consolidated PDF under several POs. Remove every affected
// mapping immediately; the stored object remains for audit but cannot be
// downloaded as an individual order label.
async function invalidateSharedConsolidatedLabels({ files, records }) {
  const byTrackingNumber = new Map();
  for (const record of records) {
    if (!record.trackingNumber || !record.labelObjectKey) continue;
    const trackingNumber = String(record.trackingNumber).trim();
    if (!trackingNumber) continue;
    byTrackingNumber.set(trackingNumber, [...(byTrackingNumber.get(trackingNumber) || []), record]);
  }

  let invalidated = 0;
  for (const recordsWithTracking of byTrackingNumber.values()) {
    if (new Set(recordsWithTracking.map((record) => record.parentOrderNumber)).size < 2) continue;
    for (const record of recordsWithTracking) {
      record.trackingNumber = "";
      record.labelObjectKey = "";
      record.labelFileName = labelFileNameForOrder(record.orderNumber);
      record.shippingStatus = "面单待核验";
      invalidated += 1;
    }
  }
  return invalidated;
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
  const invalidatedStoredLabels = await invalidateSharedConsolidatedLabels({ files: env.FILES, records });
  const labels = { ...(await enrichLabels({ env, token, records })), invalidatedStoredLabels };
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
