import ExcelJS from "exceljs";
import { FULFILLMENT_COLUMNS } from "./fulfillment-ledger.mjs";

const SAFE_LABEL_KEY = /^fulfillment-labels\/[A-Za-z0-9._-]+\.pdf$/;
const TEMPLATE_HEADERS = [
  "日期", "系统单号", "单号", "国家", "客人姓名", "地址1", "地址2", "城市", "州", "邮编", "电话",
  "云仓SKU编码\n(公式填充)", "跟踪号", "SKU", "数量", "发货状态",
];
const TEMPLATE_COLUMN_WIDTHS = [12, 18, 20, 10, 24, 36, 24, 18, 10, 16, 16, 22, 20, 20, 10, 16];

function csvCell(value) {
  let normalized = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return /[",\r\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function templateDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return csvCell(text);
  return new Date(`${text}T12:00:00.000Z`);
}

export async function createFulfillmentWorkbook(records = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Wayfair AI";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("订单处理", { views: [{ state: "frozen", ySplit: 1, showGridLines: true }] });
  sheet.columns = TEMPLATE_COLUMN_WIDTHS.map((width) => ({ width }));
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.getRow(1).height = 34;
  sheet.getRow(1).eachCell((cell, index) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    cell.font = { name: index === 12 ? "Microsoft YaHei" : "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: index === 7 ? "left" : "center", vertical: "middle", wrapText: index === 12 };
    cell.border = {
      top: { style: "thin", color: { argb: "FF000000" } },
      left: { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
    };
  });
  for (const record of records) {
    const row = sheet.addRow(FULFILLMENT_COLUMNS.map(([, , field]) => field === "orderDate" ? templateDate(record?.[field]) : csvCell(record?.[field])));
    row.getCell(1).numFmt = 'm"月"d"日"';
    row.getCell(10).numFmt = "@";
    row.getCell(11).numFmt = "@";
    row.getCell(13).numFmt = "@";
    row.getCell(15).numFmt = "0";
  }
  sheet.autoFilter = "A1:P1";
  return workbook.xlsx.writeBuffer();
}

export function fulfillmentExportFileName({ start, end }) {
  return `Wayfair订单_${start}_${end || start}.xlsx`;
}

export function isDownloadableLabelRecord(record) {
  return Boolean(record?.sourceKey && SAFE_LABEL_KEY.test(String(record?.labelObjectKey || "")));
}

export function selectDownloadableLabelRecords(records = [], sourceKeys = []) {
  const selected = new Set(sourceKeys.map((value) => String(value || "").trim()).filter(Boolean));
  return records.filter((record) => selected.has(record.sourceKey) && isDownloadableLabelRecord(record));
}

export function safeLabelDownloadFileName(value, fallback = "Wayfair面单.pdf") {
  const name = String(value || "").trim();
  return /^[A-Za-z0-9._-]+\.pdf$/i.test(name) ? name : fallback;
}
