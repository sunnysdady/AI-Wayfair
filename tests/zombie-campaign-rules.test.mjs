import assert from "node:assert/strict";
import test from "node:test";

import { detectZombieCampaigns } from "../lib/zombie-campaign-rules.mjs";

const campaign = (overrides = {}) => ({
  Date: "2026-06-20",
  campaign_id: "622729",
  campaign_name: "DMOM1027-宽四",
  campaign_status: "ACTIVE",
  campaign_is_active: "TRUE",
  targeting_type: "Product Targeting",
  store_url: "https://www.wayfair.com",
  impressions: "120",
  clicks: "3",
  spend_USD: "1.25",
  attributed_orders_window_view_through_Day_14: "0",
  ...overrides,
});

const listing = (overrides = {}) => ({
  Date: "2026-06-20",
  campaign_id: "622729",
  campaign_name: "DMOM1027-宽四",
  listing: "DMOM1027",
  product_name: "4-Drawer Lateral Filing Cabinet",
  product_status: "INACTIVE",
  product_default_bid: "0.58",
  first_10_part_numbers: "LFC-4B, LFC-4W",
  store_url: "https://www.wayfair.com",
  impressions: "120",
  clicks: "3",
  spend_USD: "1.25",
  attributed_orders_window_view_through_Day_14: "0",
  ...overrides,
});

test("detects hard zombie campaigns and separates broken links from eligibility checks", () => {
  const findings = detectZombieCampaigns({
    campaignRows: [
      campaign(),
      campaign({ campaign_id: "622724", campaign_name: "DMOM1020 Canada" }),
      campaign({ campaign_id: "598135", campaign_name: "Old Keyword", targeting_type: "Keyword Targeting" }),
      campaign({ campaign_id: "622740", campaign_name: "Serving Canada", Date: "2026-07-03", impressions: "233", spend_USD: "0.05" }),
      campaign({ campaign_id: "600000", campaign_name: "Paused", campaign_is_active: "FALSE", campaign_status: "INACTIVE" }),
    ],
    listingRows: [
      listing(),
      listing({ campaign_id: "622724", campaign_name: "DMOM1020 Canada", listing: "DMOM1020", product_status: "ACTIVE", product_default_bid: "0.05" }),
      listing({ campaign_id: "622740", campaign_name: "Serving Canada", listing: "DMOM1023", Date: "2026-07-03", product_status: "ACTIVE", product_default_bid: "0.05", impressions: "233", spend_USD: "0.05" }),
    ],
    decisionEnd: "2026-07-05",
  });

  assert.deepEqual(findings.map((item) => [item.campaignId, item.severity, item.actionType]), [
    ["598135", "P0", "PAUSE_CAMPAIGN"],
    ["622724", "P0", "CHECK_LISTING_ELIGIBILITY"],
    ["622729", "P0", "PAUSE_CAMPAIGN"],
    ["622740", "P1", "CHECK_LOW_DELIVERY"],
  ]);
  const broken = findings.find((item) => item.campaignId === "622729");
  assert.equal(broken.listing, "DMOM1027");
  assert.equal(broken.linkStatus, "INACTIVE");
  assert.match(broken.reasons.join("；"), /14个成熟日0曝光/);
  assert.match(broken.reasons.join("；"), /Listing.*INACTIVE/);

  const eligibility = findings.find((item) => item.campaignId === "622724");
  assert.equal(eligibility.listing, "DMOM1020");
  assert.equal(eligibility.before.bid, 0.05);
  assert.equal(eligibility.execution, "MANUAL_REVIEW");

  const keyword = findings.find((item) => item.campaignId === "598135");
  assert.equal(keyword.listing, "CAMPAIGN");
  assert.equal(keyword.targetingType, "Keyword Targeting");
});

test("flags only bid-floor near-zombies and leaves real delivery alone", () => {
  const findings = detectZombieCampaigns({
    campaignRows: [
      campaign({ campaign_id: "622740", campaign_name: "Bid floor", Date: "2026-07-03", impressions: "233", clicks: "1", spend_USD: "0.05" }),
      campaign({ campaign_id: "622760", campaign_name: "Canada winner", Date: "2026-07-03", impressions: "2724", clicks: "77", spend_USD: "3.85", attributed_orders_window_view_through_Day_14: "1" }),
      campaign({ campaign_id: "622722", campaign_name: "Meaningful spend", Date: "2026-07-03", impressions: "3431", clicks: "22", spend_USD: "10.15" }),
    ],
    listingRows: [
      listing({ campaign_id: "622740", campaign_name: "Bid floor", listing: "DMOM1023", Date: "2026-07-03", product_status: "ACTIVE", product_default_bid: "0.05", impressions: "233", clicks: "1", spend_USD: "0.05" }),
      listing({ campaign_id: "622760", campaign_name: "Canada winner", listing: "DMOM1017", Date: "2026-07-03", product_status: "ACTIVE", product_default_bid: "0.05", impressions: "2724", clicks: "77", spend_USD: "3.85", attributed_orders_window_view_through_Day_14: "1" }),
      listing({ campaign_id: "622722", campaign_name: "Meaningful spend", listing: "DMOM1022", Date: "2026-07-03", product_status: "ACTIVE", product_default_bid: "0.42", impressions: "3431", clicks: "22", spend_USD: "10.15" }),
    ],
    decisionEnd: "2026-07-05",
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].campaignId, "622740");
  assert.equal(findings[0].severity, "P1");
  assert.equal(findings[0].actionType, "CHECK_LOW_DELIVERY");
  assert.deepEqual(findings[0].metric, { impressions: 233, clicks: 1, spend: 0.05, orders: 0 });
});

test("does not call a new or historically empty campaign a hard zombie", () => {
  const findings = detectZombieCampaigns({
    campaignRows: [
      campaign({ campaign_id: "700001", campaign_name: "New empty", impressions: "0", clicks: "0", spend_USD: "0" }),
    ],
    listingRows: [
      listing({ campaign_id: "700001", campaign_name: "New empty", listing: "DMOM1099", impressions: "0", clicks: "0", spend_USD: "0", product_status: "ACTIVE" }),
    ],
    decisionEnd: "2026-07-05",
  });

  assert.deepEqual(findings, []);
});
