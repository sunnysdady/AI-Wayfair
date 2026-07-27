import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateAdActionFreshness } from "../lib/ad-action-freshness.mjs";

test("accepts a pause only when the latest report still shows the listing active", () => {
  const result = validateAdActionFreshness({
    action: {
      listing: "DMOM1021",
      campaignId: "622725",
      actionType: "SET_LISTING_ACTIVE",
      before: { active: true, bid: 0.61 },
      proposed: { active: false },
    },
    latest: { reportDate: "2026-07-27", active: true, campaignActive: true, bid: 0.61 },
    asOf: "2026-07-27",
  });

  assert.deepEqual(result, { ok: true });
});

test("rejects a duplicate pause against an already inactive listing", () => {
  const result = validateAdActionFreshness({
    action: {
      listing: "DMOM1018",
      campaignId: "622735",
      actionType: "SET_LISTING_ACTIVE",
      before: { active: true, bid: 0.4 },
      proposed: { active: false },
    },
    latest: { reportDate: "2026-07-27", active: false, campaignActive: true, bid: 0.4 },
    asOf: "2026-07-27",
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /已经暂停|无需重复/);
});

test("rejects a bid payload generated from an obsolete current bid", () => {
  const result = validateAdActionFreshness({
    action: {
      listing: "DMOM1021",
      campaignId: "622725",
      actionType: "SET_LISTING_BID",
      before: { active: true, bid: 0.68 },
      proposed: { bid: 0.61 },
    },
    latest: { reportDate: "2026-07-27", active: true, campaignActive: true, bid: 0.61 },
    asOf: "2026-07-27",
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /Bid.*变化|重新生成/);
});

test("fails closed when current campaign evidence is missing or stale", () => {
  assert.equal(validateAdActionFreshness({
    action: { listing: "A", campaignId: "1", actionType: "SET_LISTING_ACTIVE", before: { active: true }, proposed: { active: false } },
    latest: null,
    asOf: "2026-07-27",
  }).ok, false);

  const stale = validateAdActionFreshness({
    action: { listing: "A", campaignId: "1", actionType: "SET_LISTING_ACTIVE", before: { active: true }, proposed: { active: false } },
    latest: { reportDate: "2026-07-23", active: true, campaignActive: true, bid: 0.5 },
    asOf: "2026-07-27",
  });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /过期/);
});

test("rejects campaign drift, listing status drift, and no-op payloads", () => {
  const base = {
    listing: "A",
    campaignId: "1",
    actionType: "SET_LISTING_BID",
    before: { active: true, bid: 0.5 },
    proposed: { bid: 0.45 },
  };
  assert.match(validateAdActionFreshness({
    action: base,
    latest: { reportDate: "2026-07-27", active: true, campaignActive: false, bid: 0.5 },
    asOf: "2026-07-27",
  }).reason, /Campaign 已经暂停/);
  assert.match(validateAdActionFreshness({
    action: base,
    latest: { reportDate: "2026-07-27", active: false, campaignActive: true, bid: 0.5 },
    asOf: "2026-07-27",
  }).reason, /启停状态已变化/);
  assert.match(validateAdActionFreshness({
    action: { ...base, proposed: { bid: 0.5 } },
    latest: { reportDate: "2026-07-27", active: true, campaignActive: true, bid: 0.5 },
    asOf: "2026-07-27",
  }).reason, /已是建议值/);
});

test("requires the execution dry-run to enforce latest-report freshness", async () => {
  const route = await readFile(new URL("../app/api/ads/actions/execute/route.ts", import.meta.url), "utf8");

  assert.match(route, /validateAdActionFreshness/);
  assert.match(route, /LISTING_REPORT/);
  assert.match(route, /report_date/);
  assert.match(route, /最新广告报表预检未通过/);
});
