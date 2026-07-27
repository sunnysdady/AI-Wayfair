export type QueuedFreshnessAction = {
  listing: string;
  campaignId: string;
  actionType: string;
  before: Record<string, unknown>;
  proposed: Record<string, unknown>;
};

export type LatestAdState = {
  reportDate: string;
  active: boolean;
  campaignActive: boolean;
  bid: number;
};

export function validateAdActionFreshness(input: {
  action: QueuedFreshnessAction;
  latest: LatestAdState | null;
  asOf: string;
}): { ok: true } | { ok: false; reason: string };
