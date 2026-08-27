import assert from "node:assert/strict";
import test from "node:test";

import { assessWayfairAttributeHealth } from "../lib/wayfair-attribute-health.mjs";

const rules = [
  {
    taxonomyAttributeId: "core::supplierPartNumber",
    title: "Supplier Part Number",
    requirement: "REQUIRED",
    isActive: true,
    isMultiValue: false,
    possibleAttributeValues: [],
    valueFormat: { datatype: "STRING", canValueBeCustomized: true },
  },
  {
    taxonomyAttributeId: "core::manufacturerId",
    title: "Brand",
    requirement: "REQUIRED",
    isActive: true,
    isMultiValue: false,
    possibleAttributeValues: [],
    valueFormat: { datatype: "STRING", canValueBeCustomized: true },
  },
  {
    taxonomyAttributeId: "core::productName",
    title: "Product Name",
    requirement: "REQUIRED",
    isActive: true,
    isMultiValue: false,
    possibleAttributeValues: [],
    valueFormat: { datatype: "STRING", canValueBeCustomized: true },
  },
  {
    taxonomyAttributeId: "dimensions::width",
    title: "Width",
    requirement: "REQUIRED",
    isActive: true,
    isMultiValue: false,
    possibleAttributeValues: [],
    valueFormat: { datatype: "DECIMAL", canValueBeCustomized: true },
  },
  {
    taxonomyAttributeId: "appearance::color",
    title: "Color",
    requirement: "RECOMMENDED",
    isActive: true,
    isMultiValue: false,
    possibleAttributeValues: [{ value: "Black" }, { value: "White" }],
    valueFormat: { datatype: "STRING", canValueBeCustomized: false },
  },
  {
    taxonomyAttributeId: "materials::material",
    title: "Material",
    requirement: "RECOMMENDED",
    isActive: true,
    isMultiValue: false,
    possibleAttributeValues: [{ value: "Wood" }],
    valueFormat: { datatype: "STRING", canValueBeCustomized: true },
  },
];

function proposal(attributes) {
  return {
    proposedProductAdditions: [{ productId: "SKU-001", classId: "6", attributes }],
  };
}

test("awards 100 only when every observable required, recommended, identity, and value rule passes", () => {
  const result = assessWayfairAttributeHealth({
    classId: "6",
    rules,
    payload: proposal([
      { attributeId: "core::supplierPartNumber", value: "SKU-001" },
      { attributeId: "core::manufacturerId", value: "BRAND-1" },
      { attributeId: "core::productName", value: "Complete Product" },
      { attributeId: "dimensions::width", value: "12.5" },
      { attributeId: "appearance::color", value: "Black" },
      { attributeId: "materials::material", value: "Metal" },
    ]),
  });

  assert.equal(result.method.name, "Wayfair 属性合规完成度（系统评估，非 Wayfair 官方评分）");
  assert.equal(result.products[0].score, 100);
  assert.equal(result.products[0].band, "优秀");
  assert.equal(result.products[0].hardGate, "PASS");
  assert.equal(result.products[0].canRunValidateOnly, true);
  assert.deepEqual(result.products[0].issues, []);
});

test("blocks preflight and emits attributable issues for missing, invalid, and duplicate values", () => {
  const result = assessWayfairAttributeHealth({
    classId: "6",
    rules,
    payload: proposal([
      { attributeId: "core::supplierPartNumber", value: "SKU-001" },
      { attributeId: "core::manufacturerId", value: "BRAND-1" },
      { attributeId: "dimensions::width", value: "wide" },
      { attributeId: "dimensions::width", value: "13" },
      { attributeId: "appearance::color", value: "Purple" },
    ]),
  });

  const product = result.products[0];
  assert.equal(product.hardGate, "BLOCKED");
  assert.equal(product.canRunValidateOnly, false);
  assert.ok(product.score < 70);
  assert.deepEqual(
    new Set(product.issues.map((issue) => issue.code)),
    new Set([
      "MISSING_REQUIRED",
      "INVALID_DATATYPE",
      "MULTIPLE_VALUES_NOT_ALLOWED",
      "INVALID_ALLOWED_VALUE",
      "MISSING_RECOMMENDED",
    ]),
  );
  assert.ok(product.issues.every((issue) => issue.attributeId && issue.message && issue.suggestion));
});

test("recommended omissions reduce score without creating a hard blocker", () => {
  const result = assessWayfairAttributeHealth({
    classId: "6",
    rules,
    payload: proposal([
      { attributeId: "core::supplierPartNumber", value: "SKU-001" },
      { attributeId: "core::manufacturerId", value: "BRAND-1" },
      { attributeId: "core::productName", value: "Required Only" },
      { attributeId: "dimensions::width", value: "10" },
    ]),
  });

  const product = result.products[0];
  assert.equal(product.hardGate, "PASS");
  assert.equal(product.canRunValidateOnly, true);
  assert.equal(product.score, 90);
  assert.equal(product.band, "基本完整");
  assert.equal(product.issues.filter((issue) => issue.code === "MISSING_RECOMMENDED").length, 2);
});

test("accepts custom values when Wayfair marks the attribute customizable", () => {
  const customRule = rules.find((rule) => rule.taxonomyAttributeId === "materials::material");
  const result = assessWayfairAttributeHealth({
    classId: "6",
    rules: [customRule],
    payload: proposal([{ attributeId: "materials::material", value: "Bamboo Composite" }]),
  });

  assert.equal(result.products[0].issues.some((issue) => issue.code === "INVALID_ALLOWED_VALUE"), false);
});

test("ignores inactive rules, allows declared multi-values, and defers conditional semantics to validateOnly", () => {
  const result = assessWayfairAttributeHealth({
    classId: "6",
    rules: [
      { ...rules[2], isActive: false },
      {
        ...rules[4],
        taxonomyAttributeId: "features::feature",
        parentAttributeId: "features::type",
        isMultiValue: true,
        possibleAttributeValues: [],
        valueFormat: { datatype: "STRING", canValueBeCustomized: true },
      },
    ],
    payload: proposal([
      { attributeId: "features::feature", value: "A" },
      { attributeId: "features::feature", value: "B" },
    ]),
  });

  const product = result.products[0];
  assert.equal(product.issues.some((issue) => issue.code === "MISSING_REQUIRED"), false);
  assert.equal(product.issues.some((issue) => issue.code === "MULTIPLE_VALUES_NOT_ALLOWED"), false);
  assert.ok(result.limitations.some((item) => item.code === "CONDITIONAL_RULES_REQUIRE_VALIDATE_ONLY"));
});

test("produces a stable assessment identity tied to the payload and rule snapshot", () => {
  const input = {
    classId: "6",
    rules,
    payload: proposal([{ attributeId: "core::supplierPartNumber", value: "SKU-001" }]),
  };
  const first = assessWayfairAttributeHealth(input);
  const same = assessWayfairAttributeHealth(input);
  const changed = assessWayfairAttributeHealth({ ...input, classId: "7" });

  assert.equal(first.assessmentId, same.assessmentId);
  assert.notEqual(first.assessmentId, changed.assessmentId);
  assert.match(first.assessmentId, /^WF-AH-[A-F0-9]{16}$/);
});
