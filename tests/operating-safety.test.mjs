import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertLiveOperation, buildOperatingReadiness } from "../lib/operating-safety.mjs";
import { METRIC_DEFINITIONS } from "../lib/metric-definitions.mjs";

const productionEnv = {
  RUNTIME_PLATFORM: "cloudflare",
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
