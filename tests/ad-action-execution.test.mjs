import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WAYFAIR_ADVERTISING_AUDIENCE,
  buildCampaignUpdates,
  filterAdActions,
  isBulkApprovable,
  canRetryAction,
  queuedActionState,
  executeCampaignUpdates,
  executionResultForAction,
} from "../lib/ad-action-queue.mjs";

test("maps persisted queue statuses to visible workflow states", () => {
  assert.deepEqual(queuedActionState([
    { campaign_id: "622741", listing: "DMOM1000", status: "PLANNED" },
    { campaign_id: "622742", listing: "DMOM1001", status: "APPROVED" },
    { campaign_id: "622743", listing: "DMOM1002", status: "VALIDATED" },
    { campaign_id: "622746", listing: "DMOM1005", status: "EXECUTING" },
    { campaign_id: "622744", listing: "DMOM1003", status: "EXECUTED" },
    { campaign_id: "622745", listing: "DMOM1004", status: "FAILED" },
  ]), {
    "622741:DMOM1000": "saved",
    "622742:DMOM1001": "approved",
    "622743:DMOM1002": "validated",
    "622746:DMOM1005": "executing",
    "622744:DMOM1003": "executed",
    "622745:DMOM1004": "failed",
  });
});

test("builds exact Wayfair campaign payloads from approved listing actions", () => {
  const batches = buildCampaignUpdates([
    {
      id: "one",
      campaign_id: "622741",
      listing: "DMOM1000",
      action_type: "SET_LISTING_BID",
      before_payload: JSON.stringify({ bid: 0.85, active: true }),
      proposed_payload: JSON.stringify({ bid: 0.76 }),
      status: "APPROVED",
    },
    {
      id: "two",
      campaign_id: "622741",
      listing: "DMOM1001",
      action_type: "SET_LISTING_ACTIVE",
      before_payload: JSON.stringify({ bid: 0.55, active: true }),
      proposed_payload: JSON.stringify({ active: false }),
      status: "APPROVED",
    },
  ]);

  assert.deepEqual(batches, [{
    campaignId: "622741",
    actionIds: ["one", "two"],
    listings: {
      DMOM1000: { bid: "0.76", isActive: true },
      DMOM1001: { bid: "0.55", isActive: false },
    },
  }]);
});

test("blocks invalid and below-minimum bids before any API request", () => {
  assert.throws(() => buildCampaignUpdates([{
    id: "invalid",
    campaign_id: "622741",
    listing: "DMOM1000",
    action_type: "SET_LISTING_BID",
    before_payload: JSON.stringify({ bid: 0.05, active: true }),
    proposed_payload: JSON.stringify({ bid: 0.04 }),
    status: "APPROVED",
  }]), /0\.05/);
});

test("uses Wayfair's production OAuth audience for Advertising API writes", () => {
  assert.equal(WAYFAIR_ADVERTISING_AUDIENCE, "https://api.wayfair.com/");
});

test("allows failed actions to re-enter approval and dry-run, but never replays completed actions", () => {
  assert.equal(canRetryAction("FAILED"), true);
  assert.equal(canRetryAction("EXECUTED"), false);
  assert.equal(canRetryAction("EXECUTING"), false);
});

test("filters weekly recommendations by search, recommendation and queue status", () => {
  const rows = [
    { listing: "DMOM1000", campaignId: "622741", parts: ["5T-1600-800"], action: { recommendation: "READY", execution: "READY_FOR_PLAN" } },
    { listing: "DMOM1022", campaignId: "622722", parts: ["MFC-D3-B"], action: { recommendation: "NO_CHANGE", execution: "HOLD" } },
  ];
  const queue = { "622741:DMOM1000": "saved" };

  assert.deepEqual(filterAdActions(rows, { query: "5t-1600", recommendation: "READY", queue: "queued" }, queue).map((row) => row.listing), ["DMOM1000"]);
  assert.deepEqual(filterAdActions(rows, { query: "622722", recommendation: "ALL", queue: "unqueued" }, queue).map((row) => row.listing), ["DMOM1022"]);
});

test("bulk confirmation accepts only planned and failed API actions", () => {
  assert.equal(isBulkApprovable({ status: "PLANNED", action_type: "SET_LISTING_BID" }), true);
  assert.equal(isBulkApprovable({ status: "FAILED", action_type: "SET_LISTING_ACTIVE" }), true);
  assert.equal(isBulkApprovable({ status: "VALIDATED", action_type: "SET_LISTING_BID" }), false);
  assert.equal(isBulkApprovable({ status: "PLANNED", action_type: "INCREASE_DAILY_CAP" }), false);
});

test("allows listing pause actions through queue validation and live execution routes", async () => {
  const [queueRoute, executeRoute] = await Promise.all([
    readFile(new URL("../app/api/ads/actions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ads/actions/execute/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(queueRoute, /API_ACTIONS = new Set\(\["SET_LISTING_BID", "SET_LISTING_ACTIVE"\]\)/);
  assert.match(executeRoute, /action_type IN \('SET_LISTING_BID','SET_LISTING_ACTIVE'\)/);
});

test("describes a 401 as a token acceptance or permission-sync failure without falsely claiming permissions are disabled", async () => {
  const executeRoute = await readFile(new URL("../app/api/ads/actions/execute/route.ts", import.meta.url), "utf8");

  assert.match(executeRoute, /权限同步.*重新预检/);
  assert.doesNotMatch(executeRoute, /是否同时属于已开启 Modify Bids/);
});

test("continues executing other campaigns when a paused campaign is rejected", async () => {
  const visited = [];
  const outcomes = await executeCampaignUpdates([
    { campaignId: "622723", actionIds: ["paused"], listings: {} },
    { campaignId: "622741", actionIds: ["live"], listings: {} },
  ], async (campaign) => {
    visited.push(campaign.campaignId);
    if (campaign.campaignId === "622723") throw new Error("Cannot update campaign 622723 because it has status: paused (HTTP 400)");
    return { accepted: true };
  });

  assert.deepEqual(visited, ["622723", "622741"]);
  assert.equal(outcomes[0].ok, false);
  assert.match(outcomes[0].error, /Campaign 622723 已暂停/);
  assert.equal(outcomes[1].ok, true);
  assert.deepEqual(outcomes[1].response, { accepted: true });
});

test("turns persisted terminal events into an operator-readable result column", () => {
  assert.deepEqual(executionResultForAction({
    status: "EXECUTED",
    result_event_type: "EXECUTED",
    result_payload: JSON.stringify({ campaignId: "622741", response: { accepted: true } }),
    result_at: "2026-07-17T02:00:00.000Z",
  }), {
    tone: "success",
    title: "已写入 Wayfair",
    detail: "Campaign 622741 · 2026-07-17 10:00",
  });

  const failed = executionResultForAction({
    status: "FAILED",
    result_event_type: "FAILED",
    result_payload: JSON.stringify({ error: "Campaign 622723 已暂停，Wayfair 不允许修改其中的 Listing。" }),
    result_at: "2026-07-17T02:01:00.000Z",
  });
  assert.equal(failed.tone, "error");
  assert.equal(failed.title, "未写入");
  assert.match(failed.detail, /622723 已暂停/);

  assert.deepEqual(executionResultForAction({ status: "PLANNED" }), {
    tone: "neutral",
    title: "尚未执行",
    detail: "等待确认并预检",
  });
});
