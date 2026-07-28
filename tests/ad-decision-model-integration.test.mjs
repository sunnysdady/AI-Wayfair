import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("wires the shadow model into advertising analysis and model-generated To Do", async () => {
  const [analysis, page, economics] = await Promise.all([
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/ad-contribution-economics.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(analysis, /buildAdDecisionModel/);
  assert.match(analysis, /decisionModel/);
  assert.match(analysis, /modelTodo/);
  assert.match(analysis, /const modelUnitKey/);
  assert.match(analysis, /row\.store_url/);
  assert.match(analysis, /normalizeAdAudience/);
  assert.match(analysis, /row\.targeting_type/);
  assert.match(analysis, /campaignTargetingById/);
  assert.match(analysis, /latest\.targeting_type\s*\|\|\s*campaignTargetingById\.get\(campaignId\)/);
  assert.match(analysis, /modelCurrentByUnit/);
  assert.match(analysis, /loadSkuCostEvidence/);
  assert.match(analysis, /resolveContributionEconomics/);
  assert.match(analysis, /modelPartSets/);
  assert.match(analysis, /mappingStable/);
  assert.match(economics, /CURRENT_USD_COST_CONSERVATIVE_ATTRIBUTED_UNIT_PROXY/);
  assert.match(analysis, /currency:\s*"USD"/);
  assert.doesNotMatch(analysis, /canada\|\\\.ca/);
  assert.doesNotMatch(analysis, /mode:\s*"SITE_CONTRIBUTION_SCOPE_UNVERIFIED"/);
  assert.doesNotMatch(analysis, /targetId:\s*`listing:/);
  assert.match(page, /广告决策模型/);
  assert.match(page, /Shadow/);
  assert.match(page, /modelTodo/);
  assert.match(analysis, /liveWritesEnabled:\s*false/);
  assert.match(page, /真实增量为正概率：不可估计/);
});
