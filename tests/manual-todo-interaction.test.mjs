import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("requires execution evidence and acceptance instead of a completion checkbox", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className=\{`manual-todo-row/);
  assert.match(page, /className="manual-task-closure"/);
  assert.match(page, /className="manual-todo-content"/);
  assert.match(page, /执行结果/);
  assert.match(page, /执行证据/);
  assert.match(page, /验收人/);
  assert.match(page, /提交验收/);
  assert.doesNotMatch(page, /className="manual-todo-check"/);
  assert.doesNotMatch(styles, /\.manual-todo-check:hover/);
  assert.match(styles, /\.manual-todo-content\{[^}]*user-select:text/);
});

test("renders every manual action at advertising-group grain with its Campaign ID", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

  assert.match(page, /MANUAL_AD_TASK_GROUPS/);
  assert.match(page, /manual-sku-group/);
  assert.match(page, /group\.tasks\.map/);
  assert.match(page, /手动优化 To-Do List · 按父体 SKU/);
  assert.match(page, /adGroup:/);
  assert.match(page, /campaignId:/);
  assert.match(page, /<dt>\u5e7f\u544a\u7ec4<\/dt><dd>\{task\.adGroup\}<\/dd>/);
  assert.match(page, /<dt>Campaign ID<\/dt><dd>\{task\.campaignId\}<\/dd>/);
  assert.match(page, /Campaign ID: \{task\.campaignId\}/);
  assert.match(page, /campaignId: "660198"/);
  assert.match(page, /campaignId: "597350"/);
  assert.match(page, /campaignId: "622725"/);
  assert.match(page, /campaignId: "622721"/);
  assert.match(page, /campaignId: "622722"/);
  assert.match(page, /campaignId: "675055"/);
  assert.match(page, /campaignId: "676296"/);
  assert.match(page, /campaignId: "676299"/);
  assert.match(page, /campaignId: "676302"/);
  assert.match(page, /campaignId: "635903"/);
  assert.doesNotMatch(page, /campaignId: "\u65b0\u5efa\u540e\u56de\u586b"/);
});

test("migrates saved advertising-group completion ids to parent-SKU keys", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

  assert.match(page, /const MANUAL_AD_TASK_IDS = new Set<string>\(MANUAL_AD_TASKS\.map\(task => task\.id\)\)/);
  assert.match(page, /MANUAL_AD_TASK_IDS\.has\(item\)/);
  assert.match(page, /legacyTask\.parentSkus\.map\(sku=>manualTaskKey\(sku,legacyTask\.id\)\)/);
});
