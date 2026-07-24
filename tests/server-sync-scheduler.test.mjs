import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runLayeredSync } from "../lib/server-sync.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("refreshes orders every run using the Shanghai month-to-date window", async () => {
  const requests = [];
  const records = [];

  const result = await runLayeredSync({
    scheduledTime: Date.parse("2026-07-21T20:00:00Z"),
    request: async (url) => {
      requests.push(String(url));
      return jsonResponse({ sync: { refreshed: true } });
    },
    record: async (entry) => records.push(entry),
  });

  assert.deepEqual(requests, [
    "https://worker.internal/api/orders/summary?start=2026-07-01&end=2026-07-22&refresh=1",
  ]);
  assert.equal(result.mode, "regular");
  assert.equal(result.ok, true);
  assert.equal(records.at(-1).status, "succeeded");
});

test("runs mature advertising and up to ten catalog pages at 06:00 Shanghai", async () => {
  const requests = [];

  const result = await runLayeredSync({
    scheduledTime: Date.parse("2026-07-21T22:00:00Z"),
    request: async (url) => {
      const value = String(url);
      requests.push(value);
      if (value.includes("/api/catalog/items?page=1")) {
        return jsonResponse({ paginationInfo: { totalPages: 12 }, items: [] });
      }
      return jsonResponse({ items: [] });
    },
    record: async () => {},
  });

  assert.equal(result.mode, "daily-full");
  assert.ok(requests.includes(
    "https://worker.internal/api/ads/analysis?start=2026-07-02&end=2026-07-08&refresh=1",
  ));
  assert.equal(requests.filter((url) => url.includes("/api/catalog/items?")).length, 10);
  assert.ok(requests.includes(
    "https://worker.internal/api/catalog/items?page=10&pageSize=30&refresh=1",
  ));
  assert.equal(requests.some((url) => url.includes("page=11")), false);
});

test("supports a root-level catalog totalPages response", async () => {
  const requests = [];

  await runLayeredSync({
    scheduledTime: Date.parse("2026-07-21T22:00:00Z"),
    request: async (url) => {
      const value = String(url);
      requests.push(value);
      return jsonResponse(value.includes("page=1") ? { totalPages: 3, items: [] } : { items: [] });
    },
    record: async () => {},
  });

  assert.equal(requests.filter((url) => url.includes("/api/catalog/items?")).length, 3);
});

test("defaults catalog pagination to one page when the total is absent", async () => {
  const requests = [];

  await runLayeredSync({
    scheduledTime: Date.parse("2026-07-21T22:00:00Z"),
    request: async (url) => {
      requests.push(String(url));
      return jsonResponse({ items: [] });
    },
    record: async () => {},
  });

  assert.equal(requests.filter((url) => url.includes("/api/catalog/items?")).length, 1);
});

test("records and rethrows HTTP, JSON, and stale-order failures", async (t) => {
  const cases = [
    ["HTTP failure", jsonResponse({ error: "upstream unavailable" }, 502), /HTTP 502/],
    ["JSON error", jsonResponse({ error: "bad payload" }), /bad payload/],
    ["stale order fallback", jsonResponse({ sync: { stale: true, error: "oauth failed" } }), /oauth failed/],
  ];

  for (const [name, response, pattern] of cases) {
    await t.test(name, async () => {
      const records = [];
      await assert.rejects(
        runLayeredSync({
          scheduledTime: Date.parse("2026-07-21T20:00:00Z"),
          request: async () => response.clone(),
          record: async (entry) => records.push(entry),
        }),
        pattern,
      );
      assert.equal(records.at(-1).status, "failed");
      assert.match(records.at(-1).error, pattern);
    });
  }
});

test("rejects invalid JSON without allowing status persistence to hide the sync error", async () => {
  await assert.rejects(
    runLayeredSync({
      scheduledTime: Date.parse("2026-07-21T20:00:00Z"),
      request: async () => new Response("not-json", { status: 200 }),
      record: async () => {
        throw new Error("D1 unavailable");
      },
    }),
    /响应不是有效 JSON/,
  );
});

test("Vercel exports a protected scheduler route and declares the two-hour trigger", async () => {
  const [route, vercel] = await Promise.all([
    readFile(new URL("../app/api/cron/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);

  assert.match(route, /export async function GET/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /runLayeredSync/);
  assert.match(vercel, /0 \*\/2 \* \* \*/);
});

test("scheduler skips Outlook only when Microsoft Graph credentials are incomplete", async () => {
  const route = await readFile(
    new URL("../app/api/cron/sync/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /const outlookConfigured = Boolean\(/);
  assert.match(route, /env\.MICROSOFT_CLIENT_ID/);
  assert.match(route, /env\.MICROSOFT_CLIENT_SECRET/);
  assert.match(
    route,
    /syncOutlook: outlookConfigured\s*\?\s*\(\) => syncOutlookDaily\(\{ env, db, now \}\)\s*:\s*undefined/,
  );
});
