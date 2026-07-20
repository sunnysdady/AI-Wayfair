import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAiAdCandidate } from "../lib/ai-ad-eligibility.mjs";

test("blocks AI launch when a SKU cannot support 50 attributed orders in 14 days", () => {
  const result = evaluateAiAdCandidate({
    listing: "DMOM1021",
    orders14d: 9,
    spend14d: 150,
    wsc14d: 900,
    inventoryKnown: true,
    coverDays: 120,
    linkPass: true,
    marginRate: 0.346,
    breakEvenRoas: 2.89,
  });

  assert.equal(result.status, "NOT_READY");
  assert.equal(result.orderGap, 41);
  assert.equal(result.canLaunch, false);
  assert.match(result.whenToLaunch, /滚动14天达到50个归因订单/);
});

test("sets spend controls before launch and freezes them during learning", () => {
  const result = evaluateAiAdCandidate({
    listing: "READY-SKU",
    orders14d: 56,
    spend14d: 420,
    wsc14d: 2800,
    inventoryKnown: true,
    coverDays: 90,
    linkPass: true,
    marginRate: 0.35,
    breakEvenRoas: 2.86,
  });

  assert.equal(result.status, "ELIGIBLE");
  assert.equal(result.canLaunch, true);
  assert.ok(result.preLaunchDailyCap > 0);
  assert.ok(result.targetRoasFloor >= 350);
  assert.match(result.guardrail, /启用前设置/);
  assert.match(result.guardrail, /学习期内不改/);
});

test("blocks AI launch when catalog or inventory evidence is unsafe", () => {
  const result = evaluateAiAdCandidate({
    listing: "RISKY-SKU",
    orders14d: 60,
    spend14d: 300,
    wsc14d: 2400,
    inventoryKnown: true,
    coverDays: 12,
    linkPass: false,
    marginRate: 0.3,
    breakEvenRoas: 3.33,
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.canLaunch, false);
  assert.ok(result.blockers.some(item => /Listing/.test(item)));
  assert.ok(result.blockers.some(item => /库存/.test(item)));
});
