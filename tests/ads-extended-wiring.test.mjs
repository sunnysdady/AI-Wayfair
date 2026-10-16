import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { navigationStateFromSearch } from "../lib/app-navigation.mjs";
import { runLayeredSync } from "../lib/server-sync.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const DAILY = Date.parse("2026-10-16T10:00:00Z"); // 06:00 Lingxing

function runner({ extendedAds, failing = [] } = {}) {
  const requests = [];
  const run = () => runLayeredSync({
    scheduledTime: DAILY,
    extendedAds,
    catalogPageBudget: 1,
    request: async (url) => {
      const value = String(url);
      requests.push(value);
      for (const marker of failing) if (value.includes(marker)) return json({ sync: { status: "failed", error: "boom" } });
      if (value.includes("/api/ads/keywords") || value.includes("/api/ads/rank")) return json({ sync: { status: "ok" } });
      if (value.includes("/api/catalog/items")) return json({ paginationInfo: { totalPages: 1, totalCount: 1 }, items: [{ supplierPartNumber: "S1" }] });
      return json({});
    },
    loadCatalogCheckpoint: async () => null,
    saveCatalogCheckpoint: async () => {},
    record: async () => {},
  });
  return { requests, run };
}

test("flag off: the 06:00 job makes exactly the same requests as before", async () => {
  const { requests, run } = runner({ extendedAds: false });
  const result = await run();
  assert.ok(!requests.some((url) => /\/api\/ads\/(keywords|rank)/.test(url)));
  assert.ok(!result.completed.includes("ads-keywords"));
  assert.equal("warnings" in result, false);
});

test("flag on: keyword and rank steps run after the existing ads step with the 14 closed days", async () => {
  const { requests, run } = runner({ extendedAds: true });
  const result = await run();
  const order = requests.map((url) => new URL(url).pathname);
  assert.ok(order.indexOf("/api/ads/analysis") < order.indexOf("/api/ads/keywords"));
  assert.ok(requests.includes("https://worker.internal/api/ads/keywords?start=2026-10-02&end=2026-10-15&refresh=1"));
  assert.ok(requests.includes("https://worker.internal/api/ads/rank?start=2026-10-02&end=2026-10-15&refresh=1"));
  assert.deepEqual(result.completed.filter((step) => step.startsWith("ads")), ["ads", "ads-keywords", "ads-rank"]);
});

test("flag on: a failing extended step becomes a warning and never fails orders, ads or catalog", async () => {
  const { run } = runner({ extendedAds: true, failing: ["/api/ads/keywords"] });
  const result = await run();
  assert.equal(result.ok, true);
  assert.deepEqual(result.completed.filter((step) => step.startsWith("ads")), ["ads", "ads-rank"]);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].step, "ads-keywords");
  assert.match(result.warnings[0].error, /boom/);
  assert.ok(result.completed.includes("catalog:1"));
});

test("regular (non-06:00) runs never touch the extended reports even with the flag on", async () => {
  const requests = [];
  await runLayeredSync({ scheduledTime: Date.parse("2026-10-16T20:00:00Z"), extendedAds: true, request: async (url) => { requests.push(String(url)); return json({}); }, record: async () => {} });
  assert.ok(!requests.some((url) => /\/api\/ads\//.test(url)));
});

test("cron route passes the flag through and routes are GET-only advisory views", async () => {
  const cron = await readFile(new URL("../app/api/cron/sync/route.ts", import.meta.url), "utf8");
  assert.match(cron, /extendedAds: extendedReportsEnabled\(env\)/);
  for (const name of ["keywords", "rank"]) {
    const route = await readFile(new URL(`../app/api/ads/${name}/route.ts`, import.meta.url), "utf8");
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
    assert.match(route, /sameOrigin/);
  }
});

test("deep links open the new ads sub-pages", () => {
  assert.deepEqual(navigationStateFromSearch("?view=ads&tab=keywords"), { view: "ads", tab: "keywords" });
  assert.deepEqual(navigationStateFromSearch("?view=ads&tab=rank"), { view: "ads", tab: "rank" });
});

test("ads page registers both sub-pages and the TACOS panel, and the new UI has no write requests or emoji", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");
  assert.match(page, /\{ id: "keywords", label: "关键词表现" \}/);
  assert.match(page, /\{ id: "rank", label: "排名" \}/);
  assert.match(page, /\{tab === "keywords" && <KeywordPerformanceTab \/>\}/);
  assert.match(page, /\{tab === "rank" && <RankTab \/>\}/);
  assert.match(page, /<TacosGuardPanel guard=/);
  const ui = await readFile(new URL("../app/AdsKeywordRank.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /method:\s*["'](POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(ui, /\p{Extended_Pictographic}/u);
  assert.match(ui, /只给建议，不自动改预算或出价/);
  assert.match(ui, /疑似亏损（估算）/);
});

test("analysis output carries the TACOS guard but failures never break it", async () => {
  const source = await readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8");
  assert.match(source, /tacosGuard = buildTacosGuard\(/);
  assert.match(source, /tacosGuard = \{ error:/);
});
