import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedRoleCounts = {
  G1: 1,
  G2: 1,
  G3: 9,
  "G4-D": 2,
  "G4-R": 4,
  GX: 3,
};

test("publishes the debated 2026-07-27 product operating audit as a versioned snapshot", async () => {
  const { PRODUCT_OPERATING_AUDIT, validateProductOperatingAudit } = await import(
    "../lib/product-operating-audit.mjs"
  );
  const audit = validateProductOperatingAudit(PRODUCT_OPERATING_AUDIT);

  assert.equal(audit.asOfDate, "2026-07-27");
  assert.equal(audit.performanceThrough, "2026-07-26");
  assert.equal(audit.roles.length, 20);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(expectedRoleCounts).map((tier) => [
        tier,
        audit.roles.filter((row) => row.tier === tier).length,
      ]),
    ),
    expectedRoleCounts,
  );

  assert.deepEqual(
    audit.roles.filter((row) => row.executionState === "HARD_STOP").map((row) => row.listing),
    ["DRCI1007"],
  );
  assert.ok(
    audit.roles
      .filter((row) => row.listing !== "DRCI1007")
      .every((row) => row.executionState === "HOLD"),
  );
  assert.equal(audit.roles.find((row) => row.listing === "DMOM1022")?.tier, "G3");
  assert.equal(audit.roles.find((row) => row.listing === "DMOM1056")?.tier, "GX");
  assert.match(audit.profitDefinition, /不是净利润/);
  assert.equal(audit.account.find((row) => row.period === "Jul26")?.procurementMargin, 0.3437141234546328);
});

test("serves the audit without mutating advertising, inventory, or procurement state", async () => {
  const route = await readFile(
    new URL("../app/api/products/operating-audit/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /PRODUCT_OPERATING_AUDIT/);
  assert.match(route, /validateProductOperatingAudit/);
  assert.match(route, /Cache-Control/);
  assert.doesNotMatch(route, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(route, /ALLOW_WAYFAIR_AD_LIVE_CHANGES|ALLOW_WAYFAIR_LIVE_PUSH/);
});

test("makes the current operating audit primary and demotes legacy grades to evidence only", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /api\/products\/operating-audit/);
  assert.match(page, /当前运营角色与利润审计/);
  assert.match(page, /G4 默认 HOLD/);
  assert.match(page, /已知广告后贡献上限/);
  assert.match(page, /历史基线 · 仅作证据/);
  assert.match(page, /旧 A\/B\/C\/D 不用于当前动作/);
  assert.match(styles, /\.product-audit-/);
});
