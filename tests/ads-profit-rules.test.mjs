import assert from "node:assert/strict";
import test from "node:test";

import {
  TACOS_LINE, buildLossBuckets, contributionAfterAds, lossAlerts, tacosAssessment,
} from "../lib/ads-profit-rules.mjs";

const cost = (cents) => ({ unitCostCents: cents, currency: "USD", currencyCertifiedAt: "2026-09-01", currencyCertificationSource: "ops", updatedAt: "2026-10-01" });

test("TACOS at or below 10% means no budget cap; above keeps the cap", () => {
  assert.equal(TACOS_LINE, 0.1);
  const exactly = tacosAssessment({ spend: 100, totalSales: 1000 });
  assert.equal(exactly.tacos, 0.1);
  assert.equal(exactly.status, "WITHIN_LINE");
  assert.equal(exactly.budgetAdvice, "NO_CAP");
  const over = tacosAssessment({ spend: 101, totalSales: 1000 });
  assert.equal(over.status, "OVER_LINE");
  assert.equal(over.budgetAdvice, "KEEP_CAP");
});

test("TACOS is unknown, not zero, when spend is unsynced or there are no sales", () => {
  assert.equal(tacosAssessment({ spend: null, totalSales: 500 }).status, "UNKNOWN");
  assert.equal(tacosAssessment({ spend: null, totalSales: 500 }).tacos, null);
  const none = tacosAssessment({ spend: 40, totalSales: 0 });
  assert.equal(none.status, "NO_SALES");
  assert.equal(none.budgetAdvice, "KEEP_CAP");
  assert.equal(tacosAssessment({ spend: 0, totalSales: 0 }).status, "UNKNOWN");
});

test("partial ad-spend coverage still computes TACOS but says it may be understated", () => {
  const result = tacosAssessment({ spend: 50, totalSales: 1000, coverage: "PARTIAL" });
  assert.equal(result.partial, true);
  assert.equal(result.status, "PROVISIONAL");
  const over = tacosAssessment({ spend: 200, totalSales: 1000, coverage: "PARTIAL" });
  assert.equal(over.status, "OVER_LINE");
  assert.match(over.reason, /实际更高/);
});

test("contribution after ads uses WSC − units×SKU cost − spend when every part is costed", () => {
  const result = contributionAfterAds({ wsc: 400, units: 4, spend: 50, parts: ["P1"], costByPart: new Map([["P1", cost(5000)]]) });
  assert.equal(result.contribution, 150); // 400 - 4*50 - 50
  assert.equal(result.basis, "SKU_COST");
  assert.equal(result.loss, false);
});

test("uses the highest unit cost across parts (conservative, like the existing model)", () => {
  const result = contributionAfterAds({ wsc: 400, units: 4, spend: 0, parts: ["A", "B"], costByPart: new Map([["A", cost(5000)], ["B", cost(9000)]]) });
  assert.equal(result.contribution, 40);
});

test("negative contribution with covered costs is a confirmed loss", () => {
  const result = contributionAfterAds({ wsc: 100, units: 2, spend: 60, parts: ["P1"], costByPart: new Map([["P1", cost(4000)]]) });
  assert.equal(result.contribution, -40);
  assert.equal(result.loss, true);
  assert.equal(result.suspectedLoss, false);
});

test("uncovered or uncertified cost falls back to the 28.26% margin and is labelled an estimate", () => {
  const estimate = contributionAfterAds({ wsc: 100, units: 2, spend: 40, parts: ["P1"], costByPart: new Map() });
  assert.equal(estimate.basis, "ESTIMATE");
  assert.equal(estimate.contribution, -11.74);
  assert.equal(estimate.loss, false);
  assert.equal(estimate.suspectedLoss, true);
  const uncertified = contributionAfterAds({ wsc: 100, units: 2, spend: 10, parts: ["P1"], costByPart: new Map([["P1", { ...cost(4000), currencyCertifiedAt: "" }]]) });
  assert.equal(uncertified.basis, "ESTIMATE");
});

test("missing WSC is unknown — no invented profit", () => {
  const result = contributionAfterAds({ wsc: null, units: 1, spend: 99 });
  assert.equal(result.contribution, null);
  assert.equal(result.basis, "UNKNOWN");
  assert.equal(result.loss, false);
});

test("spend with zero attributed sales is a loss; tiny spend is noise", () => {
  assert.equal(contributionAfterAds({ wsc: 0, units: 0, spend: 20 }).loss, true);
  assert.equal(contributionAfterAds({ wsc: 0, units: 0, spend: 2 }).loss, false);
  const small = contributionAfterAds({ wsc: 10, units: 1, spend: 4, parts: ["P1"], costByPart: new Map([["P1", cost(9000)]]) });
  assert.equal(small.contribution < 0, true);
  assert.equal(small.loss, false, "under the $5 spend floor");
});

const row = (over) => ({
  Date: "2026-10-01", campaign_id: "1", campaign_name: "Camp A", listing: "L1", product_name: "Desk", first_10_part_numbers: "P1",
  spend_USD: "20", attributed_wholesale_cost_window_view_through_USD_Day_14: "100",
  attributed_units_window_view_through_Day_14: "2", attributed_orders_window_view_through_Day_14: "2", ...over,
});

test("loss buckets split by listing and by campaign without mixing unit costs", () => {
  const costs = new Map([["P1", cost(4000)], ["P2", cost(1000)]]);
  const rows = [
    row({}),
    row({ listing: "L2", product_name: "Chair", first_10_part_numbers: "P2", spend_USD: "30", attributed_wholesale_cost_window_view_through_USD_Day_14: "200", attributed_units_window_view_through_Day_14: "4" }),
    row({ Date: "2026-09-01" }), // outside range
  ];
  const result = buildLossBuckets({ rows, start: "2026-10-01", end: "2026-10-01", costByPart: costs });
  const l1 = result.listings.find((item) => item.listing === "L1");
  const l2 = result.listings.find((item) => item.listing === "L2");
  assert.equal(l1.contribution, 0); // 100 - 2*40 - 20
  assert.equal(l2.contribution, 130); // 200 - 4*10 - 30
  const campaign = result.campaigns[0];
  assert.equal(campaign.campaignId, "1");
  assert.equal(campaign.contribution, 130);
  assert.equal(campaign.loss, false);
});

test("a loss-making SKU inside a profitable campaign is still flagged at SKU level; alerts list confirmed first", () => {
  const costs = new Map([["P1", cost(9000)], ["P2", cost(1000)]]);
  const rows = [
    row({ first_10_part_numbers: "P1" }), // 100 - 2*90 - 20 = -100
    row({ listing: "L2", first_10_part_numbers: "P2", spend_USD: "10", attributed_wholesale_cost_window_view_through_USD_Day_14: "500", attributed_units_window_view_through_Day_14: "2" }),
    row({ listing: "L3", first_10_part_numbers: "PX", spend_USD: "30", attributed_wholesale_cost_window_view_through_USD_Day_14: "50" }), // estimate: 50*.2826-30 < 0
  ];
  const buckets = buildLossBuckets({ rows, start: "2026-10-01", end: "2026-10-01", costByPart: costs });
  const alerts = lossAlerts(buckets);
  const listingAlerts = alerts.filter((item) => item.level === "listing");
  assert.deepEqual(listingAlerts.map((item) => [item.id, item.confirmed]), [["L1", true], ["L3", false]]);
  assert.equal(listingAlerts[0].contribution, -100);
  assert.ok(buckets.campaigns[0].contribution > 0, "campaign nets positive but SKU alert still raised");
});
