export type AdModelTodoDecisionState = {
  operatingState?: {
    campaignStatus?: string;
    campaignActive?: boolean | null;
  } | null;
  campaignControl?: {
    status?: string;
  } | null;
};

export function shouldGenerateAdModelTodo(
  decision?: AdModelTodoDecisionState,
): {
  include: boolean;
  reason: "CAMPAIGN_NOT_ACTIVE" | null;
};
