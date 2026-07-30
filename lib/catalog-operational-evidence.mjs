export const CATALOG_EVIDENCE_MAX_AGE_HOURS = 24;

function normalized(value) {
  return String(value || "").trim().toUpperCase();
}

export function catalogEvidenceKey(part, country, segment) {
  return [part, country, segment].map(normalized).join("::");
}

function normalizedParts(parts) {
  return [...new Set(
    (parts || []).map((part) => String(part || "").trim()).filter(Boolean),
  )].sort();
}

function freshAsOf(updatedAt, evaluatedAt) {
  const updated = Date.parse(String(updatedAt || ""));
  const evaluated = Date.parse(String(evaluatedAt || ""));
  return Number.isFinite(updated)
    && Number.isFinite(evaluated)
    && updated <= evaluated
    && evaluated - updated <= CATALOG_EVIDENCE_MAX_AGE_HOURS * 3600000;
}

function unique(values) {
  return [...new Set(values.map(String).filter(Boolean))].sort();
}

export function mergeCatalogPartEvidence(existing, incoming) {
  if (!existing) return incoming;
  const existingTime = Date.parse(String(existing.updatedAt || ""));
  const incomingTime = Date.parse(String(incoming.updatedAt || ""));
  if (incomingTime > existingTime) return incoming;
  if (incomingTime < existingTime) return existing;
  const existingListings = new Set((existing.listingIds || []).map(String));
  const existingStatus = normalized(existing.status);
  const incomingStatus = normalized(incoming.status);
  return {
    ...incoming,
    status: existingStatus === "LIVE" && incomingStatus === "LIVE"
      ? "LIVE"
      : existingStatus === incomingStatus
        ? incomingStatus
        : "CONFLICT",
    listingIds: unique((incoming.listingIds || []).filter((listing) => existingListings.has(String(listing)))),
    problems: unique([...(existing.problems || []), ...(incoming.problems || [])]),
    warnings: unique([...(existing.warnings || []), ...(incoming.warnings || [])]),
    updatedAt: String(incoming.updatedAt || existing.updatedAt || ""),
  };
}

export function resolveCatalogOperationalEvidence({
  listing = "",
  parts = [],
  country = "",
  segment = "",
  evidenceByPart = new Map(),
  evaluatedAt = "",
} = {}) {
  const requested = normalizedParts(parts);
  const targetCountry = normalized(country);
  const targetSegment = normalized(segment);
  const rows = requested.map((part) => ({
    part,
    evidence: evidenceByPart.get(catalogEvidenceKey(part, targetCountry, targetSegment))
      || evidenceByPart.get(part)
      || evidenceByPart.get(part.toUpperCase()),
  }));
  const exactRows = rows.filter(({ evidence }) => (
    evidence
    && targetCountry
    && targetSegment
    && normalized(evidence.country) === targetCountry
    && normalized(evidence.segment) === targetSegment
    && freshAsOf(evidence.updatedAt, evaluatedAt)
    && (evidence.listingIds || []).map(String).includes(String(listing))
  ));
  const verified = requested.length > 0 && exactRows.length === requested.length;
  const liveParts = exactRows.filter(({ evidence }) => String(evidence.status || "").toUpperCase() === "LIVE").length;
  const problems = exactRows.flatMap(({ part, evidence }) => (
    (evidence.problems || []).map((problem) => `${part}: ${problem}`)
  ));
  const warnings = exactRows.flatMap(({ part, evidence }) => (
    (evidence.warnings || []).map((warning) => `${part}: ${warning}`)
  ));

  return {
    verified,
    pass: verified && liveParts === requested.length && problems.length === 0,
    coverage: requested.length ? Number((exactRows.length / requested.length).toFixed(4)) : 0,
    liveParts,
    requestedParts: requested.length,
    problems,
    warnings,
  };
}
