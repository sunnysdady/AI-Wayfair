import assert from "node:assert/strict";
import test from "node:test";

import { resolveContributionEconomics } from "../lib/ad-contribution-economics.mjs";

test("uses fresh USD costs and scoped attributed units for a conservative margin proxy", () => {
  const result = resolveContributionEconomics({
    parts: ["PART-A", "PART-B"],
    canonicalParts: ["PART-B", "PART-A"],
    costByPart: new Map([
      ["PART-A", { unitCostCents: 6_000, currency: "USD", updatedAt: "2026-07-27T09:55:55.922Z" }],
      ["PART-B", { unitCostCents: 5_000, currency: "USD", updatedAt: "2026-07-27T09:55:55.922Z" }],
    ]),
    attributedWsc: 300,
    attributedUnits: 3,
    asOf: "2026-07-28",
    mappingStable: true,
  });

  assert.deepEqual(result, {
    marginRate: 0.4,
    marginKnown: true,
    mode: "CURRENT_USD_COST_CONSERVATIVE_ATTRIBUTED_UNIT_PROXY",
    coverage: 1,
    requestedParts: 2,
    costedParts: 2,
    mappingVerified: true,
    costFresh: true,
  });
});

test("fails closed when any canonical mapped part lacks current cost evidence", () => {
  const result = resolveContributionEconomics({
    parts: ["PART-A", "PART-B"],
    canonicalParts: ["PART-A", "PART-B"],
    costByPart: new Map([
      ["PART-A", { unitCostCents: 6_000, currency: "USD", updatedAt: "2026-07-27T09:55:55.922Z" }],
    ]),
    attributedWsc: 300,
    attributedUnits: 3,
    asOf: "2026-07-28",
    mappingStable: true,
  });

  assert.equal(result.marginRate, null);
  assert.equal(result.marginKnown, false);
  assert.equal(result.mode, "CURRENT_USD_COST_PROXY_INCOMPLETE");
  assert.equal(result.coverage, 0.5);
});

test("rejects truncated mappings, stale costs, non-USD costs, and unscoped metrics", () => {
  const base = {
    parts: ["PART-A"],
    canonicalParts: ["PART-A", "PART-B"],
    costByPart: new Map([
      ["PART-A", { unitCostCents: 6_000, currency: "USD", updatedAt: "2026-05-01T00:00:00.000Z" }],
      ["PART-B", { unitCostCents: 5_000, currency: "CAD", updatedAt: "2026-07-27T09:55:55.922Z" }],
    ]),
    attributedWsc: 300,
    attributedUnits: 3,
    asOf: "2026-07-28",
    mappingStable: false,
  };

  assert.equal(resolveContributionEconomics(base).mappingVerified, false);
  assert.equal(resolveContributionEconomics({ ...base, parts: base.canonicalParts, mappingStable: true }).costFresh, false);
  assert.equal(resolveContributionEconomics({ ...base, parts: base.canonicalParts, mappingStable: true }).marginKnown, false);
  assert.equal(resolveContributionEconomics({ ...base, parts: base.canonicalParts, mappingStable: true, attributedUnits: 0 }).marginKnown, false);
});

test("rejects a future-dated cost record", () => {
  const result = resolveContributionEconomics({
    parts: ["PART-A"],
    canonicalParts: ["PART-A"],
    costByPart: new Map([
      ["PART-A", { unitCostCents: 6_000, currency: "USD", updatedAt: "2099-01-01T00:00:00.000Z" }],
    ]),
    attributedWsc: 100,
    attributedUnits: 1,
    asOf: "2026-07-28",
    mappingStable: true,
  });

  assert.equal(result.costFresh, false);
  assert.equal(result.marginKnown, false);
});
