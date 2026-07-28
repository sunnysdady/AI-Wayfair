export type SkuCostEvidence = {
  unitCostCents: number;
  currency: "USD" | "UNVERIFIED";
  currencyCertifiedAt: string;
  currencyCertificationSource: string;
  updatedAt: string;
};

export type ContributionEconomics = {
  marginRate: number | null;
  marginKnown: boolean;
  mode: "CURRENT_USD_COST_CONSERVATIVE_ATTRIBUTED_UNIT_PROXY" | "CURRENT_USD_COST_PROXY_INCOMPLETE";
  coverage: number;
  requestedParts: number;
  costedParts: number;
  mappingVerified: boolean;
  costFresh: boolean;
};

export function resolveContributionEconomics(input?: {
  parts?: string[];
  canonicalParts?: string[];
  costByPart?: Map<string, SkuCostEvidence>;
  attributedWsc?: number | null;
  attributedUnits?: number | null;
  asOf?: string;
  mappingStable?: boolean;
}): ContributionEconomics;
