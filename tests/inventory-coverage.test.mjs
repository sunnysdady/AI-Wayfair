import assert from "node:assert/strict";
import test from "node:test";

import { partCoverage } from "../lib/inventory-coverage.mjs";

const warehouses = [
  { supplierId: 1, warehouse: "GA" },
  { supplierId: 2, warehouse: "LA" },
  { supplierId: 3, warehouse: "NJ" },
  { supplierId: 4, warehouse: "GA" }, // 与 1 共用同一个实体仓
];
const row = (part, supplierId, quantityOnHand) => ({ supplierPartNumber: part, supplierId, quantityOnHand });

test("a part stocked in two physical warehouses is healthy even though other warehouses are zero", () => {
  const result = partCoverage([row("A", 1, 5), row("A", 2, 3), row("A", 3, 0), row("A", 4, 0)], warehouses);
  assert.equal(result.thinParts, 0);
  assert.equal(result.thinPartRatio, 0);
});

test("two supplier IDs sharing one physical warehouse count as one warehouse", () => {
  const result = partCoverage([row("A", 1, 5), row("A", 4, 5), row("A", 2, 0), row("A", 3, 0)], warehouses);
  assert.deepEqual(result.thinPartNumbers, ["A"]);
});

test("flags single-warehouse and fully out-of-stock parts and reports the ratio", () => {
  const items = [
    row("OK", 1, 1), row("OK", 2, 1),
    row("ONE", 3, 9), row("ONE", 1, 0),
    row("NONE", 1, 0), row("NONE", 2, 0),
  ];
  const result = partCoverage(items, warehouses);
  assert.deepEqual(result.thinPartNumbers.sort(), ["NONE", "ONE"]);
  assert.equal(result.zeroParts, 1);
  assert.equal(result.thinPartRatio, 2 / 3);
});
