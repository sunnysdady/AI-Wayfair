import assert from "node:assert/strict";
import test from "node:test";

import { fetchAllDropshipOrders } from "../lib/wayfair-orders-pagination.mjs";

function order(poNumber, poDate) {
  return { poNumber, poDate, products: [] };
}

test("walks ascending order pages past the API limit and removes boundary overlap", async () => {
  const calls = [];
  const pages = [
    [
      order("PO-1", "2026-07-01T00:00:00Z"),
      order("PO-2", "2026-07-02T00:00:00Z"),
    ],
    [
      order("PO-2", "2026-07-02T00:00:00Z"),
      order("PO-3", "2026-07-03T00:00:00Z"),
    ],
    [order("PO-4", "2026-07-04T00:00:00Z")],
  ];

  const result = await fetchAllDropshipOrders({
    fromDate: "2026-07-01T00:00:00Z",
    pageSize: 2,
    fetchPage: async ({ fromDate, limit, sortOrder }) => {
      calls.push({ fromDate, limit, sortOrder });
      return pages.shift();
    },
  });

  assert.deepEqual(result.orders.map((item) => item.poNumber), ["PO-1", "PO-2", "PO-3", "PO-4"]);
  assert.equal(result.pages, 3);
  assert.equal(result.complete, true);
  assert.deepEqual(calls, [
    { fromDate: "2026-07-01T00:00:00Z", limit: 2, sortOrder: "ASC" },
    { fromDate: "2026-07-02T00:00:00Z", limit: 2, sortOrder: "ASC" },
    { fromDate: "2026-07-03T00:00:00Z", limit: 2, sortOrder: "ASC" },
  ]);
});

test("fails closed when a full page cannot advance its timestamp cursor", async () => {
  await assert.rejects(
    fetchAllDropshipOrders({
      fromDate: "2026-07-01T00:00:00Z",
      pageSize: 2,
      fetchPage: async () => [
        order("PO-1", "2026-07-01T00:00:00Z"),
        order("PO-2", "2026-07-01T00:00:00Z"),
      ],
    }),
    /无法推进|截断/,
  );
});

test("fails closed instead of returning a partial order set when the page guard is reached", async () => {
  let page = 0;
  await assert.rejects(
    fetchAllDropshipOrders({
      fromDate: "2026-07-01T00:00:00Z",
      pageSize: 2,
      maxPages: 2,
      fetchPage: async () => {
        page += 1;
        return [
          order(`PO-${page}-1`, `2026-07-0${page}T00:00:00Z`),
          order(`PO-${page}-2`, `2026-07-0${page + 1}T00:00:00Z`),
        ];
      },
    }),
    /最大页数|截断/,
  );
});
