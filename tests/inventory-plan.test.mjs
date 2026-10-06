import assert from "node:assert/strict";
import test from "node:test";

import mapping from "../lib/inventory-mapping.json" with { type: "json" };
import { buildCompleteInventoryRows } from "../lib/inventory-plan.mjs";

test("production mapping: 4 Wayfair IDs, same-state Lingxing warehouses merged, each warehouse owned once", () => {
  assert.deepEqual(mapping.warehouseMappings, [
    { supplierId: 347072, warehouse: "派速捷 LA10仓|派速捷 XHLAX1A仓", splitBufferRate: 0.1 },
    { supplierId: 360343, warehouse: "派速捷 XHNJ02仓|派速捷 MSNJ01仓|派速捷 MSNJ02仓", splitBufferRate: 0.1 },
    { supplierId: 360344, warehouse: "派速捷 美南HOU04" },
    { supplierId: 360346, warehouse: "派速捷 美东南 GA 亚特兰大2仓" },
  ]);
  assert.ok(!mapping.warehouseMappings.some((item) => item.supplierId === 360342), "360342 (Chino) is deactivated");
  const names = mapping.warehouseMappings.flatMap((item) => item.warehouse.split("|"));
  assert.equal(new Set(names).size, names.length);
});

const stockRow = (lingxingSku, warehouse, available, incoming = 0) => ({ rowNumber: 2, lingxingSku, warehouse, productName: "", available, locked: 0, incoming, transferInTransit: 0 });
const mergedConfig = (rate) => ({
  activePartNumbers: ["P"],
  skuMappings: [{ supplierPartNumber: "P", lingxingSku: "S" }],
  warehouseMappings: [{ supplierId: 1, warehouse: "W1|W2", ...(rate === undefined ? {} : { splitBufferRate: rate }) }],
});

test("merged warehouses: stock spread over 2+ warehouses is summed then reduced by the split buffer (rounded down)", () => {
  const result = buildCompleteInventoryRows([stockRow("S", "W1", 3, 1), stockRow("S", "W2", 3, 2)], mergedConfig(0.1));
  assert.equal(result.rows[0].item.quantityOnHand, 5); // floor(6 * 0.9)
  assert.equal(result.rows[0].item.quantityOnOrder, 3); // incoming is not buffered
  assert.equal(result.rows[0].source.available, 6); // raw total kept for audit
});

test("merged warehouses: stock held by only one warehouse is reported in full", () => {
  const result = buildCompleteInventoryRows([stockRow("S", "W1", 10), stockRow("S", "W2", 0)], mergedConfig(0.1));
  assert.equal(result.rows[0].item.quantityOnHand, 10);
});

test("merged warehouses: no buffer configured means a plain sum", () => {
  const result = buildCompleteInventoryRows([stockRow("S", "W1", 3), stockRow("S", "W2", 3)], mergedConfig());
  assert.equal(result.rows[0].item.quantityOnHand, 6);
});

test("rejects a Lingxing warehouse owned by two Wayfair IDs or listed twice", () => {
  const base = { activePartNumbers: ["P"], skuMappings: [] };
  assert.throws(() => buildCompleteInventoryRows([], { ...base, warehouseMappings: [{ supplierId: 1, warehouse: "W1" }, { supplierId: 2, warehouse: "W1|W2" }] }), /仓库映射存在重复.*W1/);
  assert.throws(() => buildCompleteInventoryRows([], { ...base, warehouseMappings: [{ supplierId: 1, warehouse: "W1|W1" }] }), /仓库映射存在重复/);
  assert.throws(() => buildCompleteInventoryRows([], { ...base, warehouseMappings: [{ supplierId: 1, warehouse: "W1", splitBufferRate: 1 }] }), /splitBufferRate/);
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
