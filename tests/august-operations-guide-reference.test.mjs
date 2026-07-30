import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the August operations guide and its learning ledger as system reports", async () => {
  const [guide, ledger, page] = await Promise.all([
    readFile(new URL("../public/reports/YB店_2026年8月运营指南.html", import.meta.url)),
    readFile(new URL("../public/reports/YB店_2026年8月运营记录与学习台账.xlsx", import.meta.url)),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.ok(guide.byteLength > 50_000);
  assert.ok(ledger.byteLength > 20_000);
  assert.match(guide.toString("utf8"), /目标—护栏—动作—记录—复盘—升级/);
  assert.match(page, /title: "YB店 2026年8月运营指南"/);
  assert.match(page, /file: "YB店_2026年8月运营指南\.html"/);
  assert.match(page, /kind: "运行参考"/);
});

test("exposes the guide as a structured non-authoritative AI operating reference", async () => {
  const [plan, route, ads] = await Promise.all([
    readFile(new URL("../lib/operating-plan.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan/progress/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);

  assert.match(plan, /export const AUGUST_OPERATIONS_GUIDE/);
  assert.match(plan, /authority: "REFERENCE_ONLY"/);
  assert.match(plan, /effectiveExecutionPolicyId: AUGUST_EXECUTION_POLICY\.id/);
  assert.match(plan, /file: "YB店_2026年8月运营指南\.html"/);
  assert.match(plan, /ledgerFile: "YB店_2026年8月运营记录与学习台账\.xlsx"/);
  assert.match(plan, /targetMetric: "UNITS"/);
  assert.match(plan, /weeklyTargets: \[30, 35, 40, 45\]/);
  assert.match(plan, /guardrails: \[/);
  assert.match(plan, /id: "G10"/);
  assert.match(plan, /learningRules: \[/);
  assert.match(plan, /id: "L7"/);
  assert.match(plan, /TARGET_METRIC_CONFLICT/);
  assert.match(plan, /AD_CAP_CONFLICT/);
  assert.match(plan, /MARGIN_FLOOR_CONFLICT/);
  assert.match(route, /operatingGuide: AUGUST_OPERATIONS_GUIDE/);
  assert.match(ads, /operatingReference: AUGUST_OPERATIONS_GUIDE/);
});
