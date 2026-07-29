import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RELEASE_NOTES,
  validateReleaseNotes,
} from "../lib/release-notes.mjs";

test("locks the 2026-07-28 system and logic upgrade report", () => {
  const release = validateReleaseNotes(RELEASE_NOTES);

  assert.equal(release.version, "0.2.1");
  assert.equal(release.releaseDate, "2026-07-28");
  assert.equal(release.productionBaseline, "c80d48e");
  assert.equal(release.git.commits, 66);
  assert.deepEqual(release.systemSummary, {
    featureAreas: 6,
    logicUpgrades: 6,
    commits: 66,
    tests: 293,
  });
  assert.ok(release.systemUpgrades.length >= 6);
  assert.ok(release.logicUpgrades.length >= 6);
  assert.match(release.title, /系统功能与逻辑升级日报/);
  assert.equal(release.outlook.total, 14);
  assert.equal(release.outlook.unread, 6);
  assert.equal(release.outlook.actionRequired, 14);
  assert.equal(release.outlook.highestPriority, "P1");
  assert.deepEqual(release.operations, {
    total: 45,
    closed: 3,
    pendingAcceptance: 11,
    pendingReview: 10,
    failed: 21,
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
  assert.match(shell, /版本记录 · v0\.2\.1/);
  assert.match(changelog, /## \[0\.2\.1\] - 2026-07-29/);
  assert.match(daily, /# Wayfair AI 系统功能与逻辑升级日报 · 2026-07-28/);
  assert.match(daily, /66 个提交/);
  assert.match(daily, /## 系统功能升级/);
  assert.match(daily, /## 核心逻辑升级/);
  assert.ok(daily.indexOf("## 系统功能升级") < daily.indexOf("## 运行快照"));
  assert.match(html, /Wayfair AI · 版本记录/);
  assert.match(html, /v0\.2\.1/);
  assert.match(html, /系统升级结论/);
  assert.ok(html.indexOf("系统功能升级") < html.indexOf("运行快照"));
  const status = html.match(/<section class="release-status"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(status, /系统模块/);
  assert.match(status, /核心逻辑/);
  assert.match(status, /验证测试/);
  assert.doesNotMatch(status, /Outlook|闭环任务/);
  assert.match(html, /后续待办/);
});
