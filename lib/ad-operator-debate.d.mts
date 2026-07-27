export type OperatorStrategy = {
  actionType: string;
  label: string;
  proposed: Record<string, unknown>;
  reasons: string[];
  warnings: string[];
  [key: string]: unknown;
};

export type OperatorReview = {
  owner: string;
  verdict: "HOLD" | "CANDIDATE";
  stage: string;
  thesis: string;
  counterpoint: string;
  controls: string[];
  requiresHumanApproval: boolean;
  proposalOwner: string;
  decisionOwner: string;
  decisionStatus: string;
  hypothesis: string;
  singleVariable: boolean;
  cooldownUntil: string | null;
  reviewDue: string | null;
  rollbackPlan: string;
};

export function applyOperatorDebate<T extends OperatorStrategy>(input: {
  strategy: T;
  liveSafety?: { status?: string };
  lastChangeDate?: string | null;
  asOf: string;
  cooldownDays?: number;
  eventPhase?: string;
  hardStop?: boolean;
}): { strategy: T; review: OperatorReview };
