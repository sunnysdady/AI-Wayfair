import assert from "node:assert/strict";
import test from "node:test";

import { canRemoveAction } from "../lib/ad-action-queue.mjs";
import { evaluateAdjustment, reviewGuardrail } from "../lib/ad-weekly-memory.mjs";
import { nextSort, sortRows } from "../lib/table-sort.mjs";

test("sorts advertising and catalog rows by operator-selected fields", () => {
  const rows = [{ name: "B", spend: 10 }, { name: "A", spend: 30 }, { name: "C", spend: 20 }];
  assert.deepEqual(sortRows(rows, { key: "spend", direction: "desc" }, { spend: row => row.spend }).map(row => row.name), ["A", "C", "B"]);
  assert.deepEqual(sortRows(rows, { key: "name", direction: "asc" }, { name: row => row.name }).map(row => row.name), ["A", "B", "C"]);
  assert.deepEqual(nextSort({ key: "spend", direction: "desc" }, "spend"), { key: "spend", direction: "asc" });
});

test("failed execution items can be removed without touching completed history", () => {
  assert.equal(canRemoveAction("FAILED"), true);
  assert.equal(canRemoveAction("PLANNED"), true);
  assert.equal(canRemoveAction("EXECUTED"), false);
});

test("weekly review waits for mature evidence and blocks repeated changes", () => {
  const pending = evaluateAdjustment({ action: { action_type: "SET_LISTING_BID" }, baseline: { orders: 2, wsc: 200, wscRoas: 3 }, observed: { clicks: 20, orders: 2, wsc: 210, wscRoas: 3.2 }, executedDate: "2026-07-17", matureThrough: "2026-07-20", breakEvenRoas: 2.8 });
  assert.equal(pending.verdict, "PENDING");
  assert.equal(reviewGuardrail(pending).hold, true);
});

test("weekly review identifies effective and harmful bid changes", () => {
  const effective = evaluateAdjustment({ action: { action_type: "SET_LISTING_BID" }, baseline: { clicks: 50, orders: 2, wsc: 200, wscRoas: 2.5 }, observed: { clicks: 50, orders: 3, wsc: 260, wscRoas: 3.2 }, executedDate: "2026-07-01", matureThrough: "2026-07-15", breakEvenRoas: 2.8 });
  assert.equal(effective.verdict, "EFFECTIVE");
  assert.equal(reviewGuardrail(effective).hold, false);
  const harmful = evaluateAdjustment({ action: { action_type: "SET_LISTING_BID" }, baseline: { clicks: 50, orders: 5, wsc: 500, wscRoas: 4 }, observed: { clicks: 30, orders: 2, wsc: 180, wscRoas: 2 }, executedDate: "2026-07-01", matureThrough: "2026-07-15", breakEvenRoas: 2.8 });
  assert.equal(harmful.verdict, "HARMFUL");
  assert.equal(reviewGuardrail(harmful).hold, true);
});
