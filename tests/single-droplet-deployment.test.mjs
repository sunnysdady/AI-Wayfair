import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSingleDropletEnv,
  validateSingleDropletDomain,
} from "../scripts/create-single-droplet-env.mjs";

test("single-droplet compose keeps PostgreSQL and MinIO private and persistent", async () => {
  const compose = await readFile(
    new URL("../docker-compose.production.yml", import.meta.url),
    "utf8",
  );

  for (const service of ["postgres:", "minio:", "minio-init:"]) {
    assert.match(compose, new RegExp(`^  ${service}`, "m"));
  }
  for (const volume of ["postgres_data:", "minio_data:"]) {
    assert.match(compose, new RegExp(`^  ${volume}`, "m"));
  }
  assert.doesNotMatch(compose, /- ["']?5432:5432/);
  assert.doesNotMatch(compose, /- ["']?9000:9000/);
  assert.match(compose, /service_completed_successfully/);
  assert.match(compose, /profiles:\s*\n\s+- sync/);
});

test("single-droplet environment generator emits internal service endpoints and random secrets", () => {
  let counter = 0;
  const env = buildSingleDropletEnv({
    domain: "104-236-233-106.sslip.io",
    randomSecret: () => `secret-${++counter}`,
  });

  assert.match(
    env,
    /DATABASE_URL=postgresql:\/\/wayfair:secret-1@postgres:5432\/wayfair/,
  );
  assert.match(env, /S3_ENDPOINT=http:\/\/minio:9000/);
  assert.match(env, /S3_FORCE_PATH_STYLE=true/);
  assert.match(env, /MINIO_ROOT_PASSWORD=secret-2/);
  assert.match(env, /CRON_SECRET=secret-3/);
  assert.match(env, /APP_ACCESS_PASSWORD=secret-4/);
  assert.match(env, /APP_ORIGIN=https:\/\/104-236-233-106\.sslip\.io/);
  assert.match(env, /ENABLE_SCHEDULER=false/);
  assert.doesNotMatch(env, /replace-with|example\.com/);
});

test("single-droplet environment generator rejects unsafe domain input", () => {
  assert.equal(
    validateSingleDropletDomain("ops.example.com"),
    "ops.example.com",
  );
  assert.throws(
    () => validateSingleDropletDomain("https://ops.example.com/path"),
    /hostname/,
  );
  assert.throws(
    () => validateSingleDropletDomain("ops.example.com\nINJECTED=value"),
    /hostname/,
  );
});
