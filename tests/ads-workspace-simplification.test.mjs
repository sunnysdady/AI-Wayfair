import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("turns zombie diagnostics into a server-audited tracker and keeps one linked AI workbench", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");
  const manualStart = page.indexOf('{tab === "manual" && (');
  const aiStart = page.indexOf('{tab === "ai" && (', manualStart);
  const aiEnd = page.indexOf('{tab === "manager" && (', aiStart);

  assert.ok(manualStart > 0 && aiStart > manualStart && aiEnd > aiStart);
  const manualWorkspace = page.slice(manualStart, aiStart);
  const aiWorkspace = page.slice(aiStart, aiEnd);

  assert.match(page, /\/api\/ads\/zombie-resolutions/);
  assert.doesNotMatch(page, /ZOMBIE_RESOLUTION_STORAGE_KEY/);
  assert.doesNotMatch(page, /zombie-resolutions:v1/);
  assert.match(page, /function saveZombieResolution/);
  assert.doesNotMatch(page, /function queueZombieAction/);
  assert.match(manualWorkspace, /处理方式/);
  assert.match(manualWorkspace, /提交验收/);
  assert.match(manualWorkspace, /zombieResolutions/);
  assert.doesNotMatch(manualWorkspace, /加入手动执行清单|人工执行清单（不调用 API）|manualQueuedActions/);

  assert.equal((aiWorkspace.match(/<section /g) || []).length, 2);
  assert.match(aiWorkspace, /待审批需求/);
  assert.match(aiWorkspace, /queueActionByKey\.get/);
  assert.match(aiWorkspace, /executionResultForAction\(queuedAction\)/);
  assert.doesNotMatch(aiWorkspace, /ai-execution-boundary|stat-grid four ad-kpis|API 执行批次|API 调整记录与效果复盘/);
});

test("keeps only reviewable recommendations in the focused AI approval workbench", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");
  const aiStart = page.indexOf('{tab === "ai" && (');
  const aiEnd = page.indexOf('{tab === "manager" && (', aiStart);
  const aiWorkspace = page.slice(aiStart, aiEnd);

  assert.match(page, /const approvalRows = filteredListings\.filter/);
  assert.match(page, /row\.operatorReview\?\.verdict === "CANDIDATE"/);
  assert.match(page, /const selectableListings = approvalRows\.filter/);
  assert.doesNotMatch(aiWorkspace, /optimizationListings/);
});
