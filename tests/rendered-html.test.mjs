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
