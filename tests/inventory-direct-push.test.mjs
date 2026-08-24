import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory live push requires an explicit click but no typed confirmation phrase", async () => {
  const [route, page] = await Promise.all([
    readFile(new URL("../app/api/inventory/push/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(route, /confirmation\?:string/);
  assert.doesNotMatch(route, /确认文字必须是/);
  assert.match(route, /loadAcceptedInventoryDryRun/);
  assert.match(route, /zeroStockConfirmed/);

  assert.doesNotMatch(page, /confirmation,setConfirmation/);
  assert.doesNotMatch(page, /输入：正式推送/);
  assert.match(page, /body: JSON\.stringify\(\{\s*snapshotId: preview\.snapshotId,\s*dryRun,\s*zeroStockConfirmed: zeroConfirmed,\s*\}\)/);
  assert.match(page, /disabled=\{!preview\?\.canPush \|\| busy\}/);
  assert.match(page, /onClick=\{\(\) => push\(false\)\}/);
  assert.match(page, /正式推送库存/);
});
