import assert from "node:assert/strict";
import test from "node:test";

import { loadAllCatalogPages } from "../lib/catalog-pagination.mjs";

test("loads every Catalog page and preserves the first-seen SKU order", async () => {
  const calls = [];
  const pages = {
    1: {
      items: [{ supplierPartNumber: "PART-1" }, { supplierPartNumber: "PART-2" }],
      paginationInfo: { page: 1, totalPages: 3, totalCount: 5, hasNextPage: true },
      productManagement: { matchedItemCount: 2 },
    },
    2: {
      items: [{ supplierPartNumber: "PART-3" }, { supplierPartNumber: "PART-4" }],
      paginationInfo: { page: 2, totalPages: 3, totalCount: 5, hasNextPage: true },
    },
    3: {
      items: [{ supplierPartNumber: "PART-5" }],
      paginationInfo: { page: 3, totalPages: 3, totalCount: 5, hasNextPage: false },
    },
  };

  const result = await loadAllCatalogPages(async (page) => {
    calls.push(page);
    return pages[page];
  }, { concurrency: 2 });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(result.items.map((item) => item.supplierPartNumber), [
    "PART-1", "PART-2", "PART-3", "PART-4", "PART-5",
  ]);
  assert.equal(result.paginationInfo.totalCount, 5);
  assert.equal(result.paginationInfo.hasNextPage, false);
});

test("keeps a SKU only once when Catalog pages overlap", async () => {
  const result = await loadAllCatalogPages(async (page) => ({
    items: page === 1
      ? [{ supplierPartNumber: "PART-1" }, { supplierPartNumber: "PART-2" }]
      : [{ supplierPartNumber: "PART-2" }, { supplierPartNumber: "PART-3" }],
    paginationInfo: { page, totalPages: 2, totalCount: 3, hasNextPage: page === 1 },
  }));

  assert.deepEqual(result.items.map((item) => item.supplierPartNumber), [
    "PART-1", "PART-2", "PART-3",
  ]);
});
