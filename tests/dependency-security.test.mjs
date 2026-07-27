import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function versionAtLeast(actual, minimum) {
  if (typeof actual !== "string") return false;
  const left = actual.replace(/^[^0-9]*/, "").split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

test("uses a Next.js release containing the July 2026 security fixes", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const reactServerDom = packageJson.dependencies["react-server-dom-webpack"]
    || packageJson.devDependencies["react-server-dom-webpack"];
  assert.ok(
    versionAtLeast(packageJson.dependencies.next, "16.2.11"),
    `Next.js ${packageJson.dependencies.next} is below the patched 16.2.11 release`,
  );
  assert.ok(
    versionAtLeast(reactServerDom, "19.2.8"),
    `react-server-dom-webpack ${reactServerDom} is below the patched 19.2.8 release`,
  );
});

test("pins patched archive dependencies used by workbook imports", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(versionAtLeast(packageJson.overrides.archiver, "8.0.0"));
  assert.ok(versionAtLeast(packageJson.overrides.unzipper, "0.12.5"));
});
