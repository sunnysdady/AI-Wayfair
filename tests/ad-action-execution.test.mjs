import assert from "node:assert/strict";
import test from "node:test";

import { buildCampaignUpdates, queuedActionState } from "../lib/ad-action-queue.mjs";

test("maps persisted queue statuses to visible workflow states", () => {
  assert.deepEqual(queuedActionState([
    { campaign_id: "622741", listing: "DMOM1000", status: "PLANNED" },
    { campaign_id: "622742", listing: "DMOM1001", status: "APPROVED" },
    { campaign_id: "622743", listing: "DMOM1002", status: "VALIDATED" },
    { campaign_id: "622744", listing: "DMOM1003", status: "EXECUTED" },
    { campaign_id: "622745", listing: "DMOM1004", status: "FAILED" },
  ]), {
    "622741:DMOM1000": "saved",
    "622742:DMOM1001": "approved",
    "622743:DMOM1002": "validated",
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
