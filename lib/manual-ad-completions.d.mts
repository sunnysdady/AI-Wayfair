export type ManualCompletionInput = {
  taskKey?: unknown;
  parentSku?: unknown;
  taskId?: unknown;
  campaignId?: unknown;
  adGroup?: unknown;
  title?: unknown;
  completed?: unknown;
};

export type ManualCompletion = {
  taskKey: string;
  parentSku: string;
  taskId: string;
  campaignId: string;
  adGroup: string;
  title: string;
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
} | null;

export function validateManualCompletion(input?: ManualCompletionInput): ManualCompletion;
