import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WAYFAIR_SCOPE_REGISTRY,
  buildWayfairScopeHealth,
} from "../lib/wayfair-scope-health.mjs";

test("scope registry explicitly excludes shipping, CastleGate, cancellations, and multichannel", () => {
  const excluded = WAYFAIR_SCOPE_REGISTRY
    .filter((item) => item.policy === "excluded")
    .map((item) => item.family);

  assert.ok(excluded.includes("shipping"));
  assert.ok(excluded.includes("castlegate"));
  assert.ok(excluded.includes("order-cancellation"));
  assert.ok(excluded.includes("multichannel"));
  assert.equal(
    WAYFAIR_SCOPE_REGISTRY
      .filter((item) => item.policy === "active")
      .some((item) => /Shipping|CastleGate|Cancellation|Multi Channel/i.test(item.permission)),
    false,
  );
});

test("scope health distinguishes configured access from recent successful API evidence", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  const health = buildWayfairScopeHealth({
    now,
    syncStates: [
      {
        key: "orders",
        value: JSON.stringify({ fetched: 12, pages: 2, complete: true }),
        updated_at: "2026-07-28T10:00:00Z",
      },
      {
        key: "server:catalog:crawl",
        value: JSON.stringify({
          status: "complete",
          integrity: { closed: true },
          uniqueCount: 42,
          expectedTotalCount: 42,
        }),
        updated_at: "2026-07-28T06:30:00Z",
      },
    ],
  });

  assert.equal(health.sources.find((item) => item.id === "orders-read")?.status, "healthy");
  assert.equal(health.sources.find((item) => item.id === "catalog-read")?.status, "healthy");
  assert.equal(health.sources.find((item) => item.id === "advertising-reports")?.status, "unverified");
  assert.equal(health.sources.find((item) => item.id === "inventory-write")?.status, "unverified");
  assert.equal(JSON.stringify(health).includes("secret"), false);
});

test("scope health reports stale evidence and catalog integrity failures", () => {
  const health = buildWayfairScopeHealth({
    now: new Date("2026-07-28T12:00:00Z"),
    syncStates: [
      {
        key: "orders",
        value: JSON.stringify({ fetched: 12, complete: true }),
        updated_at: "2026-07-27T00:00:00Z",
      },
      {
        key: "server:catalog:crawl",
        value: JSON.stringify({ status: "integrity-error", integrity: { closed: false } }),
        updated_at: "2026-07-28T06:30:00Z",
      },
    ],
  });

  assert.equal(health.sources.find((item) => item.id === "orders-read")?.status, "stale");
  assert.equal(health.sources.find((item) => item.id === "catalog-read")?.status, "failed");
  assert.equal(health.summary.failed, 1);
});

test("production build has no online Google font dependency and the dashboard renders scope health", async () => {
  const [layout, css, readinessRoute, page] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/system/readiness/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(css, /--font-geist-sans:/);
  assert.match(css, /--font-geist-mono:/);
  assert.match(readinessRoute, /buildWayfairScopeHealth/);
  assert.match(page, /scopeHealth/);
  assert.match(page, /Scope Health|权限调用健康/);
});
