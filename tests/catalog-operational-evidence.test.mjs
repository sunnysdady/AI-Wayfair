import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeCatalogPartEvidence,
  resolveCatalogOperationalEvidence,
} from "../lib/catalog-operational-evidence.mjs";

const CURRENT = "2026-07-28T03:00:00.000Z";

function item(overrides = {}) {
  return {
    status: "LIVE",
    listingIds: ["DMOM1000"],
    country: "US",
    segment: "B2C",
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
    country: "US",
    segment: "B2C",
    evidenceByPart: new Map([
      ["PART-A", item()],
      ["PART-B", item()],
    ]),
    asOf: "2026-07-28",
    evaluatedAt: CURRENT,
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
    country: "US",
    segment: "B2C",
    evidenceByPart: new Map([["PART-A", item()]]),
    asOf: "2026-07-28",
    evaluatedAt: CURRENT,
  });
  const stale = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A"],
    country: "US",
    segment: "B2C",
    evidenceByPart: new Map([["PART-A", item({ updatedAt: "2026-07-20T00:00:00.000Z" })]]),
    asOf: "2026-07-28",
    evaluatedAt: CURRENT,
  });
  const mismatched = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A"],
    country: "US",
    segment: "B2C",
    evidenceByPart: new Map([["PART-A", item({ listingIds: ["DMOM9999"] })]]),
    asOf: "2026-07-28",
    evaluatedAt: CURRENT,
  });

  assert.equal(missing.verified, false);
  assert.equal(stale.verified, false);
  assert.equal(mismatched.verified, false);
});

test("keeps verified evidence but blocks non-live parts and Catalog problems", () => {
  const result = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A", "PART-B"],
    country: "US",
    segment: "B2C",
    evidenceByPart: new Map([
      ["PART-A", item({ status: "NOT_LIVE" })],
      ["PART-B", item({ problems: ["Missing required attribute"], warnings: ["Image opportunity"] })],
    ]),
    asOf: "2026-07-28",
    evaluatedAt: CURRENT,
  });

  assert.equal(result.verified, true);
  assert.equal(result.pass, false);
  assert.equal(result.liveParts, 1);
  assert.deepEqual(result.problems, ["PART-B: Missing required attribute"]);
  assert.deepEqual(result.warnings, ["PART-B: Image opportunity"]);
});

test("does not reuse US B2C Catalog evidence for Canada or B2B model units", () => {
  const evidenceByPart = new Map([["PART-A", item()]]);
  const canada = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A"],
    country: "CA",
    segment: "B2C",
    evidenceByPart,
    asOf: "2026-07-28",
    evaluatedAt: CURRENT,
  });
  const professional = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A"],
    country: "US",
    segment: "B2B",
    evidenceByPart,
    asOf: "2026-07-28",
    evaluatedAt: CURRENT,
  });

  assert.equal(canada.verified, false);
  assert.equal(professional.verified, false);
});

test("enforces a rolling 24-hour Catalog evidence window", () => {
  const evidenceByPart = new Map([["PART-A", item({ updatedAt: "2026-07-27T02:59:59.000Z" })]]);
  const result = resolveCatalogOperationalEvidence({
    listing: "DMOM1000",
    parts: ["PART-A"],
    country: "US",
    segment: "B2C",
    evidenceByPart,
    asOf: "2026-07-28",
    evaluatedAt: CURRENT,
  });

  assert.equal(result.verified, false);
});

test("selects the newest duplicate Catalog row and merges equal-time conflicts conservatively", () => {
  const older = item({ status: "LIVE", updatedAt: "2026-07-28T01:00:00.000Z" });
  const newer = item({ status: "NOT_LIVE", problems: ["Latest problem"], updatedAt: CURRENT });
  assert.deepEqual(mergeCatalogPartEvidence(older, newer), newer);

  const conflict = mergeCatalogPartEvidence(
    item({ listingIds: ["DMOM1000", "DMOM1001"], updatedAt: CURRENT }),
    item({ listingIds: ["DMOM1000"], warnings: ["Review"], updatedAt: CURRENT }),
  );
  assert.equal(conflict.status, "LIVE");
  assert.deepEqual(conflict.listingIds, ["DMOM1000"]);
  assert.deepEqual(conflict.warnings, ["Review"]);

  const statusConflict = mergeCatalogPartEvidence(
    item({ status: "NOT_LIVE", updatedAt: CURRENT }),
    item({ status: "LIVE", updatedAt: CURRENT }),
  );
  assert.equal(statusConflict.status, "CONFLICT");
  const reversedStatusConflict = mergeCatalogPartEvidence(
    item({ status: "LIVE", updatedAt: CURRENT }),
    item({ status: "NOT_LIVE", updatedAt: CURRENT }),
  );
  assert.equal(reversedStatusConflict.status, "CONFLICT");
});
