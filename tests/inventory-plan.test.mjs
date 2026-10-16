import assert from "node:assert/strict";
import test from "node:test";

import mapping from "../lib/inventory-mapping.json" with { type: "json" };
import { buildCompleteInventoryRows } from "../lib/inventory-plan.mjs";

test("uses the active Wayfair warehouse IDs exactly once with the correct Lingxing warehouse", () => {
  assert.deepEqual(mapping.warehouseMappings, [
    { supplierId: 360344, warehouse: "派速捷 美东南 GA 亚特兰大2仓" },
    { supplierId: 360342, warehouse: "派速捷 LA10仓" },
    { supplierId: 360343, warehouse: "派速捷 XHNJ02仓" },
    { supplierId: 347072, warehouse: "派速捷 美南HOU04" },
    { supplierId: 360346, warehouse: "派速捷 美东南 GA 亚特兰大2仓" },
  ]);
  assert.equal(new Set(mapping.warehouseMappings.map((item) => item.supplierId)).size, 5);
  assert.equal(new Set(mapping.warehouseMappings.map((item) => item.warehouse)).size, 4);
  assert.equal(
    mapping.skuMappings.find((item) => item.supplierPartNumber === "5T-1830-1200")?.lingxingSku,
    "B02UR-027BM|B01UR-005BM",
  );
});

test("builds one complete active-part by warehouse inventory baseline and fills missing rows with zero", () => {
  const result = buildCompleteInventoryRows(
    [{
      rowNumber: 2,
      lingxingSku: "SKU-A",
      warehouse: "WH-A",
      productName: "Product A",
      available: 7,
      locked: 0,
      incoming: 3,
      transferInTransit: 0,
    }],
    {
      activePartNumbers: ["PART-A", "PART-ZERO"],
      skuMappings: [{ supplierPartNumber: "PART-A", lingxingSku: "SKU-A" }],
      warehouseMappings: [
        { supplierId: 11, warehouse: "WH-A" },
        { supplierId: 12, warehouse: "WH-B" },
      ],
    },
  );

  // 未映射的 PART-ZERO 库存未知：不生成推送行，只报警。
  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((row) => row.item),
    [
      { discontinued: false, supplierPartNumber: "PART-A", quantityOnHand: 7, quantityOnOrder: 3, supplierId: 11, quantityBackordered: 0 },
      { discontinued: false, supplierPartNumber: "PART-A", quantityOnHand: 0, quantityOnOrder: 0, supplierId: 12, quantityBackordered: 0 },
    ],
  );
  assert.equal(result.missingCombinations, 1);
  assert.deepEqual(result.unmappedActiveParts, ["PART-ZERO"]);
});

test("sums every mapped Lingxing SKU in the same warehouse and treats an absent mapped SKU as zero", () => {
  const result = buildCompleteInventoryRows(
    [
      {
        rowNumber: 2,
        lingxingSku: "SKU-OLD",
        warehouse: "WH-A",
        productName: "Old model",
        available: 7,
        locked: 0,
        incoming: 3,
        transferInTransit: 0,
      },
      {
        rowNumber: 3,
        lingxingSku: "SKU-NEW",
        warehouse: "WH-A",
        productName: "New model",
        available: 11,
        locked: 0,
        incoming: 2,
        transferInTransit: 0,
      },
    ],
    {
      activePartNumbers: ["PART-A"],
      skuMappings: [{ supplierPartNumber: "PART-A", lingxingSku: "SKU-OLD|SKU-MISSING|SKU-NEW" }],
      warehouseMappings: [{ supplierId: 11, warehouse: "WH-A" }],
    },
  );

  assert.deepEqual(result.rows.map((row) => row.item), [
    { discontinued: false, supplierPartNumber: "PART-A", quantityOnHand: 18, quantityOnOrder: 5, supplierId: 11, quantityBackordered: 0 },
  ]);
  assert.equal(result.rows[0].source.lingxingSku, "SKU-OLD|SKU-MISSING|SKU-NEW");
  assert.equal(result.missingCombinations, 1);
});

test("rejects duplicate active parts and supplier warehouse IDs", () => {
  const stockRows = [];
  assert.throws(
    () => buildCompleteInventoryRows(stockRows, {
      activePartNumbers: ["PART-A", "PART-A"],
      skuMappings: [],
      warehouseMappings: [{ supplierId: 11, warehouse: "WH-A" }],
    }),
    /重复/,
  );
  assert.throws(
    () => buildCompleteInventoryRows(stockRows, {
      activePartNumbers: ["PART-A"],
      skuMappings: [],
      warehouseMappings: [{ supplierId: 11, warehouse: "WH-A" }, { supplierId: 11, warehouse: "WH-B" }],
    }),
    /仓库映射/,
  );
});

test("production mapping is a complete unique baseline, not every historical mapping row", () => {
  assert.equal(mapping.activePartNumbers.length, 86);
  assert.equal(new Set(mapping.activePartNumbers).size, mapping.activePartNumbers.length);
  assert.ok(mapping.activePartNumbers.includes("2T-Kayak"));
  assert.ok(mapping.activePartNumbers.includes("4T-Kayak"));
  assert.ok(!mapping.activePartNumbers.includes("CT-03"));
});

test("lists every zero-filled combination so operators can audit it", () => {
  const result = buildCompleteInventoryRows(
    [{ rowNumber: 2, lingxingSku: "SKU-1", warehouse: "WH-A", productName: "", available: 5, locked: 0, incoming: 0, transferInTransit: 0 }],
    {
      activePartNumbers: ["PART-A", "PART-NOMAP"],
      skuMappings: [{ supplierPartNumber: "PART-A", lingxingSku: "SKU-1|SKU-2" }],
      warehouseMappings: [{ supplierId: 11, warehouse: "WH-A" }, { supplierId: 12, warehouse: "WH-B" }],
    },
  );
  assert.equal(result.missingDetails.filter((d) => d.lingxingSku).length, result.missingCombinations);
  assert.deepEqual(result.missingDetails.map((d) => `${d.supplierPartNumber}/${d.supplierId}/${d.lingxingSku}/${d.warehouse}`).sort(), [
    "PART-A/11/SKU-2/WH-A",
    "PART-A/12/SKU-1/WH-B",
    "PART-A/12/SKU-2/WH-B",
    "PART-NOMAP/11//WH-A",
    "PART-NOMAP/12//WH-B",
  ]);
  assert.equal(result.missingDetails.find((d) => d.supplierPartNumber === "PART-NOMAP").reason, "商品未映射领星 SKU（未推送，保持 Wayfair 现状）");
});

test("unmapped parts are reported but never zero-filled, and part-level stats exclude them", () => {
  const result = buildCompleteInventoryRows(
    [{ rowNumber: 2, lingxingSku: "SKU-1", warehouse: "WH-A", productName: "", available: 5, locked: 0, incoming: 0, transferInTransit: 0 },
     { rowNumber: 3, lingxingSku: "SKU-2", warehouse: "WH-A", productName: "", available: 0, locked: 0, incoming: 0, transferInTransit: 0 }],
    {
      activePartNumbers: ["IGNORED"],
      livePartNumbers: ["PART-A", "PART-B", "PART-NOMAP"],
      skuMappings: [{ supplierPartNumber: "PART-A", lingxingSku: "SKU-1" }, { supplierPartNumber: "PART-B", lingxingSku: "SKU-2" }],
      warehouseMappings: [{ supplierId: 11, warehouse: "WH-A" }, { supplierId: 12, warehouse: "WH-B" }],
    },
  );
  assert.ok(result.rows.every((row) => row.item.supplierPartNumber !== "PART-NOMAP"));
  assert.deepEqual(result.unmappedActiveParts, ["PART-NOMAP"]);
  assert.equal(result.partStats.pushedParts, 2);
  assert.equal(result.partStats.zeroParts, 1);
  assert.deepEqual(result.partStats.zeroPartNumbers, ["PART-B"]);
  assert.equal(result.partStats.zeroPartRatio, 0.5);
});

test("discontinued parts are neither pushed nor reported as unmapped", () => {
  const result = buildCompleteInventoryRows([], {
    activePartNumbers: ["OLD", "NEW"],
    discontinuedPartNumbers: ["OLD"],
    skuMappings: [{ supplierPartNumber: "NEW", lingxingSku: "S1" }],
    warehouseMappings: [{ supplierId: 11, warehouse: "WH-A" }],
  });
  assert.deepEqual(result.rows.map((row) => row.item.supplierPartNumber), ["NEW"]);
  assert.deepEqual(result.unmappedActiveParts, []);
});

test("summarizes missing warehouses per Lingxing SKU and flags SKUs missing everywhere", async () => {
  const { summarizeMissingBySku } = await import("../lib/inventory-plan.mjs");
  const result = summarizeMissingBySku([
    { lingxingSku: "SKU-X", warehouse: "WH-A", reason: "r" },
    { lingxingSku: "SKU-X", warehouse: "WH-B", reason: "r" },
    { lingxingSku: "SKU-Y", warehouse: "WH-A", reason: "r" },
    { lingxingSku: "", warehouse: "WH-A", reason: "商品未映射领星 SKU" },
  ], 2);
  assert.deepEqual(result.map((r) => [r.lingxingSku, r.missingWarehouses, r.allMissing]), [["SKU-X", 2, true], ["SKU-Y", 1, false]]);
});
