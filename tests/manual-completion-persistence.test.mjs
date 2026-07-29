import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { manualCompletionPayload, validateManualCompletion } from "../lib/manual-ad-completions.mjs";

test("validates a server-persisted manual advertising completion", () => {
  const result = validateManualCompletion({
    taskKey: "DMOM1021::dmom1021-product",
    parentSku: "DMOM1021",
    taskId: "dmom1021-product",
    campaignId: "622725",
    adGroup: "Product US · DMOM1021",
    title: "下调 Product Bid",
    completed: true,
  });

  assert.deepEqual(result, {
    taskKey: "DMOM1021::dmom1021-product",
    parentSku: "DMOM1021",
    taskId: "dmom1021-product",
    campaignId: "622725",
    adGroup: "Product US · DMOM1021",
    title: "下调 Product Bid",
    owner: "运营负责人",
    assignee: "广告 Agent",
    executionChannel: "Wayfair Partner Home",
    executionResult: "",
    wayfairEvidence: "",
    receiver: "",
    reviewDate: "",
    closedLoopStatus: "CLOSED_LOOP_RECORDED",
    status: "COMPLETED",
  });
});

test("rejects malformed or oversized manual completion records", () => {
  assert.throws(
    () => validateManualCompletion({ taskKey: "../bad", parentSku: "A", taskId: "B", completed: true }),
    /任务键/,
  );
  assert.throws(
    () => validateManualCompletion({ taskKey: "A::B", parentSku: "A", taskId: "B", title: "x".repeat(241), completed: true }),
    /标题/,
  );
});

test("turns only known legacy browser completions into server migration payloads", () => {
  const tasks = [{
    id: "dmom1021-product",
    parentSkus: ["DMOM1021"],
    campaignId: "622725",
    adGroup: "Product US",
    title: "下调 Product Bid",
  }];

  assert.deepEqual(
    manualCompletionPayload("DMOM1021::dmom1021-product", tasks),
    {
      taskKey: "DMOM1021::dmom1021-product",
      parentSku: "DMOM1021",
      taskId: "dmom1021-product",
      campaignId: "622725",
      adGroup: "Product US",
      title: "下调 Product Bid",
      completed: true,
      owner: "运营负责人",
      assignee: "广告 Agent",
      executionChannel: "Wayfair Partner Home",
      executionResult: "",
      receiver: "",
      reviewDate: "",
    },
  );
  assert.equal(manualCompletionPayload("DMOM9999::unknown", tasks), null);
});

test("persists manual completions outside the AI API execution queue", async () => {
  const [route, migration, page] = await Promise.all([
    readFile(new URL("../app/api/ads/manual-completions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../migrations/postgres/0001_baseline.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /CREATE TABLE IF NOT EXISTS ad_manual_completions/);
  assert.match(route, /ON CONFLICT\(task_key\)/);
  assert.match(route, /closed_loop_status/);
  assert.match(route, /execution_result/);
  assert.match(route, /wayfair_evidence/);
  assert.match(route, /sameOrigin/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ad_manual_completions/);
  assert.match(migration, /closed_loop_status/);
  assert.match(page, /\/api\/ads\/manual-completions/);
  assert.match(page, /manualCompletionPayload/);
  assert.match(page, /提交验收/);
  assert.match(page, /批量提交验收/);
  assert.match(page, /计入闭环任务/);
  assert.doesNotMatch(route, /ad_action_queue/);
});

test("renders explicit advertising and inventory lock reasons", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

  assert.match(page, /广告生产锁/);
  assert.match(page, /库存生产锁/);
  assert.match(page, /data\?\.live\.ads\.blockers/);
  assert.match(page, /data\?\.live\.inventory\.blockers/);
  assert.match(page, /生产锁已解除/);
});
