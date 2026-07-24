import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_LEARNING_DAYS,
  AI_LEARNING_ORDER_TARGET,
  diagnoseAiCampaign,
} from "../lib/ai-campaign-diagnosis.mjs";

test("flags campaign 660198 as overdue learning and escalates without changing controls", () => {
  const diagnosis = diagnoseAiCampaign({
    campaignId: "660198",
    campaignName: "8T-kayak",
    strategy: "AI Bidding - TROAS",
    status: "ACTIVE",
    isActive: "TRUE",
    startDate: "2026-06-23",
    asOf: "2026-07-20",
    orders14d: 0,
    spend14d: 31.74,
    clicks14d: 13,
    dailyCap: "NO DAILY CAP",
    targetRoas: "300",
  });

  assert.equal(AI_LEARNING_DAYS, 14);
  assert.equal(AI_LEARNING_ORDER_TARGET, 50);
  assert.equal(diagnosis.stage, "LEARNING_OVERDUE");
  assert.equal(diagnosis.priority, "P0");
  assert.equal(diagnosis.action, "CONTACT_ACCOUNT_MANAGER");
  assert.equal(diagnosis.daysActive, 28);
  assert.equal(diagnosis.remainingOrders, 50);
  assert.equal(diagnosis.noDailyCap, true);
  assert.equal(diagnosis.significantChangesBlocked, true);
  assert.match(diagnosis.summary, /超过14天/);
  assert.match(diagnosis.guardrail, /不要修改 tROAS、Daily Cap 或 Listing/);
});

test("does not let an archived campaign report hide Partner Home active learning", () => {
  const diagnosis = diagnoseAiCampaign({
    campaignId: "660198",
    campaignName: "8T-kayak",
    strategy: "AI Bidding - TROAS",
    status: "archived",
    isActive: "FALSE",
    platformStage: "ACTIVE_LEARNING",
    platformObservedAt: "2026-07-20",
    platformSource: "Partner Home",
    startDate: "2026-06-23",
    asOf: "2026-07-20",
    orders14d: 0,
    dailyCap: "NO DAILY CAP",
    targetRoas: "300",
  });

  assert.equal(diagnosis.stage, "LEARNING_OVERDUE");
  assert.equal(diagnosis.priority, "P0");
  assert.equal(diagnosis.action, "CONTACT_ACCOUNT_MANAGER");
  assert.equal(diagnosis.statusConflict, true);
  assert.equal(diagnosis.reportedStatus, "archived / FALSE");
  assert.match(diagnosis.summary, /状态冲突/);
  assert.match(diagnosis.guardrail, /不要恢复 Campaign/);
});

test("keeps a new AI campaign in protected learning until it reaches 50 attributed orders", () => {
  const diagnosis = diagnoseAiCampaign({
    campaignId: "700001",
    campaignName: "Learning pilot",
    strategy: "AI Bidding - TROAS",
    status: "ACTIVE",
    isActive: "TRUE",
    startDate: "2026-07-10",
    asOf: "2026-07-20",
    orders14d: 12,
    spend14d: 40,
    clicks14d: 80,
    dailyCap: "5",
    targetRoas: "500",
  });

  assert.equal(diagnosis.stage, "LEARNING");
  assert.equal(diagnosis.action, "WAIT_FOR_LEARNING");
  assert.equal(diagnosis.remainingOrders, 38);
  assert.equal(diagnosis.significantChangesBlocked, true);
  assert.equal(diagnosis.noDailyCap, false);
});

test("marks an AI campaign learned only after 50 attributed orders in the latest 14 days", () => {
  const diagnosis = diagnoseAiCampaign({
    campaignId: "700002",
    campaignName: "Mature AI",
    strategy: "AI Bidding - TROAS",
    status: "ACTIVE",
    isActive: "TRUE",
    startDate: "2026-06-01",
    asOf: "2026-07-20",
    orders14d: 50,
    spend14d: 500,
    clicks14d: 800,
    dailyCap: "40",
    targetRoas: "450",
  });

  assert.equal(diagnosis.stage, "LEARNED");
  assert.equal(diagnosis.action, "REVIEW_TARGETS");
  assert.equal(diagnosis.remainingOrders, 0);
  assert.equal(diagnosis.significantChangesBlocked, false);
});

test("does not classify Manual Bidding campaigns as AI learning", () => {
  assert.equal(diagnoseAiCampaign({
    campaignId: "622725",
    strategy: "Manual Bidding",
    status: "ACTIVE",
    isActive: "TRUE",
    startDate: "2026-04-14",
    asOf: "2026-07-20",
    orders14d: 20,
    dailyCap: "10",
  }), null);
});
