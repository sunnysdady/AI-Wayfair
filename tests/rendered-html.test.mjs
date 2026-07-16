import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the Wayfair AI operations product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Wayfair AI 运营中台/);
  assert.match(html, /经营日报/);
  assert.match(html, /最近 7 天/);
  assert.match(html, /广告前商品毛利/);
  assert.match(html, /广告后店铺贡献/);
  assert.doesNotMatch(html, /实际利润/);
  assert.match(html, /广告优化/);
  assert.match(html, /Ops API（库存 \+ 订单）/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("keeps July execution and BFIJ strategy between June review and August preparation", async () => {
  const [page, plan] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/operating-plan.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /6月复盘 → 7月真实基线执行 → 8月下一阶段准备/);
  assert.match(page, /7月执行计划/);
  assert.match(page, /BFIJ 活动广告策略/);
  assert.doesNotMatch(page, /7月 · 目标未建档/);
  assert.match(plan, /orderTarget: 128/);
  assert.match(plan, /adBudget: 790/);
  assert.match(plan, /strategyBudget: 330/);
  assert.match(plan, /officialEventRange: "2026-07-23\/2026-07-28"/);
  assert.match(plan, /flashConfirmationDeadline: "2026-07-17"/);
});

test("separates the visible advertising period from the mature weekly decision window", async () => {
  const [page, ads] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /成熟周（推荐）/);
  assert.match(page, /最近 14 天/);
  assert.match(page, /加入本周执行单/);
  assert.match(page, /保本ROAS/);
  assert.match(ads, /attributionWindowDays: ATTRIBUTION_DAYS/);
  assert.match(ads, /rolling56d/);
  assert.match(ads, /ad_decision_runs/);
  assert.match(ads, /ad_report_rows/);
  assert.match(ads, /inventory/);
});

test("persists real inventory snapshots and uploaded monthly reports", async () => {
  const [page, inventory, reportRoute, hosting] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /补充复盘资料/);
  assert.match(page, /直接阅读完整原报告/);
  assert.match(page, /选择领星库存 XLSX/);
  assert.match(inventory, /inventory_snapshots/);
  assert.match(inventory, /inventory_snapshot_rows/);
  assert.match(reportRoute, /env\.FILES\.put/);
  assert.match(reportRoute, /export async function DELETE/);
  assert.match(hosting, /"r2": "FILES"/);
});

test("ships the complete evidence library instead of summary placeholders", async () => {
  const files = [
    "Wayfair_7月推广计划_v3真实基线_20260623.html",
    "Wayfair 北美地区 Black Friday in July官宣定档！.pdf",
    "YB店_8月150单完整增长Playbook.html",
    "YB店_店铺诊断报告.html",
    "YB店_SKU健康体检.html",
    "YB店_SKU广告重构执行清单_2026-07-15.xlsx",
  ];
  for (const file of files) {
    const contents = await readFile(new URL(`../public/reports/${file}`, import.meta.url));
    assert.ok(contents.byteLength > 100, `${file} should contain a real report`);
  }
});

test("restores persisted weekly actions after the advertising page reloads", async () => {
  const [{ queuedActionState }, page] = await Promise.all([
    import("../lib/ad-action-queue.mjs"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(queuedActionState([
    { campaign_id: "622741", listing: "DMOM1000", status: "PLANNED" },
    { campaign_id: "622731", listing: "DMOM1029", status: "EXECUTED" },
  ]), {
    "622741:DMOM1000": "saved",
    "622731:DMOM1029": "executed",
  });
  assert.match(page, /\/api\/ads\/actions\?runKey=/);
  assert.match(page, /queuedActionState/);
  assert.match(page, /本周执行批次/);
  assert.match(page, /确认进入 API 预检/);
});
