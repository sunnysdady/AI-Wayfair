import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

test("daily date tabs always include today while cached available dates refresh", () => {
  assert.match(source, /new Set\(\[today, \.\.\.availableDates\]\)/);
  assert.doesNotMatch(source, /availableDates\.length && !availableDates\.includes\(date\)/);
});
