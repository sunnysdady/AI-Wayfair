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

test("provides explicit safe stubs when Cloudflare bindings are unavailable", async () => {
  const env = await getRuntimeBindings(async () => {
    throw new Error("cloudflare:workers is unavailable");
  });

  assert.equal(env.RUNTIME_PLATFORM, "vercel");
  assert.throws(() => env.DB.prepare("SELECT 1"), /D1 binding is unavailable on Vercel/);
  await assert.rejects(env.FILES.get("report"), /R2 binding is unavailable on Vercel/);
});

test("preserves native bindings when Cloudflare provides them", async () => {
  const native = { DB: { prepare() {} }, FILES: { get() {} } };
  const env = await getRuntimeBindings(async () => ({ env: native }));

  assert.equal(env.RUNTIME_PLATFORM, "cloudflare");
  assert.equal(env.DB, native.DB);
  assert.equal(env.FILES, native.FILES);
});

test("routes resolve bindings through the cross-platform helper", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /import\("cloudflare:workers"\)/, route);
    assert.match(source, /getRuntimeBindings/, route);
  }
});
