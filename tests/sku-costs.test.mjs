import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  costTemplateCsv,
  parseCostCsv,
  resolveColumns,
  summarizeCostCoverage,
  validateCostRows,
} from "../lib/sku-costs.mjs";

test("accepts common Chinese and English cost headers", () => {
  assert.deepEqual(resolveColumns(["part_number", "unit_cost"]), { partNumber: 0, unitCost: 1 });
  assert.deepEqual(resolveColumns(["SKU", "采购成本"]), { partNumber: 0, unitCost: 1 });
  assert.deepEqual(resolveColumns(["货号", " Unit Cost "]), { partNumber: 0, unitCost: 1 });
  assert.deepEqual(resolveColumns(["listing", "roas"]), { partNumber: -1, unitCost: -1 });
});

test("converts dollar costs to cents and strips currency formatting", () => {
  const result = validateCostRows([
    { partNumber: "MFC-D3-B", unitCost: "$1,234.56" },
    { partNumber: " DMOM1021 ", unitCost: 42 },
  ]);

  assert.deepEqual(result.costs, [
    { partNumber: "MFC-D3-B", unitCostCents: 123456 },
    { partNumber: "DMOM1021", unitCostCents: 4200 },
  ]);
  assert.deepEqual(result.errors, []);
});

test("rejects non-USD currency symbols at the cost write boundary", () => {
  const result = validateCostRows([
    { partNumber: "A", unitCost: "¥68" },
    { partNumber: "B", unitCost: "€42" },
  ]);

  assert.equal(result.costs.length, 0);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((item) => /USD/.test(item.message)));
});

test("parses quoted CSV costs without splitting currency thousands separators", () => {
  const parsed = parseCostCsv('part_number,unit_cost\r\nMFC-D3-B,"$1,234.56"\r\n"A""B",68');

  assert.deepEqual(parsed, {
    headers: ["part_number", "unit_cost"],
    rows: [["MFC-D3-B", "$1,234.56"], ['A"B', "68"]],
  });
});

test("rejects rows that would corrupt downstream margins", () => {
  const result = validateCostRows([
    { partNumber: "", unitCost: 10 },
    { partNumber: "A", unitCost: "" },
    { partNumber: "B", unitCost: "abc" },
    { partNumber: "C", unitCost: 0 },
    { partNumber: "D", unitCost: -5 },
    { partNumber: "E", unitCost: 999999 },
  ]);

  assert.equal(result.costs.length, 0);
  assert.equal(result.errors.length, 6);
  assert.deepEqual(result.errors.map((item) => item.line), [2, 3, 4, 5, 6, 7]);
  assert.match(result.errors[3].message, /大于 0/);
});

test("warns when a cost implies negative margin instead of silently accepting it", () => {
  const result = validateCostRows(
    [{ partNumber: "MFC-D3-B", unitCost: 95 }],
    new Map([["MFC-D3-B", 8900]]),
  );

  assert.deepEqual(result.costs, [{ partNumber: "MFC-D3-B", unitCostCents: 9500 }]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /毛利为负/);
});

test("keeps the last value for a duplicated SKU and flags the conflict", () => {
  const result = validateCostRows([
    { partNumber: "A", unitCost: 10 },
    { partNumber: "A", unitCost: 12 },
  ]);

  assert.deepEqual(result.costs, [{ partNumber: "A", unitCostCents: 1200 }]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /重复/);
});

test("weights coverage by revenue and ranks missing SKUs by impact", () => {
  const summary = summarizeCostCoverage({
    soldParts: [
      { partNumber: "A", units: 1, revenueCents: 8000 },
      { partNumber: "B", units: 3, revenueCents: 12000 },
      { partNumber: "C", units: 1, revenueCents: 500 },
    ],
    costedParts: ["A"],
  });

  assert.equal(summary.soldParts, 3);
  assert.equal(summary.missingParts, 2);
  assert.equal(summary.revenueCoverage, 0.3902);
  assert.deepEqual(summary.missing.map((item) => item.partNumber), ["B", "C"]);
});

test("reports zero coverage without dividing by zero on an empty store", () => {
  assert.equal(summarizeCostCoverage().revenueCoverage, 0);
  assert.equal(summarizeCostCoverage({ soldParts: [], costedParts: [] }).missingParts, 0);
});

test("builds a fillable template seeded with the uncosted SKUs", () => {
  const csv = costTemplateCsv([{ partNumber: "B" }, { partNumber: "C" }]);
  assert.equal(csv, "part_number,unit_cost\nB,\nC,");
});

test("keeps the production USD cost import API and inventory entry point in source control", async () => {
  const [route, page, migration] = await Promise.all([
    readFile(new URL("../app/api/sku-costs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../migrations/postgres/0004_certify_sku_cost_currency.sql", import.meta.url), "utf8"),
  ]);

  assert.match(route, /成本文件校验未通过，未写入任何数据/);
  assert.match(route, /ON CONFLICT\(part_number\)/);
  assert.match(route, /currency/);
  assert.match(route, /currency_certification_source/);
  assert.match(migration, /UNVERIFIED/);
  assert.match(migration, /currency_certified_at/);
  assert.match(migration, /legacy-cost-reconciliation:dmom-operating-2026-06\.json/);
  assert.match(migration, /\('3T-B', 4300\)/);
  assert.match(migration, /CHECK \(currency IN \('USD', 'UNVERIFIED'\)\)/);
  assert.match(page, /function SkuCostPanel/);
  assert.match(page, /下载待补 SKU 模板/);
  assert.match(page, /校验并导入成本/);
});
