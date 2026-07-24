import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { nextShanghaiSyncBoundary } from "../scripts/sync-scheduler.mjs";
import { runScheduledSync } from "../scripts/run-scheduled-sync.mjs";

test("DigitalOcean deployment separates web, scheduler, migration, and TLS proxy", async () => {
  const compose = await readFile(
    new URL("../docker-compose.production.yml", import.meta.url),
    "utf8",
  );
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const caddy = await readFile(
    new URL("../deploy/digitalocean/Caddyfile", import.meta.url),
    "utf8",
  );

  for (const service of ["web:", "scheduler:", "caddy:", "migrate:"]) {
    assert.match(compose, new RegExp(`^  ${service}`, "m"));
  }
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS runner/);
  assert.match(dockerfile, /USER node/);
  assert.match(caddy, /reverse_proxy web:3000/);
});

test("health route is public for infrastructure checks but cron remains secret-protected", async () => {
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  const health = await readFile(
    new URL("../app/api/health/route.ts", import.meta.url),
    "utf8",
  );
  const cron = await readFile(
    new URL("../app/api/cron/sync/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(proxy, /\/api\/health/);
  assert.match(proxy, /\/api\/cron\/sync/);
  assert.match(health, /SELECT 1 AS ok/);
  assert.match(health, /status: 503/);
  assert.match(cron, /CRON_SECRET/);
});

test("scheduler targets even two-hour Shanghai boundaries", () => {
  const before = Date.parse("2026-07-24T21:59:00Z");
  const next = nextShanghaiSyncBoundary(before);
  assert.equal(new Date(next).toISOString(), "2026-07-24T22:00:00.000Z");
});

test("one-shot scheduler sends bearer auth and fails closed", async () => {
  const calls = [];
  const success = await runScheduledSync({
    origin: "https://ops.example.com",
    secret: "test-secret",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    },
  });

  assert.equal(success.status, 200);
  assert.equal(calls[0].url, "https://ops.example.com/api/cron/sync");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-secret");
  await assert.rejects(
    runScheduledSync({
      origin: "https://ops.example.com",
      secret: "",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    }),
    /CRON_SECRET/,
  );
});
