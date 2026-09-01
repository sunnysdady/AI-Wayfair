import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { nextSyncBoundary } from "../scripts/sync-scheduler.mjs";
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
  assert.match(caddy, /X-Frame-Options "DENY"/);
  assert.match(caddy, /Content-Security-Policy "frame-ancestors 'none'"/);
  assert.match(caddy, /Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)"/);
});

test("production releases are Git-first, SHA-pinned, locked, audited, and reversible", async () => {
  const release = await readFile(
    new URL("../scripts/release-digitalocean.sh", import.meta.url),
    "utf8",
  );
  const deploy = await readFile(
    new URL("../scripts/deploy-digitalocean.sh", import.meta.url),
    "utf8",
  );
  const wrapper = await readFile(
    new URL("../deploy/digitalocean/wayfair-deploy", import.meta.url),
    "utf8",
  );
  const sudoers = await readFile(
    new URL("../deploy/digitalocean/wayfair-deploy.sudoers", import.meta.url),
    "utf8",
  );

  assert.match(release, /branch="\$\{DEPLOY_BRANCH:-production\}"/);
  assert.match(release, /git status --porcelain=v1 --untracked-files=all/);
  assert.match(release, /git merge-base --is-ancestor/);
  assert.match(release, /git push "\$remote" "\$target_sha:refs\/heads\/\$branch"/);
  assert.match(release, /git ls-remote --heads/);
  assert.match(release, /BatchMode=yes/);
  assert.match(release, /IdentitiesOnly=yes/);
  assert.match(release, /sudo -n \/usr\/local\/sbin\/wayfair-deploy/);

  assert.match(deploy, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(deploy, /flock -n 9/);
  assert.match(deploy, /umask 077/);
  assert.match(deploy, /--profile sync/);
  assert.match(deploy, /target SHA is not the current/);
  assert.match(deploy, /ENABLE_SCHEDULER must be true/);
  assert.match(deploy, /pg_dump/);
  assert.match(deploy, /table-counts-before\.txt/);
  assert.match(deploy, /object-count-after\.txt/);
  assert.match(deploy, /git switch --detach/);
  assert.match(deploy, /DEPLOYED_SHA/);
  assert.match(deploy, /Database migrations are not rolled back automatically/);
  assert.match(deploy, /api\/health/);
  assert.match(deploy, /homepage_status.*401/s);
  assert.match(wrapper, /expected_origin="https:\/\/github\.com\/sunnysdady\/AI-Wayfair\.git"/);
  assert.match(wrapper, /git show "\$target_sha:scripts\/deploy-digitalocean\.sh"/);
  assert.match(wrapper, /\[\[ "\$\(id -u\)" == "0" \]\]/);
  assert.match(sudoers, /^deploy ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/wayfair-deploy \*$/m);
  assert.doesNotMatch(`${release}\n${deploy}\n${wrapper}`, /reset --hard|checkout --force/);
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

test("scheduler targets every 30-minute UTC boundary", () => {
  const before = Date.parse("2026-07-24T21:01:00Z");
  const next = nextSyncBoundary(before);
  assert.equal(new Date(next).toISOString(), "2026-07-24T21:30:00.000Z");
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
