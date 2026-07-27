import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyLiveSafety } from "../lib/ad-live-safety.mjs";

const hold = {
  actionType: "HOLD",
  label: "保持当前 Bid",
  proposed: {},
  reasons: ["成熟周尚未触发动作"],
  warnings: [],
};

const pause = {
  actionType: "SET_LISTING_ACTIVE",
  label: "成熟窗口建议暂停",
  proposed: { active: false },
  reasons: ["成熟28天低于止损线"],
  warnings: [],
};

test("uses the latest four completed days as an alert, not an immediate bid or status change", () => {
  const result = applyLiveSafety({
    strategy: hold,
    currentBid: 0.61,
    breakEvenRoas: 2.56,
    recent: { spend: 71.04, clicks: 122, orders: 0, wscRoas: 0 },
    trailing: { spend: 112.49, clicks: 195, orders: 1, wscRoas: 0.96 },
    latestProductStatus: "ACTIVE",
    latestCampaignStatus: "ACTIVE",
  });

  assert.equal(result.strategy.actionType, "HOLD");
  assert.deepEqual(result.strategy.proposed, {});
  assert.equal(result.liveSafety.status, "ALERT");
  assert.match(result.strategy.label, /实时预警/);
  assert.match(result.strategy.reasons.join("；"), /71\.04.*122.*0单/);
});

test("only permits an emergency pause after the anomaly persists for seven complete days with enough statistical evidence", () => {
  const result = applyLiveSafety({
    strategy: hold,
    currentBid: 0.61,
    breakEvenRoas: 2.56,
    baselineCvr: 0.02,
    recent: { spend: 71.04, clicks: 122, orders: 0, wscRoas: 0 },
    trailing: { spend: 105.73, clicks: 168, orders: 0, wscRoas: 0 },
    latestProductStatus: "ACTIVE",
    latestCampaignStatus: "ACTIVE",
  });

  assert.equal(result.strategy.actionType, "SET_LISTING_ACTIVE");
  assert.deepEqual(result.strategy.proposed, { active: false });
  assert.equal(result.liveSafety.status, "CONFIRMED_STOP");
  assert.match(result.strategy.label, /持续止损/);
  assert.equal(result.liveSafety.requiredClicks, 149);
});

test("does not stop a low-spend observation before it crosses the live threshold", () => {
  const result = applyLiveSafety({
    strategy: hold,
    currentBid: 0.53,
    breakEvenRoas: 2.91,
    recent: { spend: 12.32, clicks: 20, orders: 0, wscRoas: 0 },
    trailing: { spend: 18.33, clicks: 33, orders: 1, wscRoas: 5.89 },
    latestProductStatus: "ACTIVE",
    latestCampaignStatus: "ACTIVE",
  });

  assert.equal(result.strategy.actionType, "HOLD");
  assert.equal(result.liveSafety.status, "RECENT_WINNER");
});

test("protects a recent profitable order from a stale mature-window pause", () => {
  const result = applyLiveSafety({
    strategy: pause,
    currentBid: 0.64,
    breakEvenRoas: 2.52,
    recent: { spend: 3.68, clicks: 7, orders: 0, wscRoas: 0 },
    trailing: { spend: 5.41, clicks: 9, orders: 1, wscRoas: 22 },
    latestProductStatus: "ACTIVE",
    latestCampaignStatus: "ACTIVE",
  });

  assert.equal(result.strategy.actionType, "HOLD");
  assert.deepEqual(result.strategy.proposed, {});
  assert.equal(result.liveSafety.status, "RECENT_WINNER");
  assert.match(result.strategy.label, /近期已出单/);
});

test("removes a redundant pause when the latest report is already inactive", () => {
  const result = applyLiveSafety({
    strategy: pause,
    currentBid: 0.42,
    breakEvenRoas: 3.94,
    recent: { spend: 0, clicks: 0, orders: 0, wscRoas: 0 },
    trailing: { spend: 0.78, clicks: 2, orders: 0, wscRoas: 0 },
    latestProductStatus: "INACTIVE",
    latestCampaignStatus: "ACTIVE",
  });

  assert.equal(result.strategy.actionType, "HOLD");
  assert.equal(result.liveSafety.status, "INACTIVE");
  assert.match(result.strategy.label, /无需重复暂停/);
});

test("blocks scaling during a short live anomaly without converting it into an immediate pause", () => {
  const result = applyLiveSafety({
    strategy: {
      ...hold,
      actionType: "INCREASE_DAILY_CAP",
      label: "Campaign Cap 增加20%",
      proposed: { change: "+20%", manual: true },
    },
    currentBid: 0.55,
    breakEvenRoas: 2.56,
    recent: { spend: 25, clicks: 35, orders: 0, wscRoas: 0 },
    trailing: { spend: 60, clicks: 80, orders: 0, wscRoas: 0 },
    latestProductStatus: "ACTIVE",
    latestCampaignStatus: "ACTIVE",
  });

  assert.equal(result.strategy.actionType, "HOLD");
  assert.equal(result.liveSafety.status, "ALERT");
});

test("keeps a forced compliance stop even when old attribution later appears profitable", () => {
  const result = applyLiveSafety({
    strategy: pause,
    currentBid: 0.3,
    breakEvenRoas: 3.54,
    recent: { spend: 3, clicks: 10, orders: 1, wscRoas: 20 },
    trailing: { spend: 10, clicks: 30, orders: 2, wscRoas: 25 },
    latestProductStatus: "ACTIVE",
    latestCampaignStatus: "ACTIVE",
    forceStop: true,
  });

  assert.equal(result.strategy.actionType, "SET_LISTING_ACTIVE");
  assert.deepEqual(result.strategy.proposed, { active: false });
});

test("wires campaign-grain live findings into the AI workbench", async () => {
  const [analysis, page] = await Promise.all([
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(analysis, /applyLiveSafety/);
  assert.match(analysis, /liveSafetyFindings/);
  assert.match(analysis, /liveSafetyRange/);
  assert.match(analysis, /listingFetchEnd\s*=\s*today/);
  assert.match(analysis, /campaign_id/);
  assert.match(page, /实时安全窗/);
  assert.match(page, /data\?\.liveSafetyFindings/);
  assert.match(page, /row\.liveSafety/);
  assert.match(page, /const rows=optimizationListings\.filter/);
});
