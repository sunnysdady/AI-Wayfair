import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDailyOperatingReport,
  dailyOperatingReportDue,
} from "../lib/daily-operating-report.mjs";

test("runs once per Shanghai day after 20:00 and remains retry-safe", () => {
  assert.equal(
    dailyOperatingReportDue({
      now: new Date("2026-07-29T11:59:59.000Z"),
      existingReportDate: null,
    }),
    false,
  );
  assert.equal(
    dailyOperatingReportDue({
      now: new Date("2026-07-29T12:00:00.000Z"),
      existingReportDate: null,
    }),
    true,
  );
  assert.equal(
    dailyOperatingReportDue({
      now: new Date("2026-07-29T14:00:00.000Z"),
      existingReportDate: "2026-07-29",
    }),
    false,
  );
});

test("builds a deterministic operator report from server-side business evidence", () => {
  const report = buildDailyOperatingReport({
    now: new Date("2026-07-29T12:00:00.000Z"),
    dailyOrders: {
      current: { orders: 4, units: 5, revenue: 720, contributionAfterAds: 120 },
      previous: { orders: 3, units: 3, revenue: 510, contributionAfterAds: 90 },
    },
    monthOrders: {
      current: { orders: 95, units: 107, revenue: 18_000, contributionAfterAds: 2_900 },
    },
    dailyAds: {
      current: { spend: 85, retailRoas: 5.2, wscRoas: 3.8 },
      previous: { spend: 70, retailRoas: 4.8, wscRoas: 3.5 },
      modelTodo: [{ id: "model-1" }, { id: "model-2" }],
      zombieFindings: [{ campaignId: "675055", severity: "P0", actionType: "PAUSE_CAMPAIGN" }],
    },
    manualCompletions: {
      records: Array.from({ length: 7 }, (_, index) => ({
        taskKey: `SKU-${index}`,
        status: "VERIFIED",
      })),
    },
    operations: {
      records: [
        { operationId: "done", title: "完成广告对账", status: "VERIFIED", updatedAt: "2026-07-29T10:00:00.000Z" },
        { operationId: "doing", title: "复核 Canada 组", status: "EXECUTING", updatedAt: "2026-07-29T09:00:00.000Z" },
        { operationId: "failed", title: "旧同步失败", status: "FAILED", updatedAt: "2026-07-29T08:00:00.000Z" },
      ],
    },
    planProgress: {
      nextPlan: {
        executionPolicy: {
          stretchOrderTarget: 150,
          monthlyContributionFloor: 3_000,
        },
      },
    },
    readiness: {
      environment: { verified: true },
      scopeHealth: { summary: { healthy: 6, failed: 0 } },
    },
    previousReport: {
      aiOptimization: { modelTodoCount: 5 },
    },
  });

  assert.equal(report.reportDate, "2026-07-29");
  assert.equal(report.source, "DigitalOcean server scheduler");
  assert.deepEqual(report.performance.daily, {
    orders: 4,
    units: 5,
    revenue: 720,
    adSpend: 85,
    retailRoas: 5.2,
    wscRoas: 3.8,
    contributionAfterAds: 120,
  });
  assert.equal(report.performance.delta.orders, 1);
  assert.equal(report.aiOptimization.modelTodoCount, 2);
  assert.equal(report.aiOptimization.modelTodoDelta, -3);
  assert.equal(report.todo.verifiedManual, 7);
  assert.equal(report.todo.remainingManual, 3);
  assert.equal(report.target.orderTarget, 150);
  assert.equal(report.target.ordersToTarget, 55);
  assert.deepEqual(report.work.completed, ["完成广告对账"]);
  assert.deepEqual(report.work.inProgress, ["复核 Canada 组"]);
  assert.equal(report.approvals.length, 0);
  assert.match(report.risks[0], /675055/);
  assert.equal(report.system.execution, "SERVER_SILENT");
});

test("wires server persistence and a Daily secondary navigation workspace", async () => {
  const [cron, api, page, navigation, migration] = await Promise.all([
    readFile(new URL("../app/api/cron/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/daily-report/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/app-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../migrations/postgres/0006_daily_operating_reports.sql", import.meta.url), "utf8"),
  ]);

  assert.match(cron, /buildDailyOperatingReport/);
  assert.match(cron, /dailyOperatingReportDue/);
  assert.match(cron, /daily_operating_reports/);
  assert.match(cron, /forceDailyReport/);
  assert.match(api, /SELECT payload,generated_at FROM daily_operating_reports/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS daily_operating_reports/);

  assert.match(page, /type DailyTab = "operating" \| "email"/);
  assert.match(page, /daily:\s*\[\{ id: "operating", label: "工作日报" \}, \{ id: "email", label: "邮件日报" \}\]/);
  assert.match(page, /function DailyWorkspace/);
  assert.match(page, /function OperatingDaily/);
  assert.match(page, /\/api\/operations\/daily-report/);
  assert.match(navigation, /daily:\s*new Set\(\["operating", "email"\]\)/);
});
