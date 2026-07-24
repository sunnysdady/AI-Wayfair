import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getRuntimeBindings } from "../lib/runtime-bindings.mjs";

const routes = [
  "ads/actions/execute",
  "ads/actions",
  "ads/analysis",
  "ads/history",
  "catalog/items",
  "email/daily",
  "inventory/preview",
  "inventory/push",
  "orders/summary",
  "plan/progress",
  "reports/file",
  "reports",
];

test("provides explicit safe stubs when standalone persistence is unconfigured", async () => {
  const env = await getRuntimeBindings();

  assert.equal(env.RUNTIME_PLATFORM, "node");
  assert.throws(() => env.DB.prepare("SELECT 1"), /configure DATABASE_URL/);
  await assert.rejects(env.FILES.get("report"), /configure S3_BUCKET/);
});

test("routes resolve bindings through the cross-platform helper", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /import\("cloudflare:workers"\)/, route);
    assert.match(source, /getRuntimeBindings/, route);
  }
});
