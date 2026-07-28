import assert from "node:assert/strict";
import test from "node:test";

import { resolveCatalogOperationalEvidence } from "../lib/catalog-operational-evidence.mjs";

const CURRENT = "2026-07-28T03:00:00.000Z";

function item(overrides = {}) {
  return {
    status: "LIVE",
    listingIds: ["DMOM1000"],
    problems: [],
    warnings: [],
    updatedAt: CURRENT,
    ...overrides,
  };
}

test("verifies a fresh exact Listing-to-Part mapping backed by live Catalog evidence", () => {
  const result = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A", "PART-B"],
    evidenceByPart: new Map([
      ["PART-A", item()],
      ["PART-B", item()],
    ]),
    asOf: "2026-07-28",
  });

  assert.deepEqual(result, {
    verified: true,
    pass: true,
    coverage: 1,
    liveParts: 2,
    requestedParts: 2,
    problems: [],
    warnings: [],
  });
});

test("fails closed for missing, stale, or mismatched Catalog evidence", () => {
  const missing = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A", "PART-B"],
    evidenceByPart: new Map([["PART-A", item()]]),
    asOf: "2026-07-28",
  });
  const stale = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A"],
    evidenceByPart: new Map([["PART-A", item({ updatedAt: "2026-07-20T00:00:00.000Z" })]]),
    asOf: "2026-07-28",
  });
  const mismatched = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A"],
    evidenceByPart: new Map([["PART-A", item({ listingIds: ["DMOM9999"] })]]),
    asOf: "2026-07-28",
  });

  assert.equal(missing.verified, false);
  assert.equal(stale.verified, false);
  assert.equal(mismatched.verified, false);
});

test("keeps verified evidence but blocks non-live parts and Catalog problems", () => {
  const result = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A", "PART-B"],
    evidenceByPart: new Map([
      ["PART-A", item({ status: "NOT_LIVE" })],
      ["PART-B", item({ problems: ["Missing required attribute"], warnings: ["Image opportunity"] })],
    ]),
    asOf: "2026-07-28",
  });

  assert.equal(result.verified, true);
  assert.equal(result.pass, false);
  assert.equal(result.liveParts, 1);
  assert.deepEqual(result.problems, ["PART-B: Missing required attribute"]);
  assert.deepEqual(result.warnings, ["PART-B: Image opportunity"]);
});

