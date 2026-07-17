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
export function executeCampaignUpdates(
  campaigns: Array<{campaignId:string;actionIds:string[];listings:Record<string,{bid:string;isActive:boolean}>}>,
  updateCampaign: (campaign:{campaignId:string;actionIds:string[];listings:Record<string,{bid:string;isActive:boolean}>}) => Promise<unknown>,
): Promise<Array<{campaignId:string;actionIds:string[];ok:boolean;response?:unknown;error?:string}>>;
export function executionResultForAction(action?: QueuedActionLike & {result_event_type?:string;result_payload?:string;result_at?:string}): {tone:string;title:string;detail:string};
export function buildCampaignUpdates(actions?: QueuedActionLike[]): Array<{
  campaignId: string;
  actionIds: string[];
  listings: Record<string, { bid: string; isActive: boolean }>;
}>;
