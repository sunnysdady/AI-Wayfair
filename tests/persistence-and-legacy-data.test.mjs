import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps one-hour snapshots across page switches without clearing ad actions", async () => {
  const [page, cache, ads, orders, catalog] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/client-cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/orders/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/catalog/items/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(cache, /60 \* 60 \* 1000/);
  assert.match(cache, /window\.localStorage/);
  assert.match(cache, /STORAGE_PREFIX/);
  assert.match(ads, /60 \* 60 \* 1000/);
  assert.match(orders, /60 \* 60 \* 1000/);
  assert.match(catalog, /60 \* 60 \* 1000/);
  assert.match(page, /ad-queue:/);
  assert.match(page, /ads:v7:/);
  assert.doesNotMatch(page, /`ads:\$\{/);
  assert.match(page, /writeClientCache\(`ad-queue:/);
  assert.doesNotMatch(page, /setQueuedActions\(\[\]\)/);
  assert.match(page, /每小时自动同步/);
});

test("renders retained global snapshots immediately and refreshes stale data in the background", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

  assert.match(page, /orders:\$\{initialRange\.start\}:\$\{initialRange\.end\}/);
  assert.match(page, /readClientCache<OrderSummary>\(initialDashboardCacheKey,CLIENT_CACHE_RETENTION_MS\)/);
  assert.match(page, /const fresh=readClientCache<OrderSummary>\(cacheKey\)/);
  assert.match(page, /const retained=readClientCache<OrderSummary>\(cacheKey,CLIENT_CACHE_RETENTION_MS\)/);
  assert.match(page, /retained\?"后台更新中":"同步中"/);
  assert.match(page, /ad-history:dashboard/);
  assert.match(page, /system:readiness/);
});

test("offers a compact accessible manual refresh without clearing the retained dashboard", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /function refreshDashboard\(\)/);
  assert.match(page, /refresh=1/);
  assert.match(page, /className=\{`dashboard-refresh/);
  assert.match(page, /aria-label="立即刷新订单数据"/);
  assert.match(page, /title="立即刷新"/);
  assert.match(page, /disabled=\{refreshing\}/);
  assert.match(styles, /\.dashboard-refresh\{/);
  assert.match(styles, /\.dashboard-refresh\.refreshing svg/);
});

test("refreshes current campaign learning data while keeping Listing decisions on the mature window", async () => {
  const ads = await readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8");
  assert.match(ads, /const campaignFetchEnd = today/);
  assert.match(ads, /const listingFetchEnd = \[end, decisionEnd\]/);
  assert.match(ads, /fetchReport\(reportType, refreshStart, refreshEnd/);
  assert.match(ads, /getReportRows\(env\.DB, "CAMPAIGN_REPORT", fetchStart, campaignFetchEnd, token, force, start, campaignFetchEnd\)/);
  assert.match(ads, /getReportRows\(env\.DB, "LISTING_REPORT", fetchStart, listingFetchEnd, token, force, start, end\)/);
});

test("labels advertising performance at the parent-SKU grain and keeps Gate UI only for budget increases", async () => {
  const [page, route, ads] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ads/actions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id: "listings", label: "父体 SKU 广告表现"/);
  assert.match(page, /tab==='listings'\?'\u7236体 SKU 广告表现'/);
  assert.match(page, /\$\{data\?\.listings\.length\|\|0\} 个父体 SKU/);
  assert.match(page, /按父体 Listing 汇总广告指标/);
  assert.match(page, /子体 Supplier Part 仅展示关联关系，不拆分广告归因/);
  assert.match(page, /label="父体 SKU \/ Campaign"/);
  assert.match(page, /tab==='listings'/);
  assert.match(page, /预算审批/);
  assert.doesNotMatch(page, /gateOverrides|toggleQueueSelection|运营人工覆盖|勾选后确认覆盖/);
  assert.doesNotMatch(route, /gateOverride|覆盖自动 Gate/);
  assert.doesNotMatch(ads, /未进入7月推广计划/);
});

test("integrates Git-backed SKU economics and 13-month history", async () => {
  const [page, data] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../data/dmom-operating-2026-06.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(data.skus.length, 90);
  assert.equal(data.trend.months.length, 13);
  assert.match(page, /id: "performance", label: "SKU 经营"/);
  assert.match(page, /id: "history", label: "历史月度"/);
  assert.match(page, /SKU 经营表现/);
  assert.match(page, /13 个月账户全景/);
  assert.match(page, /广告依赖度 · 2026年1–6月/);
});
