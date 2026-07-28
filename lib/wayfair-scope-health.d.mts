export type WayfairSyncState = {
  key: string;
  value: string;
  updated_at: string;
};

export const WAYFAIR_SCOPE_REGISTRY: readonly {
  id: string;
  family: string;
  app?: string;
  permission: string;
  policy: "active" | "excluded";
  evidenceKey?: string;
  evidencePrefix?: string;
  staleAfterMs?: number;
}[];

export function buildWayfairScopeHealth(options?: {
  now?: Date;
  syncStates?: WayfairSyncState[];
}): {
  generatedAt: string;
  summary: Record<"healthy" | "syncing" | "stale" | "failed" | "unverified", number>;
  sources: {
    id: string;
    family: string;
    app: string;
    permission: string;
    status: "healthy" | "syncing" | "stale" | "failed" | "unverified";
    detail: string;
    lastSuccessAt: string | null;
    lastObservedAt?: string;
  }[];
  excluded: { id: string; family: string; permission: string }[];
};
