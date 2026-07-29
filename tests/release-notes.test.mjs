import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RELEASE_NOTES,
  validateReleaseNotes,
} from "../lib/release-notes.mjs";

test("locks the rerun 2026-07-28 system and logic upgrade report", () => {
  const release = validateReleaseNotes(RELEASE_NOTES);

  assert.equal(release.version, "0.2.2");
  assert.equal(release.releaseDate, "2026-07-28");
  assert.equal(release.productionBaseline, "2ac14c5");
  assert.equal(release.git.commits, 88);
  assert.deepEqual(release.systemSummary, {
    featureAreas: 6,
    logicUpgrades: 6,
    commits: 88,
    tests: 316,
  });
  assert.equal(Object.keys(release.managementBrief).length, 5);
  assert.ok(release.managementBrief.completed.length >= 4);
  assert.ok(release.managementBrief.results.length >= 4);
  assert.ok(release.managementBrief.blockers.length >= 3);
  assert.ok(release.managementBrief.assistance.length >= 3);
  assert.ok(release.managementBrief.tomorrow.length >= 4);
  assert.ok(release.systemUpgrades.length >= 6);
  assert.ok(release.logicUpgrades.length >= 6);
  assert.match(release.title, /系统功能与逻辑升级日报/);
  assert.equal(release.outlook.total, 5);
  assert.equal(release.outlook.unread, 2);
  assert.equal(release.outlook.actionRequired, 5);
  assert.equal(release.outlook.highestPriority, "P1");
  assert.deepEqual(release.finance, {
    remittanceId: "10002005965230",
    currency: "USD",
    actualAmount: 565.88,
    paymentDate: "2026-07-31",
    paymentMethod: "Bank transfer",
    grossInvoiceValue: 602,
    qualityDeduction: -24.08,
    earlyPayDiscount: -12.04,
    serviceFee: 0,
    invoiceCount: 5,
  });
  assert.deepEqual(release.dailyRun, {
    generatedAt: "2026-07-29T10:25:52.582Z",
    orders: 2,
    units: 2,
    revenue: 171,
    adSpend: 0.59,
    contributionAfterAds: 56.51,
    monthOrders: 53,
    completedManualAds: 10,
    remainingManualAds: 0,
    adsDataLayer: "POSTGRESQL_REPORT_ROWS",
  });
  assert.deepEqual(release.operations, {
    total: 25,
    closed: 10,
    pendingAcceptance: 15,
    pendingReview: 0,
    failed: 0,
  });
  assert.ok(release.followUps.length >= 3);
});

test("publishes system upgrades before the secondary runtime snapshot", async () => {
  const [page, shell, changelog, daily, html] = await Promise.all([
    readFile(new URL("../app/releases/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/daily/2026-07-28.md", import.meta.url), "utf8"),
    readFile(new URL("../.next/server/app/releases.html", import.meta.url), "utf8"),
  ]);

  assert.match(page, /RELEASE_NOTES/);
  assert.match(page, /系统功能升级/);
  assert.match(page, /核心逻辑升级/);
  assert.match(page, /运行快照/);
  assert.match(shell, /href="\/releases"/);
  assert.match(shell, /版本记录 · v0\.2\.2/);
  assert.match(changelog, /## \[0\.2\.2\] - 2026-07-29/);
  assert.match(daily, /# Wayfair AI 系统功能与逻辑升级日报 · 2026-07-28/);
  assert.match(daily, /88 个提交/);
  assert.match(daily, /实际汇款 USD 565\.88/);
  assert.match(daily, /今日工作日报已由 DigitalOcean Scheduler 强制重跑/);
  assert.match(daily, /## 管理摘要/);
  assert.match(daily, /### 今天完成了什么/);
  assert.match(daily, /### 结果怎么样/);
  assert.match(daily, /### 遇到的阻力/);
  assert.match(daily, /### 需要你的协助或授权/);
  assert.match(daily, /### 明天计划/);
  assert.match(daily, /## 系统功能升级/);
  assert.match(daily, /## 核心逻辑升级/);
  assert.ok(daily.indexOf("## 系统功能升级") < daily.indexOf("## 运行快照"));
  assert.match(html, /Wayfair AI · 版本记录/);
  assert.match(html, /v0\.2\.2/);
  assert.match(html, /系统升级结论/);
  assert.match(html, /USD 565\.88/);
  assert.match(html, /今日 Orders/);
  assert.match(html, /今天完成了什么/);
  assert.match(html, /结果怎么样/);
  assert.match(html, /遇到的阻力/);
  assert.match(html, /需要你的协助或授权/);
  assert.match(html, /明天计划/);
  assert.ok(html.indexOf("系统功能升级") < html.indexOf("运行快照"));
  const status = html.match(/<section class="release-status"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(status, /系统模块/);
  assert.match(status, /核心逻辑/);
  assert.match(status, /验证测试/);
  assert.doesNotMatch(status, /Outlook|闭环任务/);
  assert.match(html, /后续待办/);
});
