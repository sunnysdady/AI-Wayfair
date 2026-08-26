import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel executes local API routes without a Sites proxy", async () => {
  const source = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /sites-api-proxy|proxySitesApi|SITES_API_ORIGIN/);
  assert.match(source, /NextResponse\.next/);
  assert.match(source, /APP_ACCESS_USER/);
  assert.match(source, /APP_ACCESS_PASSWORD/);
  assert.match(source, /NODE_ENV === "production"/);
  assert.match(source, /process\.env\.VERCEL/);
  assert.match(source, /\/api\/cron\/sync/);
});

test("Vercel declares a protected standalone sync cron", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  const route = await readFile(
    new URL("../app/api/cron/sync/route.ts", import.meta.url),
    "utf8",
  );

  assert.ok(
    config.crons.some(
      (cron) =>
        cron.path === "/api/cron/sync" && cron.schedule === "0 2 * * *",
    ),
  );
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /syncOutlookDaily/);
});
