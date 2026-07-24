import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("gives manual advertising optimization its own submenu page after AI optimization", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

  assert.match(page, /type AdsTab = "manager" \| "listings" \| "ai" \| "manual"/);
  assert.match(page, /\{ id: "ai", label: "AI 优化" \}, \{ id: "manual", label: "手动优化 To-Do" \}/);
  assert.match(page, /tab==='manual'&&<div className="manual-optimization-workspace">/);
  assert.match(page, /tab==='ai'&&<>/);
  assert.doesNotMatch(page, /optimizationMode|optimization-mode-switch/);
});
