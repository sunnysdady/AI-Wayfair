import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NEW_PRODUCT_PROMOTION_RULE_ID,
  evaluateNewProductPromotionSop,
} from "../lib/new-product-sop.mjs";

function readyItem(overrides = {}) {
  return {
    supplierPartNumber: "NEW-SKU-001",
    catalogItemStatus: "LIVE",
    listings: [{ listingId: "WF-NEW-001" }],
    recent30d: { units: 0, revenue: 0 },
    contentHealth: {
      imageCount: 4,
      requiredAttributeCoverage: 1,
    },
    insights: {
      problems: [],
      warnings: [],
      opportunities: [],
    },
    ...overrides,
  };
}

test("recommends the operations agent send a content-ready new product to sampling before advertising", () => {
  const result = evaluateNewProductPromotionSop(readyItem());

  assert.equal(result.ruleId, NEW_PRODUCT_PROMOTION_RULE_ID);
  assert.equal(result.status, "RECOMMENDED");
  assert.equal(result.targetAgent, "OPERATIONS_AGENT");
  assert.equal(result.evidence.imagesComplete, true);
  assert.equal(result.evidence.attributesComplete, true);
  assert.deepEqual(
    result.steps.map((step) => step.action),
    ["VERIFY_AND_SEND_SAMPLE", "LAUNCH_GUARDED_AD_TEST", "REVIEW_NEW_PRODUCT_RESULTS"],
  );
  assert.deepEqual(result.steps[1].dependsOn, ["VERIFY_AND_SEND_SAMPLE"]);
  assert.match(result.steps[0].instruction, /平台合规/);
  assert.match(result.steps[1].instruction, /送测/);
  assert.equal(result.automaticExecution, false);
});

test("fails closed when images or required attributes are incomplete", () => {
  const missingImages = evaluateNewProductPromotionSop(readyItem({
    contentHealth: { imageCount: 2, requiredAttributeCoverage: 1 },
  }));
  assert.equal(missingImages.status, "BLOCKED");
  assert.ok(missingImages.blockers.some((item) => /图片/.test(item)));

  const missingAttributes = evaluateNewProductPromotionSop(readyItem({
    contentHealth: { imageCount: 4, requiredAttributeCoverage: 0.96 },
  }));
  assert.equal(missingAttributes.status, "BLOCKED");
  assert.ok(missingAttributes.blockers.some((item) => /属性/.test(item)));
});

test("uses Catalog problem signals and blocks compliance risks", () => {
  const result = evaluateNewProductPromotionSop(readyItem({
    contentHealth: undefined,
    insights: {
      problems: [{
        title: "Legal Compliance",
        explanation: "CPSC documentation is required.",
      }],
      warnings: [],
      opportunities: [],
    },
  }));

  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.some((item) => /Catalog/.test(item)));
});

test("accepts the established Catalog no-missing-issue proxy when explicit content counts are unavailable", () => {
  const result = evaluateNewProductPromotionSop(readyItem({
    contentHealth: undefined,
  }));

  assert.equal(result.status, "RECOMMENDED");
  assert.equal(result.evidence.imagesComplete, true);
  assert.equal(result.evidence.attributesComplete, true);
  assert.equal(result.evidence.contentEvidence, "CATALOG_NO_MISSING_ISSUES_PROXY");
});

test("does not classify an already-selling product as a new-product launch", () => {
  const result = evaluateNewProductPromotionSop(readyItem({
    recent30d: { units: 3, revenue: 420 },
  }));

  assert.equal(result.status, "NOT_APPLICABLE");
  assert.ok(result.blockers.some((item) => /新品/.test(item)));
});

test("blocks advertising until the product is live and has a listing", () => {
  const result = evaluateNewProductPromotionSop(readyItem({
    catalogItemStatus: "LAUNCHING",
    listings: [],
  }));

  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.some((item) => /LIVE/.test(item)));
  assert.ok(result.blockers.some((item) => /Listing/.test(item)));
});

test("fails closed when sales or Catalog content evidence is unavailable", () => {
  const missingSales = evaluateNewProductPromotionSop(readyItem({
    recent30d: undefined,
  }));
  assert.equal(missingSales.status, "BLOCKED");
  assert.ok(missingSales.blockers.some((item) => /销量证据/.test(item)));

  const missingContentEvidence = evaluateNewProductPromotionSop(readyItem({
    contentHealth: undefined,
    insights: undefined,
  }));
  assert.equal(missingContentEvidence.status, "BLOCKED");
  assert.ok(missingContentEvidence.blockers.some((item) => /图片/.test(item)));
  assert.ok(missingContentEvidence.blockers.some((item) => /属性/.test(item)));
});

test("wires the SOP into Catalog responses, the daily full refresh, and the operator-facing product detail", async () => {
  const [catalogRoute, scheduler, page] = await Promise.all([
    readFile(new URL("../app/api/catalog/items/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-sync.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(catalogRoute, /evaluateNewProductPromotionSop/);
  assert.match(catalogRoute, /newProductSop/);
  assert.match(scheduler, /Catalog 第1页同步/);
  assert.match(page, /运营 Agent · 推新 SOP/);
  assert.match(page, /先送测，再投广告/);
  assert.match(page, /automaticExecution/);
});

test("gives the new-product SOP an independent product secondary menu and work queue", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

  assert.match(page, /type ProductTab = "inventory" \| "catalog" \| "launch" \| "performance"/);
  assert.match(page, /\{ id: "launch", label: "新品孵化 SOP" \}/);
  assert.match(page, /function NewProductSopWorkspace/);
  assert.match(page, /运营 Agent 待接/);
  assert.match(page, /待送测/);
  assert.match(page, /待补条件/);
  assert.match(page, /next === "launch"/);
  assert.match(page, /tab === "launch" \? \(/);
});
