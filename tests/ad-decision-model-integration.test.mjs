import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("wires the shadow model into advertising analysis and model-generated To Do", async () => {
  const [analysis, page] = await Promise.all([
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(analysis, /buildAdDecisionModel/);
  assert.match(analysis, /decisionModel/);
  assert.match(analysis, /modelTodo/);
  assert.match(analysis, /const modelUnitKey/);
  assert.match(analysis, /row\.store_url/);
  assert.match(analysis, /normalizeAdAudience/);
  assert.match(analysis, /row\.targeting_type/);
  assert.match(analysis, /modelCurrentByUnit/);
  assert.doesNotMatch(analysis, /targetId:\s*`listing:/);
  assert.match(page, /广告决策模型/);
  assert.match(page, /Shadow/);
  assert.match(page, /modelTodo/);
  assert.match(analysis, /liveWritesEnabled:\s*false/);
  assert.match(page, /真实增量为正概率：不可估计/);
});
