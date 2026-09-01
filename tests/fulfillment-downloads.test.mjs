import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  createFulfillmentCsv,
  fulfillmentExportFileName,
  selectDownloadableLabelRecords,
} from "../lib/fulfillment-downloads.mjs";

const record = {
  sourceKey: "wayfair:PO-1:SKU:1",
  orderDate: "2026-09-01",
  systemOrderNumber: "SYS-1",
  parentOrderNumber: "PO-1",
  orderNumber: "PO-1",
  country: "US",
  customerName: "=Recipient",
  addressLine1: "1 Main St",
  addressLine2: "",
  city: "New York",
  stateRegion: "NY",
  postalCode: "10001",
  phone: "5550100",
  warehouseSkuCode: "WH-1",
  trackingNumber: "TRACK-1",
  sku: "SKU-1",
  quantity: 1,
  shippingStatus: "已归档面单",
  labelObjectKey: "fulfillment-labels/PO-1.pdf",
  labelFileName: "PO-1.pdf",
};

test("order export keeps the A-P template and neutralizes spreadsheet formulas", () => {
  const csv = createFulfillmentCsv([record]);

  assert.match(csv, /^\uFEFFA,日期,B,系统单号,C,单号,D,国家,E,客人姓名,F,地址1,G,地址2,H,城市,I,州,J,邮编,K,电话,L,云仓SKU编码,M,跟踪号,N,SKU,O,数量,P,发货状态\r\n/m);
  assert.match(csv, /'=?Recipient/);
  assert.doesNotMatch(csv, /labelObjectKey/);
});

test("export file name reflects the selected date range", () => {
  assert.equal(fulfillmentExportFileName({ start: "2026-09-01", end: "2026-09-14" }), "Wayfair订单_2026-09-01_2026-09-14.csv");
});

test("label download selection accepts only stored fulfillment PDFs for selected records", () => {
  const selected = selectDownloadableLabelRecords([
    record,
    { ...record, sourceKey: "wayfair:PO-2:SKU:1", labelObjectKey: "reports/unrelated.pdf", labelFileName: "unrelated.pdf" },
    { ...record, sourceKey: "wayfair:PO-3:SKU:1", labelObjectKey: "", labelFileName: "" },
  ], [record.sourceKey, "wayfair:PO-2:SKU:1", "wayfair:PO-3:SKU:1", "not-a-record"]);

  assert.deepEqual(selected.map((item) => item.sourceKey), [record.sourceKey]);
});

test("workspace exposes date-range order export and selectable archived label downloads", async () => {
  const source = await readFile(new URL("../app/fulfillment/workspace.tsx", import.meta.url), "utf8");

  assert.match(source, /下载订单/);
  assert.match(source, /下载已选面单/);
  assert.match(source, /type="checkbox"/);
  assert.doesNotMatch(source, /"待回传"/);
});
