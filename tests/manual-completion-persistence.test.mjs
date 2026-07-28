import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { manualCompletionPayload, validateManualCompletion } from "../lib/manual-ad-completions.mjs";

test("validates a server-persisted manual advertising acceptance", () => {
  const result = validateManualCompletion({
    taskKey: "DMOM1021::dmom1021-product",
    parentSku: "DMOM1021",
    taskId: "dmom1021-product",
    campaignId: "622725",
    adGroup: "Product US · DMOM1021",
    title: "下调 Product Bid",
    status: "VERIFIED",
    owner: "广告运营",
    executionResult: "Bid 已调整为 0.48",
    evidence: "Partner Home 显示 0.48",
    acceptanceCriteria: "Campaign Bid 等于 0.48",
    acceptedBy: "广告负责人",
  });

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.acceptedBy, "广告负责人");
  assert.equal(result.operationId, "manual:DMOM1021::dmom1021-product");
});

test("rejects malformed or oversized manual completion records", () => {
  assert.throws(
    () => validateManualCompletion({ taskKey: "../bad", parentSku: "A", taskId: "B", status: "OPEN" }),
    /任务键/,
  );
  assert.throws(
    () => validateManualCompletion({ taskKey: "A::B", parentSku: "A", taskId: "B", title: "x".repeat(241), status: "OPEN" }),
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
      status: "PENDING_ACCEPTANCE",
      owner: "待分派",
      executionResult: "旧版浏览器记录：仅确认曾勾选，等待补充平台证据",
      evidence: "legacy-browser-completion",
      acceptanceCriteria: "补充平台实际结果并由负责人验收",
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
  assert.match(route, /sameOrigin/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ad_manual_completions/);
  assert.match(page, /\/api\/ads\/manual-completions/);
  assert.match(page, /manualCompletionPayload/);
  assert.match(page, /服务器审计记录/);
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
