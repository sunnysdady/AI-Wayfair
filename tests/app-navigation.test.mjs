import test from "node:test";
import assert from "node:assert/strict";

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
