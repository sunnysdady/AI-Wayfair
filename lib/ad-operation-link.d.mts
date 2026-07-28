export type AdActionRow = {
  id: string;
  run_key: string;
  listing: string;
  campaign_id: string;
  action_type: string;
  before_payload: string | Record<string, unknown>;
  proposed_payload: string | Record<string, unknown>;
};

export function operationInputForAdAction(
  action?: Partial<AdActionRow>,
  eventType?: string,
  eventPayload?: Record<string, unknown>,
): Record<string, unknown> & { status: string; acceptedBy: string; reviewVerdict: string; evidence: Array<{type:string;value:string}> };

export function syncAdActionOperation(
  db: D1Database,
  action: AdActionRow,
  eventType: string,
  eventPayload?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
