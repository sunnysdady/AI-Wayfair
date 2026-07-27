export type AdSafetyMetric = {
  spend: number;
  clicks: number;
  orders: number;
  wscRoas: number;
};

export type AdSafetyStrategy = {
  actionType: string;
  label: string;
  proposed: Record<string, unknown>;
  reasons: string[];
  warnings: string[];
  [key: string]: unknown;
};

export function applyLiveSafety<T extends AdSafetyStrategy>(input: {
  strategy: T;
  currentBid: number;
  breakEvenRoas: number;
  baselineCvr?: number;
  recent: AdSafetyMetric;
  trailing: AdSafetyMetric;
  latestProductStatus?: string;
  latestCampaignStatus?: string;
  forceStop?: boolean;
}): {
  strategy: T;
  liveSafety: {
    status: string;
    recent: AdSafetyMetric;
    trailing: AdSafetyMetric;
    thresholds: { spend: number; clicks: number; stopSpend: number };
    baselineCvr: number;
    requiredClicks: number;
  };
};
