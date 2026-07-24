import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("temporary migration export is token-gated and allowlists settings", async () => {
  const source = await readFile(
    new URL("../app/api/migration/export/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /MIGRATION_EXPORT_TOKEN/);
  assert.match(source, /authorization/);
  assert.match(source, /queryToken/);
  assert.match(source, /SETTINGS_KEYS/);
  assert.doesNotMatch(source, /Object\.entries\(env\)/);
  assert.match(source, /sqlite_master/);
  assert.match(source, /env\.FILES\.list/);
  assert.match(source, /env\.FILES\.get/);
  assert.match(source, /object-base64/);
  assert.match(source, /cache-control": "no-store"/);
});
