export type CatalogPartEvidence = {
  status: string;
  listingIds: string[];
  country: string;
  segment: string;
  problems: string[];
  warnings: string[];
  updatedAt: string;
};

export type CatalogOperationalEvidence = {
  verified: boolean;
  pass: boolean;
  coverage: number;
  liveParts: number;
  requestedParts: number;
  problems: string[];
  warnings: string[];
};

export const CATALOG_EVIDENCE_MAX_AGE_HOURS: number;
export function catalogEvidenceKey(part: string, country: string, segment: string): string;
export function mergeCatalogPartEvidence(existing: CatalogPartEvidence | undefined, incoming: CatalogPartEvidence): CatalogPartEvidence;

export function resolveCatalogOperationalEvidence(input?: {
  listing?: string;
  parts?: string[];
  country?: string;
  segment?: string;
  evidenceByPart?: Map<string, CatalogPartEvidence>;
  asOf?: string;
  evaluatedAt?: string;
}): CatalogOperationalEvidence;
