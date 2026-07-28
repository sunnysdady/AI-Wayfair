import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RELEASE_NOTES,
  validateReleaseNotes,
} from "../lib/release-notes.mjs";

test("locks the 2026-07-28 closeout facts to the production release", () => {
  const release = validateReleaseNotes(RELEASE_NOTES);

  assert.equal(release.version, "0.2.0");
  assert.equal(release.releaseDate, "2026-07-28");
  assert.equal(release.productionBaseline, "c80d48e");
  assert.equal(release.git.commits, 66);
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
  assert.ok(release.highlights.length >= 5);
  assert.ok(release.followUps.length >= 3);
});

test("publishes the closeout in Git documentation and the production UI", async () => {
  const [page, shell, changelog, daily, html] = await Promise.all([
    readFile(new URL("../app/releases/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/daily/2026-07-28.md", import.meta.url), "utf8"),
    readFile(new URL("../.next/server/app/releases.html", import.meta.url), "utf8"),
  ]);

  assert.match(page, /RELEASE_NOTES/);
  assert.match(page, /今日收尾/);
  assert.match(shell, /href="\/releases"/);
  assert.match(shell, /版本记录 · v0\.2\.0/);
  assert.match(changelog, /## \[0\.2\.0\] - 2026-07-28/);
  assert.match(daily, /# Wayfair AI 运营中台日报 · 2026-07-28/);
  assert.match(daily, /66 个提交/);
  assert.match(daily, /14 封/);
  assert.match(html, /Wayfair AI · 版本记录/);
  assert.match(html, /v0\.2\.0/);
  assert.match(html, /日终结论/);
  assert.match(html, /后续待办/);
});
