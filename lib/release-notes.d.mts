export type ReleaseHighlight = {
  area: string;
  title: string;
  detail: string;
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
  highlights: ReleaseHighlight[];
  followUps: string[];
};

export const RELEASE_NOTES: Readonly<ReleaseNotes>;
export function validateReleaseNotes(release: ReleaseNotes): ReleaseNotes;
