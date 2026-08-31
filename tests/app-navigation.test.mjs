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
  assert.match(source, /\{ id: "assistant", label: "AI 助理" \}/);
  assert.match(source, /assistant:\s*<AssistantWorkspace embedded \/>/);
  assert.doesNotMatch(source, /href="\/assistant"/);
});

test("keeps legacy product-data URLs inside the unified SKU operating center", async () => {
  assert.deepEqual(
    navigationStateFromSearch("?view=products&tab=addition"),
    { view: "products", tab: "catalog" },
  );
  assert.equal(
    navigationSearch({ view: "products", tab: "addition" }),
    "?view=products&tab=catalog",
  );
  assert.deepEqual(
    navigationStateFromSearch("?view=products&tab=catalog"),
    { view: "products", tab: "catalog" },
  );

  const source = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");
  assert.match(source, /商品资料与质量/);
  assert.match(source, /className="sku-demo-product-context"/);
  assert.doesNotMatch(source, /import ProductAdditionWorkspace from "\.\/product-addition\/workspace"/);
  assert.doesNotMatch(source, /新品 API/);
  assert.doesNotMatch(source, /tab === "addition"/);
  assert.doesNotMatch(source, /label="SKU 经营中心内容"/);
  assert.doesNotMatch(source, /className="catalog-quality-workspace"/);
});

test("keeps the catalog management header vertically structured in its own column", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className="dual-sort catalog-management-head"/);
  assert.match(styles, /\.catalog-row\{min-width:960px;grid-template-columns:1\.1fr \.65fr 1\.25fr 1\.25fr \.7fr \.95fr\}/);
  assert.match(styles, /\.catalog-head \.catalog-management-head\{display:grid!important;min-width:0;gap:2px;align-content:center\}/);
});
