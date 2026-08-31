import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedRoleCounts = {
  S: 1,
  A: 1,
  B: 9,
  C: 2,
  D: 4,
  E: 3,
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
  assert.equal(audit.roles.find((row) => row.listing === "DMOM1022")?.tier, "B");
  assert.equal(audit.roles.find((row) => row.listing === "DMOM1029")?.tier, "C");
  assert.equal(audit.roles.find((row) => row.listing === "DMOM1056")?.tier, "E");
  assert.match(audit.executionRule, /C\/D 默认 HOLD/);
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

  const legacyTierAudit = structuredClone(audit);
  legacyTierAudit.roles[0].tier = "G1";
  assert.throws(
    () => validateProductOperatingAudit(legacyTierAudit),
    /S-A-B-C-D-E/,
  );
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

test("integrates the current product tier into one SKU operating center without exposing audit rules", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /api\/products\/operating-audit/);
  assert.match(page, /SKU 经营中心/);
  assert.match(page, /\["S", "A", "B", "C", "D", "E"\]/);
  assert.match(page, /产品分级/);
  assert.match(page, /selectedRole/);
  assert.match(page, /product-operating-audit:2026-07-27\.v3/);
  assert.match(page, /actionGuardrail === "HARD_STOP_REQUIRED"/);
  assert.doesNotMatch(page, /经营审计与约束/);
  assert.doesNotMatch(page, /SKU 队列与 360°/);
  assert.doesNotMatch(page, /查看经营边界/);
  assert.doesNotMatch(page, /title: "动作边界"/);
  assert.match(styles, /\.product-audit-/);
  assert.match(styles, /\.sku-demo-tier/);
});
