import assert from "node:assert/strict";
import test from "node:test";

import { resolveContributionEconomics } from "../lib/ad-contribution-economics.mjs";

test("uses fully covered actual order economics for the mapped listing parts", () => {
  const result = resolveContributionEconomics({
    parts: ["PART-A", "PART-B"],
    evidenceByPart: new Map([
      ["PART-A", { revenueCents: 10_000, costCents: 6_000, uncoveredRevenueCents: 0 }],
      ["PART-B", { revenueCents: 20_000, costCents: 10_000, uncoveredRevenueCents: 0 }],
    ]),
  });

  assert.deepEqual(result, {
    marginRate: 0.4667,
    marginKnown: true,
    mode: "ORDER_ACTUAL_180D",
    coverage: 1,
    requestedParts: 2,
    evidencedParts: 2,
  });
});

test("fails closed when any mapped part lacks actual cost evidence", () => {
  const result = resolveContributionEconomics({
    parts: ["PART-A", "PART-B"],
    evidenceByPart: new Map([
      ["PART-A", { revenueCents: 10_000, costCents: 6_000, uncoveredRevenueCents: 0 }],
    ]),
  });

  assert.equal(result.marginRate, null);
  assert.equal(result.marginKnown, false);
  assert.equal(result.mode, "ORDER_ACTUAL_180D_INCOMPLETE");
  assert.equal(result.coverage, 0.5);
});

test("deduplicates part mappings and rejects uncovered revenue", () => {
  const result = resolveContributionEconomics({
    parts: [" PART-A ", "PART-A"],
    evidenceByPart: new Map([
      ["PART-A", { revenueCents: 10_000, costCents: 6_000, uncoveredRevenueCents: 2_000 }],
    ]),
  });

  assert.equal(result.requestedParts, 1);
  assert.equal(result.evidencedParts, 1);
  assert.equal(result.marginKnown, false);
  assert.equal(result.marginRate, null);
  assert.equal(result.coverage, 0.8);
});
