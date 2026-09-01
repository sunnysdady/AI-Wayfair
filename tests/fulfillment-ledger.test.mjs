import assert from "node:assert/strict";
import test from "node:test";
import { labelFileNameForOrder, parseFulfillmentFilters, splitOrderLines, validateFulfillmentRecord } from "../lib/fulfillment-ledger.mjs";

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
  assert.throws(() => parseFulfillmentFilters({ start: "2026-08-31" }), /2026-09-01/);
  assert.throws(() => parseFulfillmentFilters({ status: "未知" }), /状态/);
});

test("fulfillment records reject package quantities other than one and unsafe split names", () => {
  const valid = validateFulfillmentRecord({
    sourceKey: "wayfair:PO:A:1", source: "wayfair_orders", orderDate: "2026-08-25",
    parentOrderNumber: "PO", orderNumber: "PO-1", country: "us", sku: "SKU", quantity: 1,
  });
  assert.equal(valid.country, "US");
  assert.equal(valid.labelFileName, "PO-1.pdf");
  assert.throws(() => validateFulfillmentRecord({ ...valid, quantity: 2 }), /数量/);
  assert.throws(() => validateFulfillmentRecord({ ...valid, orderNumber: "OTHER-1" }), /拆分单号/);
  assert.equal(labelFileNameForOrder("CS 67/58:19934-1"), "CS_67_58_19934-1.pdf");
});
