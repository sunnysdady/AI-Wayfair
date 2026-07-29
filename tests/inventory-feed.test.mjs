import assert from "node:assert/strict";
import test from "node:test";

import { classifyInventoryFeed, isInventoryDryRunAccepted, summarizeInventoryFeeds } from "../lib/wayfair-inventory-feed.mjs";

test("rejects incomplete inventory feed receipts", () => {
  assert.match(classifyInventoryFeed(null).reason, /未返回/);
  assert.match(classifyInventoryFeed({ status: "PROCESSING" }).reason, /feed ID/);
  assert.match(classifyInventoryFeed({ id: "feed" }).reason, /处理单元数量/);
  assert.match(classifyInventoryFeed({ id: "feed", itemCount: 1 }).reason, /错误计数/);
  assert.match(classifyInventoryFeed({ id: "feed", itemCount: 1, errorCount: 0 }).reason, /完成进度/);
});

test("classifies Wayfair error and completion receipts conservatively", () => {
  const base = { id: "feed", itemCount: 1, completedCount: 0, processingCount: 0, errorCount: 0, errors: [] };
  assert.match(classifyInventoryFeed({ ...base, errors: [{ message: "bad part" }] }).reason, /bad part/);
  assert.match(classifyInventoryFeed({ ...base, errorCount: 1 }).reason, /1 条错误/);
  assert.match(classifyInventoryFeed({ ...base, status: "ERROR" }).reason, /ERROR/);
  assert.equal(classifyInventoryFeed({ ...base, status: "COMPLETE", completedAt: "2026-07-28T00:00:00Z", completedCount: 1 }).state, "completed");
  assert.match(classifyInventoryFeed({ ...base, status: "COMPLETE" }).reason, /完成计数异常/);
});

test("distinguishes active processing from a stalled Wayfair workflow", () => {
  const feed = {
    id: "feed",
    status: "PROCESSING",
    submittedAt: "2026-07-28T00:00:00Z",
    itemCount: 1,
    completedCount: 0,
    processingCount: 1,
    errorCount: 0,
    errors: [],
  };
  assert.equal(classifyInventoryFeed(feed, { now: new Date("2026-07-28T00:05:00Z") }).state, "processing");
  assert.equal(classifyInventoryFeed(feed, { now: new Date("2026-07-28T00:31:00Z") }).state, "failed");
  assert.equal(classifyInventoryFeed(feed, {
    now: new Date("2026-07-28T00:31:00Z"),
    allowIndefiniteProcessing: true,
  }).state, "processing");
});

test("accepts a complete Wayfair dry-run receipt without requiring an unreachable terminal status", () => {
  const accepted = [{
    state: "processing",
    feed: {
      handle: "inventory-dry-run-handle",
      status: "PROCESSING",
      itemCount: 430,
      completedCount: 0,
      processingCount: 430,
      errorCount: 0,
      errors: [],
    },
  }];
  assert.equal(isInventoryDryRunAccepted(accepted), true);
  assert.equal(isInventoryDryRunAccepted([{ ...accepted[0], state: "failed" }]), false);
  assert.equal(isInventoryDryRunAccepted([{ ...accepted[0], feed: { ...accepted[0].feed, handle: "", errorCount: 1 } }]), false);
  assert.equal(isInventoryDryRunAccepted([]), false);
});

test("never summarizes an empty or failed receipt set as completed", () => {
  assert.equal(summarizeInventoryFeeds([]).status, "failed");
  assert.equal(summarizeInventoryFeeds([{ state: "completed" }, { state: "processing" }]).status, "processing");
  assert.equal(summarizeInventoryFeeds([{ state: "completed" }, { state: "failed" }]).status, "failed");
  assert.equal(summarizeInventoryFeeds([{ state: "completed" }]).status, "completed");
});
