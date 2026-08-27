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
  managementBrief: {
    completed: string[];
    results: string[];
    blockers: string[];
    assistance: string[];
    tomorrow: string[];
  };
  systemUpgrades: ReleaseHighlight[];
  logicUpgrades: LogicUpgrade[];
  production: {
    domain: string;
    platform: string;
    health: string;
    anonymousHome: string;
    protectedProductPage: string;
    protectedProductAdditionApi: string;
    web: string;
    scheduler: string;
    database: string;
    imageTag: string;
  };
  verification: {
    testsPassed: number;
    testsFailed: number;
    build: string;
    lintErrors: number;
    lintWarnings: number;
    logs: string;
  };
  guardrails: {
    liveSubmit: string;
    assessmentWriteScope: string;
    maxProductsPerAssessment: number;
    classScope: string;
  };
  followUps: string[];
};

export const RELEASE_NOTES: Readonly<ReleaseNotes>;
export function validateReleaseNotes(release: ReleaseNotes): ReleaseNotes;
