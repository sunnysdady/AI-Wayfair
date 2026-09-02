import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { labelArchiveMode, labelFileNameForOrder, listFulfillmentRecords, parseFulfillmentFilters, splitOrderLines, validateFulfillmentRecord } from "../lib/fulfillment-ledger.mjs";
import { labelLookupNumbers, selectLabelEvent } from "../lib/fulfillment-api-sync.mjs";
import { toPostgresSql } from "../lib/postgres-d1.mjs";

test("one multi-unit order is split into deterministic one-parcel orders", () => {
  const records = splitOrderLines(
    { poNumber: "CS675819934", poDate: "2026-08-25T00:00:00.000Z" },
    [
      { lineKey: "A:0", partNumber: "SKU-A", quantity: 2 },
      { lineKey: "B:1", partNumber: "SKU-B", quantity: 1 },
    ],
  );

  assert.deepEqual(records.map((record) => record.orderNumber), ["CS675819934-1", "CS675819934-2", "CS675819934-3"]);
  assert.deepEqual(records.map((record) => record.quantity), [1, 1, 1]);
  assert.deepEqual(records.map((record) => record.labelFileName), ["CS675819934-1.pdf", "CS675819934-2.pdf", "CS675819934-3.pdf"]);
  assert.equal(records[2].sku, "SKU-B");
  assert.equal(records[0].orderDate, "2026-08-25T00:00:00.000Z");
});

test("one physical parcel keeps its source order number", () => {
  const [record] = splitOrderLines(
    { poNumber: "CA675883443", poDate: "2026-08-25" },
    [{ lineKey: "SKU:0", partNumber: "SKU", quantity: 1 }],
  );
  assert.equal(record.orderNumber, "CA675883443");
  assert.equal(record.labelFileName, "CA675883443.pdf");
});

test("split records inherit API recipient fields and cloud SKU mappings", () => {
  const [record] = splitOrderLines(
    {
      poNumber: "CA675883443", poDate: "2026-09-01", orderId: "SYSTEM-123",
      customerName: "Recipient", customerAddress1: "1 Main St", customerAddress2: "Suite 2",
      customerCity: "New York", customerState: "NY", customerPostalCode: "10001", customerCountry: "us",
    },
    [{ lineKey: "SKU:0", partNumber: "SKU", quantity: 1 }],
    new Map([["SKU", "CLOUD-SKU-A|CLOUD-SKU-B"]]),
  );
  assert.equal(record.systemOrderNumber, "SYSTEM-123");
  assert.equal(record.country, "US");
  assert.equal(record.warehouseSkuCode, "CLOUD-SKU-A|CLOUD-SKU-B");
  assert.equal(record.shippingStatus, "待获取面单");
});

test("formal ledger filters reject historical dates and unknown statuses", () => {
  assert.deepEqual(parseFulfillmentFilters({ start: "2026-09-01", end: "2026-09-14", status: "待出库" }), {
    start: "2026-09-01", end: "2026-09-14", status: "待出库", limit: 500,
  });
  assert.equal(parseFulfillmentFilters({ status: "待平台生成面单" }).status, "待平台生成面单");
  assert.throws(() => parseFulfillmentFilters({ start: "2026-08-31" }), /2026-09-01/);
  assert.throws(() => parseFulfillmentFilters({ status: "未知" }), /状态/);
});

test("ledger queries include the full end date and sort newest order timestamps first", async () => {
  let query = "";
  let values = [];
  const db = {
    prepare(sql) {
      query = sql;
      return {
        bind(...bound) {
          values = bound;
          return { all: async () => ({ results: [] }) };
        },
      };
    },
  };

  await listFulfillmentRecords(db, { start: "2026-09-01", end: "2026-09-01", limit: 25 });
  assert.match(query, /order_date >= \(\?::date::timestamp AT TIME ZONE 'Etc\/GMT\+4'\)/);
  assert.match(query, /order_date < \(\(\?::date \+ INTERVAL '1 day'\)::timestamp AT TIME ZONE 'Etc\/GMT\+4'\)/);
  assert.match(query, /ORDER BY order_date DESC NULLS LAST, order_number ASC/);
  assert.match(toPostgresSql(query), /order_date >= \(\$1::date::timestamp/);
  assert.doesNotMatch(toPostgresSql(query), /"DATE"/);
  assert.deepEqual(values, ["2026-09-01", "2026-09-01", 25]);
});

test("fulfillment records reject package quantities other than one and unsafe split names", () => {
  const valid = validateFulfillmentRecord({
    sourceKey: "wayfair:PO:A:1", source: "wayfair_orders", orderDate: "2026-08-25",
    parentOrderNumber: "PO", orderNumber: "PO-1", country: "us", sku: "SKU", quantity: 1,
  });
  assert.equal(valid.country, "US");
  assert.equal(valid.labelFileName, "PO-1.pdf");
  assert.equal(validateFulfillmentRecord({ ...valid, orderDate: "2026-09-01T15:04:05-04:00" }).orderDate, "2026-09-01T19:04:05.000Z");
  assert.throws(() => validateFulfillmentRecord({ ...valid, quantity: 2 }), /数量/);
  assert.throws(() => validateFulfillmentRecord({ ...valid, orderNumber: "OTHER-1" }), /拆分单号/);
  assert.equal(labelFileNameForOrder("CS 67/58:19934-1"), "CS_67_58_19934-1.pdf");
});

test("label lookup requests only the supported tracking field from ShippingLabelInterface", async () => {
  const source = await readFile(new URL("../lib/fulfillment-api-sync.mjs", import.meta.url), "utf8");
  const query = source.match(/const LABEL_QUERY = `([\s\S]*?)`;/)?.[1] || "";

  assert.match(query, /query FulfillmentLabel\(\$number: String!\)/);
  assert.match(query, /equals: \$number/);
  assert.match(query, /limit: 10/);
  assert.doesNotMatch(query, /\bin:\s*\$numbers/);
  assert.match(query, /shippingLabelInfo \{ trackingNumber \}/);
  assert.doesNotMatch(query, /shippingLabelInfo \{[^}]*\b(poNumber|fullPoNumber|numberOfLabels)\b/);
});

test("label lookup uses the required numeric PO and prioritizes downloadable events", () => {
  assert.deepEqual(labelLookupNumbers("CS677571095"), ["677571095"]);
  assert.deepEqual(labelLookupNumbers("invalid"), []);
  const ready = { consolidatedShippingLabel: { url: "https://labels.example/one.pdf" }, shippingLabelInfo: [] };
  const trackingOnly = { consolidatedShippingLabel: null, shippingLabelInfo: [{ trackingNumber: "TRACK" }] };
  assert.equal(selectLabelEvent([trackingOnly, ready]), ready);
  assert.equal(selectLabelEvent([trackingOnly]), trackingOnly);
  assert.equal(selectLabelEvent([]), null);
});

test("label downloads follow the signed URL redirect", async () => {
  const source = await readFile(new URL("../lib/fulfillment-api-sync.mjs", import.meta.url), "utf8");
  assert.match(source, /fetch\(url, \{ headers: \{ authorization: `Bearer \$\{token\}` \}, redirect: "follow", signal: AbortSignal\.timeout\(60_000\) \}\)/);
  assert.match(source, /const archiveResult = await splitAndArchivePdf\(/);
  assert.match(source, /record\.shippingStatus = keepMoreAdvancedStatus\(record\.shippingStatus, archiveResult\.status\)/);
});

test("label verification is automatic and keeps unambiguous single-order PDFs intact", async () => {
  assert.equal(labelArchiveMode(1, 1), "whole");
  assert.equal(labelArchiveMode(2, 1), "whole");
  assert.equal(labelArchiveMode(2, 2), "split");
  assert.equal(labelArchiveMode(3, 2), "error");

  const ledger = await readFile(new URL("../lib/fulfillment-ledger.mjs", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../app/fulfillment/workspace.tsx", import.meta.url), "utf8");
  const sync = await readFile(new URL("../lib/fulfillment-api-sync.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(`${ledger}\n${workspace}\n${sync}`, /面单待核验/);
  assert.match(sync, /catch \{[\s\S]*errors \+= 1;[\s\S]*record\.shippingStatus = keepMoreAdvancedStatus\(record\.shippingStatus, "异常"\);/);
});

test("an absent Wayfair label event is shown as waiting for platform generation", async () => {
  const source = await readFile(new URL("../lib/fulfillment-api-sync.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(!event\) \{\s*for \(const record of recordsForParent\) record\.shippingStatus = keepMoreAdvancedStatus\(record\.shippingStatus, "待平台生成面单"\);\s*continue;\s*\}/);
});
