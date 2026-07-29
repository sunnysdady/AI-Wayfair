export type ManualCompletionInput = {
  taskKey?: unknown;
  parentSku?: unknown;
  taskId?: unknown;
  campaignId?: unknown;
  adGroup?: unknown;
  title?: unknown;
  completed?: unknown;
  owner?: unknown;
  assignee?: unknown;
  executionChannel?: unknown;
  executionResult?: unknown;
  wayfairEvidence?: unknown;
  receiver?: unknown;
  reviewDate?: unknown;
};

export type ManualCompletion = {
  taskKey: string;
  parentSku: string;
  taskId: string;
  campaignId: string;
  adGroup: string;
  title: string;
  owner: string;
  assignee: string;
  executionChannel: string;
  executionResult: string;
  wayfairEvidence: string;
  receiver: string;
  reviewDate: string;
  closedLoopStatus: "CLOSED_LOOP_RECORDED" | "ASSIGNED";
  status: "COMPLETED" | "OPEN";
};

export type ManualCompletionTask = {
  id: string;
  parentSkus: readonly string[];
  campaignId?: unknown;
  adGroup?: unknown;
  title?: unknown;
};

export function manualCompletionPayload(
  taskKey: unknown,
  tasks?: readonly ManualCompletionTask[],
): {
  taskKey: string;
  parentSku: string;
  taskId: string;
  campaignId: string;
  adGroup: string;
  title: string;
  completed: true;
  owner: string;
  assignee: string;
  executionChannel: string;
  executionResult: string;
  receiver: string;
  reviewDate: string;
} | null;

export function validateManualCompletion(input?: ManualCompletionInput): ManualCompletion;
