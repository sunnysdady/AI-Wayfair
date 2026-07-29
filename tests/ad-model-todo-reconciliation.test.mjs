import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { shouldGenerateAdModelTodo } from "../lib/ad-model-todo.mjs";

test("does not recreate optimization work for campaigns that are no longer active", () => {
  assert.equal(
    shouldGenerateAdModelTodo({
      operatingState: { campaignStatus: "archived", campaignActive: false },
      campaignControl: null,
    }).include,
    false,
  );
  assert.equal(
    shouldGenerateAdModelTodo({
      operatingState: { campaignStatus: "INACTIVE", campaignActive: false },
      campaignControl: { status: "PAUSED" },
    }).reason,
    "CAMPAIGN_NOT_ACTIVE",
  );
});

test("keeps a new diagnostic for an active campaign even when its listing needs repair", () => {
  assert.deepEqual(
    shouldGenerateAdModelTodo({
      operatingState: { campaignStatus: "ACTIVE", campaignActive: true },
      campaignControl: { status: "ACTIVE" },
    }),
    { include: true, reason: null },
  );
});

test("links operational state into model Todo and labels distinct audience grains", async () => {
  const [ads, page] = await Promise.all([
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(ads, /shouldGenerateAdModelTodo\(decision\)/);
  assert.match(ads, /operatingState:\s*{/);
  assert.match(ads, /identity:\s*decision\.identity/);
  assert.match(page, /item\.identity\.site/);
  assert.match(page, /item\.identity\.isB2B\s*\?\s*'B2B'\s*:\s*'B2C'/);
  assert.match(page, /item\.identity\.targetingType/);
});

test("updates static manual tasks to the campaign ids already created in Wayfair", async () => {
  const page = await readFile(
    new URL("../app/OpsCenter.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    page,
    /id: "dmom1021-keyword"[\s\S]{0,500}campaignId: "675055"/,
  );
  assert.match(
    page,
    /id: "dmom1022-keyword"[\s\S]{0,500}campaignId: "676296"/,
  );
  assert.match(
    page,
    /id: "dmom1019-product"[\s\S]{0,500}campaignId: "676299"/,
  );
  assert.match(
    page,
    /id: "dmom1019-keyword"[\s\S]{0,500}campaignId: "676302"/,
  );
});
