import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps manual diagnostics out of the AI API execution workspace", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");
  const manualStart = page.indexOf('{tab === "manual" && (');
  const aiStart = page.indexOf('{tab === "ai" && (');
  const aiEnd = page.indexOf('{tab === "manager" && (', aiStart);

  assert.ok(manualStart > 0 && aiStart > manualStart && aiEnd > aiStart);
  const manualWorkspace = page.slice(manualStart, aiStart);
  const aiWorkspace = page.slice(aiStart, aiEnd);

  assert.match(page, /const API_AD_ACTION_TYPES = new Set\(\["SET_LISTING_BID", "SET_LISTING_ACTIVE"\]\)/);
  assert.match(page, /const apiQueuedActions = queuedActions\.filter/);
  assert.doesNotMatch(page, /const manualQueuedActions=queuedActions\.filter/);
  assert.match(manualWorkspace, /处理方式/);
  assert.match(manualWorkspace, /提交验收/);
  assert.match(manualWorkspace, /执行证据/);
  assert.match(manualWorkspace, /zombieFindings\.map/);
  assert.match(aiWorkspace, /待审批需求/);
  assert.match(page, /apiQueuedActions/);
  assert.doesNotMatch(aiWorkspace, /AI 广告新开评估|AI Campaign 学习诊断|zombieFindings|manualQueuedActions/);
});
