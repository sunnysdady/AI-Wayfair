import assert from "node:assert/strict";
import test from "node:test";

import mapping from "../lib/inventory-mapping.json" with { type: "json" };
import { buildCompleteInventoryRows } from "../lib/inventory-plan.mjs";

test("uses the active Wayfair warehouse IDs exactly once with the correct Lingxing warehouse", () => {
  assert.deepEqual(mapping.warehouseMappings, [
    { supplierId: 347072, warehouse: "派速捷 LA02仓" },
    { supplierId: 360342, warehouse: "派速捷 LA10仓" },
    { supplierId: 360343, warehouse: "派速捷 XHNJ02仓" },
    { supplierId: 360344, warehouse: "派速捷 美南HOU04" },
    { supplierId: 360346, warehouse: "派速捷 美东南 GA 亚特兰大2仓" },
  ]);
  assert.equal(new Set(mapping.warehouseMappings.map((item) => item.supplierId)).size, 5);
  assert.equal(new Set(mapping.warehouseMappings.map((item) => item.warehouse)).size, 5);
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

  assert.equal(result.rows.length, 4);
  assert.deepEqual(
    result.rows.map((row) => row.item),
    [
      { discontinued: false, supplierPartNumber: "PART-A", quantityOnHand: 7, quantityOnOrder: 3, supplierId: 11, quantityBackordered: 0 },
      { discontinued: false, supplierPartNumber: "PART-A", quantityOnHand: 0, quantityOnOrder: 0, supplierId: 12, quantityBackordered: 0 },
      { discontinued: false, supplierPartNumber: "PART-ZERO", quantityOnHand: 0, quantityOnOrder: 0, supplierId: 11, quantityBackordered: 0 },
      { discontinued: false, supplierPartNumber: "PART-ZERO", quantityOnHand: 0, quantityOnOrder: 0, supplierId: 12, quantityBackordered: 0 },
    ],
  );
  assert.equal(result.missingCombinations, 3);
  assert.deepEqual(result.unmappedActiveParts, ["PART-ZERO"]);
});

test("rejects duplicate active parts and ambiguous warehouse mappings", () => {
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
      warehouseMappings: [
        { supplierId: 11, warehouse: "WH-A" },
        { supplierId: 12, warehouse: "WH-A" },
      ],
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
