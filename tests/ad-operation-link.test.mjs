import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { operationInputForAdAction } from "../lib/ad-operation-link.mjs";

const action = {
  id: "weekly:2026-07-01:2026-07-07:622725:DMOM1021:SET_LISTING_BID",
  run_key: "weekly:2026-07-01:2026-07-07",
  listing: "DMOM1021",
  campaign_id: "622725",
  action_type: "SET_LISTING_BID",
  before_payload: JSON.stringify({ bid: 0.58, active: true }),
  proposed_payload: JSON.stringify({ bid: 0.48 }),
};

test("maps advertising queue states into the shared operation ledger", () => {
  assert.equal(operationInputForAdAction(action, "PLANNED").status, "PENDING_APPROVAL");
  assert.equal(operationInputForAdAction(action, "APPROVED").status, "PENDING_APPROVAL");
  assert.equal(operationInputForAdAction(action, "VALIDATED").status, "PREFLIGHTED");
  const executed = operationInputForAdAction(action, "EXECUTED", { campaignId: "622725", response: { ok: true } });
  assert.equal(executed.status, "PENDING_ACCEPTANCE");
  assert.match(executed.executionResult, /Wayfair Advertising API/);
  assert.equal(executed.evidence.length, 1);
});

test("closes reviewed advertising actions only with a mature verdict", () => {
  const pending = operationInputForAdAction(action, "REVIEWED", { verdict: "PENDING" });
  assert.equal(pending.status, "PENDING_REVIEW");
  const closed = operationInputForAdAction(action, "REVIEWED", { verdict: "EFFECTIVE", summary: "订单提升" });
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.reviewVerdict, "EFFECTIVE");
  assert.equal(closed.acceptedBy, "广告成熟复盘");
});

test("links advertising queue and mature review writers to the operation ledger", async () => {
  const [queue, execute, ads] = await Promise.all([
    readFile(new URL("../app/api/ads/actions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ads/actions/execute/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);
  assert.match(queue, /syncAdActionOperation/);
  assert.match(execute, /syncAdActionOperation/);
  assert.match(ads, /syncAdActionOperation/);
});
