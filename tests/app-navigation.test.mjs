import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  navigationSearch,
  navigationStateFromSearch,
} from "../lib/app-navigation.mjs";

test("opens the August promotion review from a stable direct URL", () => {
  assert.deepEqual(
    navigationStateFromSearch("?view=planning&tab=august"),
    { view: "planning", tab: "august" },
  );
});

test("rejects invalid direct-link values without leaving the dashboard", () => {
  assert.deepEqual(
    navigationStateFromSearch("?view=unknown&tab=august"),
    { view: "dashboard", tab: null },
  );
});

test("builds a shareable August promotion review URL", () => {
  assert.equal(
    navigationSearch({ view: "planning", tab: "august" }),
    "?view=planning&tab=august",
  );
});

test("opens the confirmed September sales plan from a stable direct URL", () => {
  assert.deepEqual(
    navigationStateFromSearch("?view=planning&tab=september"),
    { view: "planning", tab: "september" },
  );
  assert.equal(
    navigationSearch({ view: "planning", tab: "september" }),
    "?view=planning&tab=september",
  );
});

test("opens server and email daily reports from stable direct links", () => {
  assert.deepEqual(
    navigationStateFromSearch("?view=daily&tab=operating"),
    { view: "daily", tab: "operating" },
  );
  assert.deepEqual(
    navigationStateFromSearch("?view=daily&tab=email"),
    { view: "daily", tab: "email" },
  );
  assert.equal(
    navigationSearch({ view: "daily", tab: "operating" }),
    "?view=daily&tab=operating",
  );
});

test("opens AI 助理 inside the operations shell instead of navigating to a separate page", async () => {
  assert.deepEqual(
    navigationStateFromSearch("?view=assistant"),
    { view: "assistant", tab: null },
  );
  assert.equal(navigationSearch({ view: "assistant" }), "?view=assistant");

  const source = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");
  assert.match(source, /import AssistantWorkspace from "\.\/assistant\/workspace"/);
  assert.match(source, /navigate\("assistant"\)/);
  assert.match(source, /assistant:\s*<AssistantWorkspace embedded \/>/);
  assert.doesNotMatch(source, /href="\/assistant"/);
});
