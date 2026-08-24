import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { validateProductManagementSnapshot } from "../lib/product-management-snapshot.mjs";

const snapshot = JSON.parse(await readFile(new URL("../data/product-management-2026-08-05.json", import.meta.url), "utf8"));

test("accepts the audited Product Management snapshot and returns useful lineage", () => {
  const result = validateProductManagementSnapshot(snapshot, { now: new Date("2026-08-05T00:10:00.000Z") });
  assert.equal(result.audit.rowCount, 86);
  assert.equal(result.audit.uniquePartCount, 86);
  assert.ok(result.audit.uniqueSkuCount > 0);
  assert.ok(result.audit.uniqueSkuCount <= 86);
  assert.equal(result.audit.duplicateSkuRows, 86 - result.audit.uniqueSkuCount);
  assert.equal(result.audit.storeId, "27508313527093");
  assert.equal(result.audit.revenue90d, 24250.9);
  assert.equal(result.audit.unitsSold90d, 245);
});

test("rejects malformed, duplicate, future-dated, negative base metrics, or non-finite Product Management payloads", () => {
  const duplicate = structuredClone(snapshot);
  duplicate.items[1][0] = duplicate.items[0][0];
  assert.throws(() => validateProductManagementSnapshot(duplicate, { now: new Date("2026-08-05T00:10:00.000Z") }), /重复/);

  const future = structuredClone(snapshot);
  future.extractedAt = "2026-08-06T00:00:00.000Z";
  assert.throws(() => validateProductManagementSnapshot(future, { now: new Date("2026-08-05T00:10:00.000Z") }), /不能晚于/);

  const badNumber = structuredClone(snapshot);
  badNumber.items[0][3] = Number.NaN;
  assert.throws(() => validateProductManagementSnapshot(badNumber, { now: new Date("2026-08-05T00:10:00.000Z") }), /有限数字/);

  const negativeRevenue = structuredClone(snapshot);
  negativeRevenue.items[0][3] = -1;
  assert.throws(() => validateProductManagementSnapshot(negativeRevenue, { now: new Date("2026-08-05T00:10:00.000Z") }), /不能为负数/);
});
