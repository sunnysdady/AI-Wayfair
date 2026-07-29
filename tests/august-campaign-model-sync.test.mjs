import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUGUST_CAMPAIGN_CONTROL_SNAPSHOT,
  campaignExecutionFact,
  reconcileAugustCampaignFindings,
} from "../lib/august-execution-policy.mjs";

test("publishes the verified Wallet and Campaign control snapshot as the model authority", () => {
  assert.equal(AUGUST_CAMPAIGN_CONTROL_SNAPSHOT.walletDailyCap, 60);
  assert.equal(AUGUST_CAMPAIGN_CONTROL_SNAPSHOT.activeCampaignDailyCap, 45);
  assert.equal(AUGUST_CAMPAIGN_CONTROL_SNAPSHOT.walletHeadroom, 15);
  assert.deepEqual(
    AUGUST_CAMPAIGN_CONTROL_SNAPSHOT.pausedCampaignIds,
    ["661593", "622734", "622727"],
  );

  const corrected = campaignExecutionFact("597350");
  assert.deepEqual(corrected, {
    campaignId: "597350",
    status: "ACTIVE",
    dailyCap: 4,
    protectedFromWholeCampaignPause: true,
    controlMode: "LISTING_ISOLATION",
    isolatedProducts: [
      { listing: "DMOM1025", part: "LFC-3W", status: "PAUSED" },
    ],
  });
});

test("removes superseded whole-campaign pause conclusions from the active model queue", () => {
  const result = reconcileAugustCampaignFindings([
    { campaignId: "597350", actionType: "PAUSE_CAMPAIGN", label: "旧结论" },
    { campaignId: "661593", actionType: "PAUSE_CAMPAIGN", label: "已执行" },
    { campaignId: "123456", actionType: "PAUSE_CAMPAIGN", label: "仍待处理" },
  ]);

  assert.deepEqual(result.findings, [
    { campaignId: "123456", actionType: "PAUSE_CAMPAIGN", label: "仍待处理" },
  ]);
  assert.deepEqual(
    result.suppressed.map((item) => [item.campaignId, item.reason]),
    [
      ["597350", "SUPERSEDED_BY_LISTING_ISOLATION"],
      ["661593", "ALREADY_PAUSED"],
    ],
  );
});

test("links the live control snapshot into analysis, model Todo, persistence and the page", async () => {
  const [ads, model, page] = await Promise.all([
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ad-decision-model.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(ads, /campaignControl:\s*campaignExecutionFact\(campaignId\)/);
  assert.match(ads, /reconcileAugustCampaignFindings\(rawZombieFindings\)/);
  assert.match(ads, /campaignControl:\s*AUGUST_CAMPAIGN_CONTROL_SNAPSHOT/);
  assert.match(ads, /ads-analysis:v24/);
  assert.match(model, /campaignControl:\s*unit\.campaignControl/);
  assert.match(page, /Wallet Daily Cap/);
  assert.match(page, /597350/);
  assert.match(page, /DMOM1025 \/ LFC-3W/);
  assert.match(page, /活跃 Campaign Cap 合计/);
});
