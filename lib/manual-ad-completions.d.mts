export type ManualCompletionInput = {
  taskKey?: unknown;
  parentSku?: unknown;
  taskId?: unknown;
  campaignId?: unknown;
  adGroup?: unknown;
  title?: unknown;
  completed?: unknown;
  status?: unknown;
  owner?: unknown;
  executionResult?: unknown;
  evidence?: unknown;
  acceptanceCriteria?: unknown;
  acceptedBy?: unknown;
  reviewDueAt?: unknown;
};

export type ManualCompletion = {
  taskKey: string;
  parentSku: string;
  taskId: string;
  campaignId: string;
  adGroup: string;
  title: string;
  operationId: string;
  status: "OPEN" | "IN_PROGRESS" | "PENDING_ACCEPTANCE" | "VERIFIED" | "REOPENED" | "FAILED";
  owner: string;
  executionResult: string;
  evidence: string;
  acceptanceCriteria: string;
  acceptedBy: string;
  reviewDueAt: string;
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
  status: "PENDING_ACCEPTANCE";
  owner: "待分派";
  executionResult: string;
  evidence: string;
  acceptanceCriteria: string;
} | null;

export function validateManualCompletion(input?: ManualCompletionInput): ManualCompletion;
