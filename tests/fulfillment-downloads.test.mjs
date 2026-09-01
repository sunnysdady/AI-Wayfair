import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import {
  createFulfillmentWorkbook,
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

test("order export reproduces the 16-column A-P workbook template", async () => {
  const content = await createFulfillmentWorkbook([record]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content);
  const sheet = workbook.getWorksheet("订单处理");

  assert.ok(sheet);
  assert.equal(sheet.columnCount, 16);
  assert.deepEqual(sheet.getRow(1).values.slice(1), [
    "日期", "系统单号", "单号", "国家", "客人姓名", "地址1", "地址2", "城市", "州", "邮编", "电话",
    "云仓SKU编码\n(公式填充)", "跟踪号", "SKU", "数量", "发货状态",
  ]);
  assert.equal(sheet.getCell("E2").value, "'=Recipient");
  assert.equal(sheet.getCell("P2").value, "已归档面单");
  assert.equal(sheet.getCell("Q1").value, null);
});

test("export file name reflects the selected date range", () => {
  assert.equal(fulfillmentExportFileName({ start: "2026-09-01", end: "2026-09-14" }), "Wayfair订单_2026-09-01_2026-09-14.xlsx");
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
