import assert from "node:assert/strict";
import test from "node:test";

import {
  WAYFAIR_ADVERTISING_AUDIENCE,
  buildCampaignUpdates,
  filterAdActions,
  isBulkApprovable,
  canRetryAction,
  queuedActionState,
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
