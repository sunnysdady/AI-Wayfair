export type QueuedActionLike = {
  id?: string;
  campaign_id: string;
  listing: string;
  action_type?: string;
  before_payload?: string | Record<string, unknown>;
  proposed_payload?: string | Record<string, unknown>;
  status: string;
};

export function queuedActionState(actions?: QueuedActionLike[]): Record<string, string>;
export function buildCampaignUpdates(actions?: QueuedActionLike[]): Array<{
  campaignId: string;
  actionIds: string[];
  listings: Record<string, { bid: string; isActive: boolean }>;
}>;
