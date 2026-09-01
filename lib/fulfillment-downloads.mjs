import { FULFILLMENT_COLUMNS } from "./fulfillment-ledger.mjs";

const SAFE_LABEL_KEY = /^fulfillment-labels\/[A-Za-z0-9._-]+\.pdf$/;

function csvCell(value) {
  let normalized = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return /[",\r\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

export function createFulfillmentCsv(records = []) {
  const header = FULFILLMENT_COLUMNS.flatMap(([letter, label]) => [letter, label]);
  const rows = records.map((record) => FULFILLMENT_COLUMNS.map(([, , field]) => csvCell(record?.[field])).join(","));
  return `\uFEFF${header.join(",")}\r\n${rows.join("\r\n")}${rows.length ? "\r\n" : ""}`;
}

export function fulfillmentExportFileName({ start, end }) {
  return `Wayfair订单_${start}_${end || start}.csv`;
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
