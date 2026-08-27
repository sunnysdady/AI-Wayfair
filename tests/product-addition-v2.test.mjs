import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCT_ADDITION_OPERATIONS,
  assertProductAdditionLiveGate,
  buildSubmitVariables,
  payloadHash,
  productAdditionReadiness,
  summarizeProductAdditionStatus,
} from "../lib/wayfair-product-addition-v2.mjs";

const proposal = {
  proposedProductAdditions: [
    {
      productId: "PA-CANDIDATE-001",
      classId: "6",
      attributes: [
        { attributeId: "core::supplierPartNumber", value: "PA-CANDIDATE-001" },
        { attributeId: "core::productName", value: "Test candidate" },
      ],
    },
  ],
};

test("uses the exact Product Addition V2 operation names required by Wayfair tracking", () => {
  assert.match(PRODUCT_ADDITION_OPERATIONS.submit, /^mutation submitV2\b/m);
  assert.match(PRODUCT_ADDITION_OPERATIONS.status, /^query submissionsV2\b/m);
  assert.match(PRODUCT_ADDITION_OPERATIONS.categories, /^query taxonomyCategories\b/m);
  assert.match(PRODUCT_ADDITION_OPERATIONS.brands, /^query brandAssociations\b/m);
  assert.match(PRODUCT_ADDITION_OPERATIONS.attributes, /^query attributesByFilter\b/m);
});

test("server owns submit options and forces validateOnly for preflight", () => {
  const variables = buildSubmitVariables(
    {
      ...proposal,
      options: { validateOnly: false, ignoreWarnings: true, rejectAllOnErrors: false },
      jobContext: { hasMoreProducts: true, totalExpectedProducts: 999 },
    },
    { validateOnly: true },
  );

  assert.deepEqual(variables.request.options, {
    validateOnly: true,
    ignoreWarnings: false,
    rejectAllOnErrors: true,
  });
  assert.deepEqual(variables.request.jobContext, {
    productAdditionRequestId: null,
    hasMoreProducts: false,
    totalExpectedProducts: 1,
  });
});

test("payload hash is stable and detects any post-preflight mutation", () => {
  const first = payloadHash(proposal);
  const reordered = payloadHash({
    proposedProductAdditions: proposal.proposedProductAdditions.map((item) => ({
      attributes: item.attributes,
      classId: item.classId,
      productId: item.productId,
    })),
  });
  const changed = payloadHash({
    proposedProductAdditions: [
      { ...proposal.proposedProductAdditions[0], classId: "7" },
    ],
  });

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("live submission requires an explicit gate and exact supplier identity", () => {
  const base = {
    WAYFAIR_DEPLOYMENT_ENV: "production",
    WAYFAIR_PRODUCT_ADDITION_CLIENT_ID: "client",
    WAYFAIR_PRODUCT_ADDITION_CLIENT_SECRET: "secret",
    WAYFAIR_PRODUCT_ADDITION_SUPPLIER_ID: "347069",
    WAYFAIR_EXPECTED_SUPPLIER_IDS: "347069",
  };

  assert.throws(() => assertProductAdditionLiveGate(base), /正式提交未启用/);
  assert.throws(
    () =>
      assertProductAdditionLiveGate({
        ...base,
        ALLOW_WAYFAIR_PRODUCT_ADDITION_LIVE_SUBMIT: "true",
        WAYFAIR_PRODUCT_ADDITION_SUPPLIER_ID: "999999",
      }),
    /供应商身份不匹配/,
  );
  assert.equal(
    assertProductAdditionLiveGate({
      ...base,
      ALLOW_WAYFAIR_PRODUCT_ADDITION_LIVE_SUBMIT: "true",
    }),
    true,
  );
});

test("readiness never exposes credentials and reports read/write separately", () => {
  const readiness = productAdditionReadiness({
    WAYFAIR_DEPLOYMENT_ENV: "production",
    WAYFAIR_PRODUCT_ADDITION_CLIENT_ID: "visible-only-on-server",
    WAYFAIR_PRODUCT_ADDITION_CLIENT_SECRET: "never-return-this",
    WAYFAIR_PRODUCT_ADDITION_SUPPLIER_ID: "347069",
    WAYFAIR_EXPECTED_SUPPLIER_IDS: "347069",
    ALLOW_WAYFAIR_PRODUCT_ADDITION_LIVE_SUBMIT: "false",
  });

  assert.deepEqual(readiness, {
    configured: true,
    deployment: "production",
    supplierId: "347069",
    identityMatched: true,
    readEnabled: true,
    liveSubmitEnabled: false,
  });
  assert.doesNotMatch(JSON.stringify(readiness), /never-return-this|visible-only-on-server/);
});

test("rejects malformed and oversized Product Addition payloads", () => {
  assert.throws(
    () => buildSubmitVariables({ proposedProductAdditions: [] }, { validateOnly: true }),
    /至少包含 1 个商品/,
  );
  assert.throws(
    () =>
      buildSubmitVariables(
        { proposedProductAdditions: [{ productId: "BAD SPACE", classId: "6", attributes: [] }] },
        { validateOnly: true },
      ),
    /productId 格式无效/,
  );
  assert.throws(
    () =>
      buildSubmitVariables(
        { proposedProductAdditions: Array.from({ length: 101 }, () => proposal.proposedProductAdditions[0]) },
        { validateOnly: true },
      ),
    /最多包含 100 个商品/,
  );
});

test("summarizes polling results into pending, success, or failure terminal states", () => {
  assert.deepEqual(
    summarizeProductAdditionStatus({
      productAdditionStatus: [{ validationStatus: "PROCESSING", submissionStatus: null }],
    }),
    { terminal: false, successful: false, statuses: ["PROCESSING"] },
  );
  assert.deepEqual(
    summarizeProductAdditionStatus({
      productAdditionStatus: [{ validationStatus: "VALIDATED", submissionStatus: "COMPLETED" }],
    }),
    { terminal: true, successful: true, statuses: ["VALIDATED", "COMPLETED"] },
  );
  assert.deepEqual(
    summarizeProductAdditionStatus({
      productAdditionStatus: [{ validationStatus: "VALIDATED", submissionStatus: "REJECTED" }],
    }),
    { terminal: true, successful: false, statuses: ["VALIDATED", "REJECTED"] },
  );
});
