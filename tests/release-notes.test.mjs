import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RELEASE_NOTES,
  validateReleaseNotes,
} from "../lib/release-notes.mjs";

test("locks the v0.3.0 product attribute scoring release record", () => {
  const release = validateReleaseNotes(RELEASE_NOTES);

  assert.equal(release.version, "0.3.0");
  assert.equal(release.releaseDate, "2026-08-27");
  assert.equal(release.productionBaseline, "ea625249033f5c4c1847aa18513b28011f70906d");
  assert.equal(release.git.commits, 4);
  assert.deepEqual(release.systemSummary, {
    featureAreas: 3,
    logicUpgrades: 4,
    commits: 4,
    tests: 364,
  });
  assert.equal(Object.keys(release.managementBrief).length, 5);
  assert.ok(release.managementBrief.completed.length >= 4);
  assert.ok(release.managementBrief.results.length >= 4);
  assert.ok(release.managementBrief.blockers.length >= 3);
  assert.ok(release.managementBrief.assistance.length >= 3);
  assert.ok(release.managementBrief.tomorrow.length >= 4);
  assert.equal(release.systemUpgrades.length, 3);
  assert.equal(release.logicUpgrades.length, 4);
  assert.match(release.title, /产品属性评分工作台与规则修复/);
  assert.deepEqual(release.verification, {
    testsPassed: 364,
    testsFailed: 0,
    build: "PASS",
    lintErrors: 0,
    lintWarnings: 2,
    logs: "No fatal, uncaught, unhandled or error events",
  });
  assert.deepEqual(release.guardrails, {
    liveSubmit: "OFF (default)",
    assessmentWriteScope: "仅写操作闭环，不写 Wayfair 商品",
    maxProductsPerAssessment: 100,
    classScope: "首期仅支持同一 Class 的商品批次",
  });
  assert.equal(release.production.domain, "aiwayfair.sunnysdady.com");
  assert.equal(release.production.health, "200 OK");
  assert.equal(release.production.protectedProductPage, "401 Protected");
  assert.equal(release.production.protectedProductAdditionApi, "401 Protected");
  assert.equal(release.production.imageTag, "ea625249033f");
  assert.ok(release.followUps.length >= 4);
});

test("renders the current release before production verification and guardrails", async () => {
  const [page, shell, changelog] = await Promise.all([
    readFile(new URL("../app/releases/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /RELEASE_NOTES/);
  assert.match(page, /系统功能升级/);
  assert.match(page, /核心逻辑升级/);
  assert.match(page, /发布验收/);
  assert.match(page, /生产部署/);
  assert.match(page, /质量验证/);
  assert.match(page, /安全与范围/);
  assert.match(page, /Wayfair AI · 版本记录/);
  assert.match(page, /版本发布结论/);
  assert.match(page, /本次完成/);
  assert.match(page, /验收结果/);
  assert.match(page, /当前限制/);
  assert.match(page, /协助与授权/);
  assert.match(page, /后续计划/);
  assert.ok(page.indexOf("系统功能升级") < page.indexOf("发布验收"));
  assert.doesNotMatch(page, /运行快照|今日 Orders|Outlook|财务摘要/);
  const status = page.match(/<section className="release-status"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(status, /系统模块/);
  assert.match(status, /核心逻辑/);
  assert.match(status, /验证测试/);
  assert.match(shell, /href="\/releases"/);
  assert.match(shell, /版本记录 · v0\.3\.0/);
  assert.match(changelog, /## \[0\.3\.0\] - 2026-08-27/);
  assert.match(changelog, /ea62524/);
  assert.match(page, /后续待办/);
});
