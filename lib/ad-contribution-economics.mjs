const COST_FRESH_DAYS = 30;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizedParts(parts) {
  return [...new Set(
    (parts || []).map((part) => String(part || "").trim()).filter(Boolean),
  )].sort();
}

function sameParts(left, right) {
  return left.length > 0
    && left.length === right.length
    && left.every((part, index) => part === right[index]);
}

function freshAsOf(updatedAt, asOf) {
  const updated = Date.parse(String(updatedAt || ""));
  const asOfStart = Date.parse(`${asOf}T00:00:00Z`);
  const cutoff = asOfStart - COST_FRESH_DAYS * 86400000;
  const upperBound = asOfStart + 86400000;
  return Number.isFinite(updated)
    && Number.isFinite(asOfStart)
    && updated >= cutoff
    && updated < upperBound;
}

export function resolveContributionEconomics({
  parts = [],
  canonicalParts = [],
  costByPart = new Map(),
  attributedWsc,
  attributedUnits,
  asOf = "",
  mappingStable = false,
} = {}) {
  const reported = normalizedParts(parts);
  const canonical = normalizedParts(canonicalParts);
  const mappingVerified = Boolean(mappingStable) && sameParts(reported, canonical);
  const costs = canonical.map((part) => costByPart.get(part)).filter(Boolean);
  const costedParts = costs.filter((cost) => (
    finite(cost.unitCostCents) !== null
    && finite(cost.unitCostCents) > 0
    && String(cost.currency || "").toUpperCase() === "USD"
    && String(cost.currencyCertifiedAt || "").trim().length > 0
    && String(cost.currencyCertificationSource || "").trim().length > 0
  ));
  const coverage = canonical.length ? round(costedParts.length / canonical.length) : 0;
  const costFresh = costedParts.length === canonical.length
    && costedParts.every((cost) => freshAsOf(cost.updatedAt, asOf));
  const wsc = finite(attributedWsc);
  const units = finite(attributedUnits);
  const metricsScoped = wsc !== null && wsc > 0 && units !== null && units > 0;
  const marginKnown = mappingVerified
    && coverage === 1
    && costFresh
    && metricsScoped;
  const conservativeUnitCost = marginKnown
    ? Math.max(...costedParts.map((cost) => finite(cost.unitCostCents)))
    : null;
  const contributionBeforeAds = marginKnown
    ? wsc - units * conservativeUnitCost / 100
    : null;

  return {
    marginRate: marginKnown ? round(contributionBeforeAds / wsc) : null,
    marginKnown,
    mode: marginKnown
      ? "CURRENT_USD_COST_CONSERVATIVE_ATTRIBUTED_UNIT_PROXY"
      : "CURRENT_USD_COST_PROXY_INCOMPLETE",
    coverage,
    requestedParts: canonical.length,
    costedParts: costedParts.length,
    mappingVerified,
    costFresh,
  };
}
