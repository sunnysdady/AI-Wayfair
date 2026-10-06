import assert from "node:assert/strict";
import test from "node:test";

import { chooseActiveParts, fetchLiveSupplierParts } from "../lib/wayfair-live-parts.mjs";

const env = { WAYFAIR_CATALOG_CLIENT_ID: "id", WAYFAIR_CATALOG_CLIENT_SECRET: "secret", WAYFAIR_CATALOG_SUPPLIER_ID: "1" };
const json = (body) => ({ ok: true, status: 200, json: async () => body });

test("pages through LIVE catalog items and de-duplicates market contexts", async () => {
  const pages = [
    { hasNextPage: true, items: ["A", "B"] },
    { hasNextPage: false, items: ["B", "C"] },
  ];
  let call = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth")) return json({ access_token: "t" });
    const page = pages[call++];
    return json({ data: { supplierCatalogItems: { paginationInfo: { hasNextPage: page.hasNextPage }, catalogItems: page.items.map((p) => ({ supplierPartNumber: p, catalogItemStatus: "LIVE" })) } } });
  };
  assert.deepEqual((await fetchLiveSupplierParts(env, fetchImpl)).sort(), ["A", "B", "C"]);
});

test("throws on missing credentials and on API errors", async () => {
  await assert.rejects(() => fetchLiveSupplierParts({}, async () => json({})), /凭证/);
  const fetchImpl = async (url) => String(url).includes("oauth") ? json({ access_token: "t" }) : json({ data: { supplierCatalogItems: { httpError: { message: "boom" } } } });
  await assert.rejects(() => fetchLiveSupplierParts(env, fetchImpl), /boom/);
});

test("falls back to the static list when the live list is missing or implausibly small", () => {
  const staticParts = Array.from({ length: 80 }, (_, i) => `P${i}`);
  assert.equal(chooseActiveParts(null, staticParts).source, "static");
  assert.equal(chooseActiveParts(["P1"], staticParts).source, "static");
  assert.equal(chooseActiveParts(staticParts.slice(0, 60), staticParts).source, "wayfair-catalog");
});
