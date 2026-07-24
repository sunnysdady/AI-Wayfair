import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertLiveOperation, buildOperatingReadiness } from "../lib/operating-safety.mjs";
import { METRIC_DEFINITIONS } from "../lib/metric-definitions.mjs";
import { calculateInventoryValueRisk } from "../lib/inventory-value-risk.mjs";
import { classifyInventoryFeed, summarizeInventoryFeeds } from "../lib/wayfair-inventory-feed.mjs";

const productionEnv = {
  RUNTIME_PLATFORM: "node",
  WAYFAIR_DEPLOYMENT_ENV: "production",
  WAYFAIR_EXPECTED_SUPPLIER_IDS: "360344,360342",
  WAYFAIR_CATALOG_SUPPLIER_ID: "360344",
  WAYFAIR_OPS_CLIENT_ID: "ops-id",
  WAYFAIR_OPS_CLIENT_SECRET: "ops-secret",
  WAYFAIR_AD_CLIENT_ID: "ad-id",
  WAYFAIR_AD_CLIENT_SECRET: "ad-secret",
  WAYFAIR_CATALOG_CLIENT_ID: "catalog-id",
  WAYFAIR_CATALOG_CLIENT_SECRET: "catalog-secret",
  ALLOW_WAYFAIR_LIVE_PUSH: "true",
  ALLOW_WAYFAIR_AD_LIVE_CHANGES: "true",
};

test("fails closed unless production environment and supplier identity are explicit", () => {
  const readiness = buildOperatingReadiness({ ...productionEnv, WAYFAIR_DEPLOYMENT_ENV: "preview" });
  assert.equal(readiness.environment.verified, false);
  assert.equal(readiness.live.ads.allowed, false);
  assert.match(readiness.live.ads.blockers.join(" "), /production/);
  assert.throws(() => assertLiveOperation({ ...productionEnv, WAYFAIR_DEPLOYMENT_ENV: "preview" }, "ads"), /生产环境/);
});

test("rejects supplier drift before inventory writes", () => {
  assert.throws(() => assertLiveOperation(productionEnv, "inventory", [360344, 999999]), /999999/);
  assert.doesNotThrow(() => assertLiveOperation(productionEnv, "inventory", [360344, 360342]));
});

test("publishes source readiness and metric provenance without exposing credentials", () => {
  const readiness = buildOperatingReadiness(productionEnv);
  assert.equal(readiness.identity.verified, true);
  assert.equal(readiness.sources.find((item) => item.id === "advertising")?.status, "ready");
  assert.equal(JSON.stringify(readiness).includes("ops-secret"), false);
  assert.ok(METRIC_DEFINITIONS.every((metric) => metric.definition && metric.source && metric.grain));
  assert.equal(METRIC_DEFINITIONS.find((metric) => metric.id === "orders")?.unit, "orders");
  assert.equal(METRIC_DEFINITIONS.find((metric) => metric.id === "units")?.unit, "units");
});

test("enforces the shared live gate in both Wayfair write routes and renders dynamic readiness", async () => {
  const [ads, inventory, page, envTypes] = await Promise.all([
    readFile(new URL("../app/api/ads/actions/execute/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/push/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../env.d.ts", import.meta.url), "utf8"),
  ]);
  assert.match(ads, /assertLiveOperation\(env, "ads"\)/);
  assert.match(inventory, /assertLiveOperation\(env, "inventory", items\.map/);
  assert.match(page, /\/api\/system\/readiness/);
  assert.doesNotMatch(page, /\['Advertising API','生产'/);
  assert.match(envTypes, /WAYFAIR_DEPLOYMENT_ENV/);
  assert.match(envTypes, /WAYFAIR_EXPECTED_SUPPLIER_IDS/);
});

test("weights inventory snapshot changes by SKU cost instead of row count", async () => {
  const risk = calculateInventoryValueRisk(
    [{ partNumber: "A", quantityOnHand: 10 }, { partNumber: "B", quantityOnHand: 5 }],
    [{ partNumber: "A", quantityOnHand: 6 }, { partNumber: "B", quantityOnHand: 9 }],
    { A: 1200 },
  );
  assert.equal(risk.inventoryValue, 120);
  assert.equal(risk.absoluteChangeValue, 48);
  assert.equal(risk.unvaluedUnits, 5);
  assert.equal(risk.costCoverage, 10 / 15);
  assert.deepEqual(risk.topChanges[0], { partNumber: "A", unitDelta: 4, valueDelta: 48 });

  const [inventory, preview] = await Promise.all([
    readFile(new URL("../lib/inventory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/preview/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(inventory, /loadInventoryValueRisk/);
  assert.match(preview, /valueRisk/);
});

test("only treats fully reconciled Wayfair inventory feeds as completed", () => {
  const completed = classifyInventoryFeed({ id: "feed-1", status: "COMPLETE", completedAt: "2026-07-23T15:30:00Z", itemCount: 5, completedCount: 5, processingCount: 0, errorCount: 0, errors: [] });
  const processing = classifyInventoryFeed({ id: "feed-2", status: "PROCESSING", itemCount: 5, completedCount: 2, processingCount: 3, errorCount: 0, errors: [] });
  const failed = classifyInventoryFeed({ id: "feed-3", status: "COMPLETE", completedAt: "2026-07-23T15:30:00Z", itemCount: 5, completedCount: 4, processingCount: 0, errorCount: 0, errors: [] });
  assert.equal(completed.state, "completed");
  assert.equal(processing.state, "processing");
  assert.equal(failed.state, "failed");
  assert.equal(summarizeInventoryFeeds([completed, processing]).status, "processing");
  assert.equal(summarizeInventoryFeeds([completed, failed]).status, "failed");
});

test("inventory UI and route do not equate HTTP success with completed processing", async () => {
  const [route, inventory, page] = await Promise.all([
    readFile(new URL("../app/api/inventory/push/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /classifyInventoryFeed/);
  assert.match(route, /saveInventoryPushRun/);
  assert.match(route, /transactions\(filters:\[\{field:id,equals:\$id\}\]/);
  assert.match(route, /resumePushId/);
  assert.match(inventory, /inventory_push_batches/);
  assert.match(route, /status:202/);
  assert.match(page, /waitForPush/);
  assert.match(page, /Wayfair 处理中/);
  assert.match(page, /Wayfair feed 已处理/);
  assert.doesNotMatch(page, /正式库存已提交，共/);
});

test("uses differential inventory feeds for partial batches and avoids false applied claims", async () => {
  const [route, page] = await Promise.all([
    readFile(new URL("../app/api/inventory/push/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /INVENTORY_FEED_KIND\s*=\s*"DIFFERENTIAL"/);
  assert.match(route, /feedKind:INVENTORY_FEED_KIND/);
  assert.doesNotMatch(route, /feedKind:"TRUE_UP"/);
  assert.match(page, /Wayfair feed 已处理/);
  assert.doesNotMatch(page, /Wayfair 已完成处理/);
});
