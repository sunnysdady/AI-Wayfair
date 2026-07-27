export type CostRowInput = { partNumber: unknown; unitCost: unknown };
export type CostIssue = { line: number; part?: string; message: string };
export type SoldPartInput = { partNumber: string; units?: number; revenueCents?: number };
export type MissingPart = { partNumber: string; units: number; revenueCents: number };

export function resolveColumns(headers: string[]): { partNumber: number; unitCost: number };

export function validateCostRows(
  rows: CostRowInput[],
  sellingPriceCents?: Map<string, number>,
): {
  costs: { partNumber: string; unitCostCents: number }[];
  errors: CostIssue[];
  warnings: CostIssue[];
};

export function summarizeCostCoverage(input?: {
  soldParts?: SoldPartInput[];
  costedParts?: string[];
}): {
  costedParts: number;
  soldParts: number;
  missingParts: number;
  revenueCoverage: number;
  missing: MissingPart[];
};

export function costTemplateCsv(missing?: { partNumber: string }[]): string;
