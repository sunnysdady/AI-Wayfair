export type ReleaseHighlight = {
  area: string;
  title: string;
  detail: string;
  outcome: string;
};

export type LogicUpgrade = {
  title: string;
  before: string;
  after: string;
  impact: string;
};

export type ReleaseNotes = {
  version: string;
  releaseDate: string;
  generatedAt: string;
  productionBaseline: string;
  title: string;
  conclusion: string;
  git: {
    branch: string;
    commits: number;
    firstCommitAt: string;
    baselineReleasedAt: string;
  };
  systemSummary: {
    featureAreas: number;
    logicUpgrades: number;
    commits: number;
    tests: number;
  };
  systemUpgrades: ReleaseHighlight[];
  logicUpgrades: LogicUpgrade[];
  production: {
    domain: string;
    platform: string;
    health: string;
    anonymousHome: string;
    scheduler: string;
  };
  outlook: {
    syncedAt: string;
    total: number;
    unread: number;
    actionRequired: number;
    highestPriority: string;
  };
  operations: {
    total: number;
    closed: number;
    pendingAcceptance: number;
    pendingReview: number;
    failed: number;
  };
  followUps: string[];
};

export const RELEASE_NOTES: Readonly<ReleaseNotes>;
export function validateReleaseNotes(release: ReleaseNotes): ReleaseNotes;
