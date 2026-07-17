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
  assert.match(page, /writeClientCache\(`ad-queue:/);
  assert.doesNotMatch(page, /setQueuedActions\(\[\]\)/);
  assert.match(page, /每小时自动同步/);
});

test("exposes Listing performance and keeps Gate UI only for budget increases", async () => {
  const [page, route, ads] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ads/actions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id: "listings", label: "Listing 表现"/);
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
