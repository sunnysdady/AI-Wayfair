import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OPERATION_STATUSES,
  assertOperationTransition,
  validateOperationInput,
} from "../lib/operation-ledger.mjs";
import { evaluateInventoryVerification } from "../lib/inventory-verification.mjs";
import { validateZombieResolution } from "../lib/zombie-resolutions.mjs";

test("uses one auditable operation state machine for every action", () => {
  assert.deepEqual(OPERATION_STATUSES, [
    "DISCOVERED",
    "ASSIGNED",
    "PENDING_APPROVAL",
    "PREFLIGHTED",
    "EXECUTING",
    "PENDING_ACCEPTANCE",
    "VERIFIED",
    "PENDING_REVIEW",
    "CLOSED",
    "FAILED",
    "ROLLED_BACK",
    "REOPENED",
  ]);
  assert.equal(assertOperationTransition("DISCOVERED", "ASSIGNED"), true);
  assert.equal(assertOperationTransition("PENDING_ACCEPTANCE", "VERIFIED"), true);
  assert.equal(assertOperationTransition("CLOSED", "REOPENED"), true);
  assert.throws(
    () => assertOperationTransition("DISCOVERED", "CLOSED"),
    /不允许从 DISCOVERED 直接变更为 CLOSED/,
  );
});

test("refuses to verify or close an action without execution and acceptance evidence", () => {
  const base = {
    operationId: "manual:DMOM1021::dmom1021-product",
    sourceType: "MANUAL_AD",
    sourceId: "DMOM1021::dmom1021-product",
    objectType: "PARENT_SKU",
    objectId: "DMOM1021",
    title: "下调 Product Bid",
    owner: "运营",
    status: "VERIFIED",
    proposedAction: "将 Bid 调整到目标值",
    beforeState: { bid: 0.58 },
    intendedAfterState: { bid: 0.48 },
  };
  assert.throws(() => validateOperationInput(base), /执行结果/);
  assert.throws(
    () => validateOperationInput({
      ...base,
      executionResult: "已在 Partner Home 修改",
      evidence: [{ type: "NOTE", value: "Campaign 622725 已显示新 Bid" }],
      acceptanceCriteria: "Campaign Bid 等于 0.48",
    }),
    /验收人/,
  );
  assert.equal(validateOperationInput({
    ...base,
    executionResult: "已在 Partner Home 修改",
    evidence: [{ type: "NOTE", value: "Campaign 622725 已显示新 Bid" }],
    acceptanceCriteria: "Campaign Bid 等于 0.48",
    acceptedBy: "广告负责人",
  }).status, "VERIFIED");
});

test("persists Zombie disposition with evidence instead of browser-only state", () => {
  assert.throws(
    () => validateZombieResolution({
      resolutionKey: "622725:DMOM1021:PAUSE_CAMPAIGN",
      campaignId: "622725",
      listing: "DMOM1021",
      actionType: "PAUSE_CAMPAIGN",
      method: "暂停 Campaign",
      status: "VERIFIED",
    }),
    /执行结果/,
  );
  assert.equal(validateZombieResolution({
    resolutionKey: "622725:DMOM1021:PAUSE_CAMPAIGN",
    campaignId: "622725",
    listing: "DMOM1021",
    actionType: "PAUSE_CAMPAIGN",
    method: "暂停 Campaign",
    status: "VERIFIED",
    owner: "广告运营",
    executionResult: "Campaign 已暂停",
    evidence: "Partner Home 状态为 Paused",
    acceptanceCriteria: "Campaign 状态为 Paused",
    acceptedBy: "广告负责人",
  }).status, "VERIFIED");
});

test("inventory verification closes only completed feeds whose samples match", () => {
  assert.deepEqual(evaluateInventoryVerification({
    feedStatus: "processing",
    samples: [{ partNumber: "ABC", expected: 10, observed: 10 }],
  }), {
    status: "BLOCKED",
    matched: 1,
    mismatched: 0,
    reason: "Wayfair feed 尚未完成",
  });
  assert.equal(evaluateInventoryVerification({
    feedStatus: "completed",
    samples: [{ partNumber: "ABC", expected: 10, observed: 9 }],
  }).status, "FAILED");
  assert.equal(evaluateInventoryVerification({
    feedStatus: "completed",
    samples: [
      { partNumber: "ABC", expected: 10, observed: 10 },
      { partNumber: "XYZ", expected: 0, observed: 0 },
    ],
    evidence: "Partner Home 2026-07-28 抽查",
    acceptedBy: "库存负责人",
  }).status, "VERIFIED");
});

test("exposes a task center and server-backed closure APIs", async () => {
  const [page, operations, zombie, inventory, migration] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ads/zombie-resolutions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/verification/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../migrations/postgres/0005_operation_ledger.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /id: "tasks", label: "闭环任务"/);
  assert.match(page, /function TaskCenter/);
  assert.match(page, /\/api\/operations/);
  assert.match(page, /\/api\/ads\/zombie-resolutions/);
  assert.match(page, /\/api\/inventory\/verification/);
  assert.doesNotMatch(page, /ZOMBIE_RESOLUTION_STORAGE_KEY/);
  assert.doesNotMatch(page, /zombie-resolutions:v1/);
  assert.match(operations, /operation_events/);
  assert.match(zombie, /upsertOperation/);
  assert.match(inventory, /evaluateInventoryVerification/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS operations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS operation_events/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_verifications/);
});

test("mobile navigation exposes a menu button and avoids mandatory wide task rows", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className="mobile-nav-toggle"/);
  assert.match(page, /aria-expanded=\{mobileOpen\}/);
  assert.match(styles, /@media\(max-width:760px\)[^{]*\{[^}]*\.mobile-nav-toggle\{[^}]*display:flex/s);
  assert.match(styles, /\.manual-task-closure/);
  assert.doesNotMatch(styles, /@media\(max-width:760px\)\{\.manual-todo-list\{padding:8px\}\.manual-sku-group\{min-width:720px\}/);
});
