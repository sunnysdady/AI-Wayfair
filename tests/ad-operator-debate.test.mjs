import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyOperatorDebate } from "../lib/ad-operator-debate.mjs";

const bidChange = {
  actionType: "SET_LISTING_BID",
  label: "Bid 下调10%",
  proposed: { bid: 0.55 },
  reasons: ["成熟窗口低于保本线"],
  warnings: [],
};

test("a recent setting change forces the operations agent to hold through the cooldown", () => {
  const result = applyOperatorDebate({
    strategy: bidChange,
    liveSafety: { status: "WATCH" },
    lastChangeDate: "2026-07-23",
    asOf: "2026-07-27",
    cooldownDays: 7,
  });

  assert.equal(result.strategy.actionType, "HOLD");
  assert.equal(result.review.verdict, "HOLD");
  assert.equal(result.review.stage, "COOLING_OFF");
  assert.match(result.review.counterpoint, /刚调整|冷却/);
});

test("a short-window alert remains an observation and never becomes an operating action", () => {
  const result = applyOperatorDebate({
    strategy: { ...bidChange, actionType: "HOLD", label: "实时预警", proposed: {} },
    liveSafety: { status: "ALERT" },
    lastChangeDate: null,
    asOf: "2026-07-27",
    cooldownDays: 7,
  });

  assert.equal(result.strategy.actionType, "HOLD");
  assert.equal(result.review.stage, "OBSERVE");
  assert.match(result.review.counterpoint, /归因|波动/);
});

test("a persistent emergency stop becomes a candidate, not an automatic execution", () => {
  const result = applyOperatorDebate({
    strategy: { ...bidChange, actionType: "SET_LISTING_ACTIVE", label: "持续止损", proposed: { active: false } },
    liveSafety: { status: "CONFIRMED_STOP" },
    lastChangeDate: null,
    asOf: "2026-07-27",
    cooldownDays: 7,
  });

  assert.equal(result.strategy.actionType, "SET_LISTING_ACTIVE");
  assert.equal(result.review.verdict, "CANDIDATE");
  assert.equal(result.review.requiresHumanApproval, true);
});

test("a mature proposal can proceed only after operations records its counterargument and controls", () => {
  const result = applyOperatorDebate({
    strategy: bidChange,
    liveSafety: { status: "WATCH" },
    lastChangeDate: "2026-07-10",
    asOf: "2026-07-27",
    cooldownDays: 7,
  });

  assert.equal(result.strategy.actionType, "SET_LISTING_BID");
  assert.equal(result.review.verdict, "CANDIDATE");
  assert.ok(result.review.controls.some((item) => /单一变量/.test(item)));
  assert.ok(result.review.controls.some((item) => /回滚/.test(item)));
});

test("wires the operations debate into every recommendation, queue boundary, and the workbench", async () => {
  const [analysis, page, queue, execute] = await Promise.all([
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ads/actions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ads/actions/execute/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(analysis, /applyOperatorDebate/);
  assert.match(analysis, /operatorReview/);
  assert.match(analysis, /KNOWN_PORTFOLIO_CHANGE_DATE\s*=\s*"2026-07-17"/);
  assert.match(analysis, /KNOWN_PORTFOLIO_COOLDOWN_UNTIL\s*=\s*"2026-08-07"/);
  assert.match(page, /运营 Agent 辩论/);
  assert.match(page, /row\.operatorReview/);
  assert.match(queue, /运营 Agent 辩论未形成候选动作/);
  assert.match(queue, /单一变量锁禁止叠加动作/);
  assert.match(execute, /validateOperatorGate/);
});
