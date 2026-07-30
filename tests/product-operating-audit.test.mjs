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
  const {
    PRODUCT_OPERATING_AUDIT,
    resolveProductOperatingRole,
    validateProductOperatingAudit,
  } = await import(
    "../lib/product-operating-audit.mjs"
  );
  const audit = validateProductOperatingAudit(PRODUCT_OPERATING_AUDIT);

  assert.equal(audit.asOfDate, "2026-07-27");
  assert.equal(audit.performanceThrough, "2026-07-26");
  assert.equal(audit.roleEvidenceThrough, "2026-07-13");
  assert.equal(audit.costUpdatedAt, "2026-07-27T09:55:55.922Z");
  assert.match(audit.sourceSnapshotSha256, /^[a-f0-9]{64}$/);
  assert.ok(audit.review.owner);
  assert.ok(audit.review.reviewedAt);
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
    audit.roles.filter((row) => row.actionGuardrail === "HARD_STOP_REQUIRED").map((row) => row.listing),
    ["DRCI1007"],
  );
  assert.ok(
    audit.roles
      .filter((row) => row.listing !== "DRCI1007")
      .every((row) => row.actionGuardrail === "HOLD"),
  );
  assert.ok(audit.roles.every((row) => Array.isArray(row.parts)));
  assert.ok(audit.roles.every((row) => row.platformStatus === "NOT_VERIFIED"));
  assert.ok(audit.roles.every((row) => row.lastExecutionResult === null));
  assert.equal(audit.roles.find((row) => row.listing === "DMOM1022")?.tier, "G3");
  assert.equal(audit.roles.find((row) => row.listing === "DMOM1056")?.tier, "GX");
  assert.match(audit.profitDefinition, /不是净利润/);
  assert.equal(audit.account.find((row) => row.period === "Jul26")?.procurementMargin, 0.3437141234546328);

  assert.deepEqual(resolveProductOperatingRole(audit, "UNKNOWN-LISTING"), {
    listing: "UNKNOWN-LISTING",
    tier: "UNCLASSIFIED",
    role: "未分级",
    confidence: "NONE",
    actionGuardrail: "HOLD",
    platformStatus: "NOT_VERIFIED",
    lastExecutionResult: null,
    parts: [],
    operatorNote: "没有版本化角色，保持只读并等待运营复核。",
  });
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
  assert.match(page, /已知费用后贡献上限/);
  assert.match(page, /采购价差毛利/);
  assert.match(page, /动作约束/);
  assert.match(page, /HARD_STOP_REQUIRED/);
  assert.match(page, /指标完整截止/);
  assert.match(page, /角色证据截止/);
  assert.match(page, /成本更新时间/);
  assert.match(page, /广告覆盖缺口/);
  assert.match(page, /历史基线 · 仅作证据/);
  assert.match(page, /旧 A\/B\/C\/D 不用于当前动作/);
  assert.match(page, /<details className="card legacy-data-card"/);
  assert.match(styles, /\.product-audit-/);
});
