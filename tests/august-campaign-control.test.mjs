import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAugustCampaignPause,
  recommendedAugustCampaignDailyCap,
} from "../lib/august-execution-policy.mjs";

test("blocks a whole-campaign pause when a profitable mixed campaign contains healthy budgeted listings", () => {
  const result = evaluateAugustCampaignPause({
    attributionAgeDays: 28,
    last28Spend: 93.17,
    last28Revenue: 2357,
    last28Orders: 15,
    contributionMarginRate: 0.34,
    listings: [
      { listing: "DMOM1021", plannedAdBudget: 900 },
      { listing: "DMOM1025", plannedAdBudget: 0 },
      { listing: "DMOM1019", plannedAdBudget: 220 },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "PROFITABLE_MIXED_CAMPAIGN_REQUIRES_LISTING_ISOLATION");
  assert.equal(result.recommendedAction, "PAUSE_ZERO_BUDGET_LISTINGS");
  assert.deepEqual(result.zeroBudgetListings, ["DMOM1025"]);
});

test("allows a whole-campaign pause when every mapped listing has zero August ad budget", () => {
  const result = evaluateAugustCampaignPause({
    attributionAgeDays: 28,
    last28Spend: 20.19,
    last28Revenue: 0,
    last28Orders: 0,
    contributionMarginRate: 0.35,
    listings: [{ listing: "DMOM1025", plannedAdBudget: 0 }],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "ALL_LISTINGS_HAVE_ZERO_BUDGET");
  assert.equal(result.recommendedAction, "PAUSE_CAMPAIGN");
});

test("does not pause a budgeted campaign before the full 14-day attribution window matures", () => {
  const result = evaluateAugustCampaignPause({
    attributionAgeDays: 7,
    last28Spend: 30,
    last28Revenue: 0,
    last28Orders: 0,
    contributionMarginRate: 0.3,
    listings: [{ listing: "DMOM1022", plannedAdBudget: 220 }],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "ATTRIBUTION_WINDOW_NOT_MATURE");
  assert.equal(result.recommendedAction, "OBSERVE");
});

test("protects a mature profitable campaign from a whole-campaign pause", () => {
  const result = evaluateAugustCampaignPause({
    attributionAgeDays: 28,
    last28Spend: 90,
    last28Revenue: 500,
    last28Orders: 3,
    contributionMarginRate: 0.34,
    listings: [{ listing: "DMOM1021", plannedAdBudget: 900 }],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "CAMPAIGN_CONTRIBUTION_POSITIVE");
  assert.ok(result.contributionAfterAds > 0);
});

test("sets a restored campaign cap to the lower of plan capacity and 120% of L28 pace", () => {
  assert.equal(
    recommendedAugustCampaignDailyCap({
      averageDailySpend: 3.33,
      plannedDailyCap: 10,
    }),
    4,
  );
  assert.equal(
    recommendedAugustCampaignDailyCap({
      averageDailySpend: 12,
      plannedDailyCap: 5,
    }),
    5,
  );
});
