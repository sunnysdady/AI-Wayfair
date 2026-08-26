import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LINGXING_TIME_ZONE,
  lingxingDate,
  lingxingDayStart,
  shiftLingxingDate,
} from "../lib/lingxing-business-time.mjs";

test("uses Wayfair NA's Lingxing business timezone for reporting dates", () => {
  assert.equal(LINGXING_TIME_ZONE, "America/New_York");
  assert.equal(lingxingDate(new Date("2026-08-26T03:30:00.000Z")), "2026-08-25");
  assert.equal(shiftLingxingDate("2026-08-26", -1), "2026-08-25");
});

test("uses the correct New York midnight boundary across daylight-saving changes", () => {
  assert.equal(lingxingDayStart("2026-03-08"), "2026-03-08T05:00:00.000Z");
  assert.equal(lingxingDayStart("2026-03-09"), "2026-03-09T04:00:00.000Z");
  assert.equal(lingxingDayStart("2026-11-01"), "2026-11-01T04:00:00.000Z");
  assert.equal(lingxingDayStart("2026-11-02"), "2026-11-02T05:00:00.000Z");
});

test("routes every business-day surface through the shared Lingxing timezone", async () => {
  const files = [
    "app/OpsCenter.tsx",
    "app/api/orders/summary/route.ts",
    "app/api/sku-costs/route.ts",
    "app/api/ads/actions/execute/route.ts",
    "app/api/plan/progress/route.ts",
    "app/api/cron/sync/route.ts",
    "lib/ad-spend-coverage.mjs",
    "lib/assistant-search.mjs",
    "lib/daily-operating-report.mjs",
    "lib/outlook-daily-sync.mjs",
    "lib/wayfair-ads.ts",
  ];
  const contents = await Promise.all(files.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));

  for (const content of contents) {
    assert.match(content, /lingxing-business-time\.mjs/);
    assert.doesNotMatch(content, /Asia\/Shanghai|\+08:00/);
  }
});
