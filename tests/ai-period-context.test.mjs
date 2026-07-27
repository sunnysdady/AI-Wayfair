import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("locks AI optimization to the mature decision week while keeping period controls outside AI", async () => {
  const [page, ads] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);
  const aiStart = page.indexOf("{tab==='ai'&&<>");
  const aiEnd = page.indexOf("{tab==='manager'&&<section", aiStart);
  assert.ok(aiStart > 0 && aiEnd > aiStart);
  const aiWorkspace = page.slice(aiStart, aiEnd);

  assert.match(page, /\{\(tab==='manager'\|\|tab==='manual'\)&&<section className="period-bar ad-period">/);
  assert.doesNotMatch(page, /tab!==['"]listings['"]&&<section className="period-bar ad-period"/);
  assert.match(page, /const aiDecisionCurrent=data\?\.decision\.current/);
  assert.match(page, /const aiDecisionPrevious=data\?\.decision\.previous/);
  assert.match(page, /tab==='ai'\?data\?\.decisionRange/);
  assert.match(aiWorkspace, /建议与动作依据/);
  assert.match(aiWorkspace, /成熟数据负责评估/);
  assert.match(aiWorkspace, /4日异常只报警/);
  assert.match(aiWorkspace, /成熟周花费/);
  assert.doesNotMatch(page.slice(0, aiStart), /决策成熟周|成熟周（推荐）/);
  assert.doesNotMatch(aiWorkspace, /data\?\.current\.spend|所选周期花费/);
  assert.match(ads, /decision: \{ current: total\(campaignRows, decisionStart, decisionEnd\), previous: total\(campaignRows, decisionPreviousStart, decisionPreviousEnd\) \}/);
});
