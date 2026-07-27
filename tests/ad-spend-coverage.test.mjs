import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { summarizeAdSpendCoverage } from "../lib/ad-spend-coverage.mjs";

test("reports a closed day with no campaign rows as real zero spend", () => {
  const result = summarizeAdSpendCoverage({
    start: "2026-07-26",
    end: "2026-07-26",
    days: [{ reportDate: "2026-07-26", refreshedAt: "2026-07-26T22:00:00.000Z" }],
    rows: [],
    asOf: "2026-07-27",
  });

  assert.equal(result.spend, 0);
  assert.equal(result.coverage, "FULL");
  assert.deepEqual(result.pendingDays, []);
});

test("keeps an in-progress day pending instead of claiming zero ad spend", () => {
  const result = summarizeAdSpendCoverage({
    start: "2026-07-27",
    end: "2026-07-27",
    days: [{ reportDate: "2026-07-27", refreshedAt: "2026-07-26T22:00:00.000Z" }],
    rows: [],
    asOf: "2026-07-27",
  });

  assert.equal(result.spend, null);
  assert.equal(result.coverage, "PENDING");
  assert.deepEqual(result.pendingDays, ["2026-07-27"]);
});

test("surfaces intraday spend without calling the running day fully covered", () => {
  const result = summarizeAdSpendCoverage({
    start: "2026-07-27",
    end: "2026-07-27",
    days: [{ reportDate: "2026-07-27", refreshedAt: "2026-07-27T04:00:00.000Z" }],
    rows: [{ reportDate: "2026-07-27", spend: 12.5 }],
    asOf: "2026-07-27",
  });

  assert.equal(result.spend, 12.5);
  assert.equal(result.coverage, "PARTIAL");
});

test("sums settled days and flags a window that was never synced", () => {
  const covered = summarizeAdSpendCoverage({
    start: "2026-07-24",
    end: "2026-07-26",
    days: [
      { reportDate: "2026-07-24", refreshedAt: "2026-07-26T22:00:00.000Z" },
      { reportDate: "2026-07-25", refreshedAt: "2026-07-26T22:00:00.000Z" },
      { reportDate: "2026-07-26", refreshedAt: "2026-07-26T22:00:00.000Z" },
    ],
    rows: [
      { reportDate: "2026-07-24", spend: 10 },
      { reportDate: "2026-07-24", spend: 5.25 },
      { reportDate: "2026-07-26", spend: 4 },
    ],
    asOf: "2026-07-27",
  });
  assert.equal(covered.spend, 19.25);
  assert.equal(covered.coverage, "FULL");

  const never = summarizeAdSpendCoverage({
    start: "2026-07-24",
    end: "2026-07-26",
    days: [],
    rows: [],
    asOf: "2026-07-27",
  });
  assert.equal(never.spend, null);
  assert.equal(never.coverage, "NOT_SYNCED");
  assert.equal(never.missingDays.length, 3);
});

test("drops the dead ads-daily-latest fallback from advertising spend reads", async () => {
  const ads = await readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8");

  assert.doesNotMatch(ads, /ads-daily-latest/);
  assert.match(ads, /summarizeAdSpendCoverage/);
});
