import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAdReviewDashboard } from "../lib/ad-review-dashboard.mjs";

test("builds an auditable advertising optimization and review dashboard", () => {
  const dashboard = buildAdReviewDashboard({
    runs: [{ run_key: "weekly:2026-07-01:2026-07-07", decision_start: "2026-07-01", decision_end: "2026-07-07", created_at: "2026-07-21T00:00:00Z" }],
    actions: [
      { id: "bid", run_key: "weekly:2026-07-01:2026-07-07", listing: "DMOM1000", campaign_id: "622741", action_type: "SET_LISTING_BID", before_payload: '{"bid":0.8,"active":true}', proposed_payload: '{"bid":0.72}', status: "EXECUTED", updated_at: "2026-07-21T01:00:00Z" },
      { id: "pause", run_key: "weekly:2026-07-01:2026-07-07", listing: "DMOM1001", campaign_id: "622741", action_type: "SET_LISTING_ACTIVE", before_payload: '{"bid":0.5,"active":true}', proposed_payload: '{"active":false}', status: "FAILED", updated_at: "2026-07-21T01:05:00Z" },
    ],
    reviews: [{ action_id: "bid", source_run_key: "weekly:2026-07-01:2026-07-07", verdict: "EFFECTIVE", payload: '{"summary":"调整有效","orderDelta":2,"revenueDelta":180,"roasDelta":0.7}', evaluated_at: "2026-07-28T00:00:00Z" }],
  });

  assert.deepEqual(dashboard.summary, {
    totalActions: 2,
    executedActions: 1,
    failedActions: 1,
    reviewedActions: 1,
    pendingReviews: 0,
    effectiveReviews: 1,
    harmfulReviews: 0,
    reviewCoverage: 1,
  });
  assert.equal(dashboard.weeks[0].actions.length, 2);
  assert.equal(dashboard.weeks[0].actions[0].before.bid, 0.8);
  assert.equal(dashboard.weeks[0].actions[0].review.revenueDelta, 180);
  assert.equal(dashboard.weeks[0].actions[1].review, null);
});

test("keeps malformed legacy payloads readable and exposes unreviewed executions", () => {
  const dashboard = buildAdReviewDashboard({
    runs: [],
    actions: [{ id: "legacy", run_key: "weekly:2026-06-01:2026-06-07", listing: "DMOM9", campaign_id: "9", action_type: "SET_LISTING_BID", before_payload: "bad-json", proposed_payload: "{}", status: "EXECUTED", updated_at: "2026-06-08T00:00:00Z" }],
    reviews: [],
  });
  assert.equal(dashboard.summary.reviewCoverage, 0);
  assert.equal(dashboard.summary.pendingReviews, 1);
  assert.deepEqual(dashboard.weeks[0].actions[0].before, {});
});

test("adds a dedicated advertising review workspace backed by complete API history", async () => {
  const [page, route, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ads/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id: "review", label: "优化记录与复盘"/);
  assert.match(page, /function AdReviewDashboard/);
  assert.match(page, /\/api\/ads\/history/);
  assert.match(page, /广告优化记录与复盘看板/);
  assert.match(page, /复盘覆盖率/);
  assert.match(page, /执行前 → 建议值 → 执行结果 →\s*成熟复盘/);
  assert.match(route, /action_type IN \('SET_LISTING_BID','SET_LISTING_ACTIVE'\)/);
  assert.match(route, /buildAdReviewDashboard/);
  assert.match(styles, /\.ad-review-dashboard/);
});
