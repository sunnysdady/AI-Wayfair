import { createHash } from "node:crypto";

const METHOD = {
  name: "Wayfair 属性合规完成度（系统评估，非 Wayfair 官方评分）",
  version: "2026-08-27.1",
  weights: {
    requiredCompleteness: 60,
    observableValueValidity: 25,
    recommendedCompleteness: 10,
    identityCompleteness: 5,
  },
};

const IDENTITY_ATTRIBUTE_IDS = [
  "core::supplierPartNumber",
  "core::manufacturerId",
  "core::productName",
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function attributeId(rule) {
  return text(rule?.taxonomyAttributeId || rule?.attributeId);
}

function requirement(rule) {
  const value = text(rule?.requirement).toUpperCase();
  if (value.includes("REQUIRED")) return "REQUIRED";
  if (value.includes("RECOMMENDED")) return "RECOMMENDED";
  return "OPTIONAL";
}

function flattenRules(rules) {
  const flattened = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    flattened.push(rule);
    if (Array.isArray(rule?.childAttributes)) flattened.push(...rule.childAttributes);
  }
  const byId = new Map();
  for (const rule of flattened) {
    const id = attributeId(rule);
    if (id && rule?.isActive !== false && !byId.has(id)) byId.set(id, rule);
  }
  return [...byId.values()];
}

function indexValues(product) {
  const values = new Map();
  for (const attribute of Array.isArray(product?.attributes) ? product.attributes : []) {
    const id = text(attribute?.attributeId);
    const value = text(attribute?.value);
    if (!id || !value) continue;
    if (!values.has(id)) values.set(id, []);
    values.get(id).push(value);
  }
  return values;
}

function issue(rule, code, severity, message, suggestion, currentValues = []) {
  return {
    code,
    severity,
    attributeId: attributeId(rule),
    title: text(rule?.title || rule?.internalName || attributeId(rule)),
    message,
    suggestion,
    currentValues,
    allowedValues: (Array.isArray(rule?.possibleAttributeValues) ? rule.possibleAttributeValues : [])
      .map((item) => text(item?.value))
      .filter(Boolean),
  };
}

function datatypeIsValid(datatype, value) {
  const type = text(datatype).toUpperCase();
  if (!type || type.includes("STRING") || type.includes("TEXT")) return true;
  if (type.includes("INTEGER")) return /^[-+]?\d+$/.test(value);
  if (type.includes("DECIMAL") || type.includes("NUMBER") || type.includes("NUMERIC") || type.includes("FLOAT")) {
    return value !== "" && Number.isFinite(Number(value));
  }
  if (type.includes("BOOLEAN")) return ["TRUE", "FALSE"].includes(value.toUpperCase());
  return true;
}

function band(score) {
  if (score >= 95) return "优秀";
  if (score >= 85) return "基本完整";
  if (score >= 70) return "需要修复";
  return "不合规";
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 1;
}

function assessProduct(product, rules) {
  const values = indexValues(product);
  const issues = [];
  const required = rules.filter((rule) => requirement(rule) === "REQUIRED");
  const recommended = rules.filter((rule) => requirement(rule) === "RECOMMENDED");
  let presentRequired = 0;
  let presentRecommended = 0;
  let checkedValues = 0;
  let validValues = 0;

  for (const rule of rules) {
    const id = attributeId(rule);
    const currentValues = values.get(id) || [];
    const requirementType = requirement(rule);
    if (!currentValues.length) {
      if (requirementType === "REQUIRED") {
        issues.push(issue(
          rule,
          "MISSING_REQUIRED",
          "BLOCKER",
          `缺少 Wayfair 必填属性「${text(rule?.title || id)}」。`,
          `补充 ${id} 后重新评分。`,
        ));
      } else if (requirementType === "RECOMMENDED") {
        issues.push(issue(
          rule,
          "MISSING_RECOMMENDED",
          "WARNING",
          `缺少 Wayfair 推荐属性「${text(rule?.title || id)}」。`,
          `建议补充 ${id}，提高属性完整度。`,
        ));
      }
      continue;
    }

    if (requirementType === "REQUIRED") presentRequired += 1;
    if (requirementType === "RECOMMENDED") presentRecommended += 1;

    let ruleValid = true;
    if (rule?.isMultiValue === false && currentValues.length > 1) {
      ruleValid = false;
      issues.push(issue(
        rule,
        "MULTIPLE_VALUES_NOT_ALLOWED",
        "BLOCKER",
        `属性「${text(rule?.title || id)}」不允许多个值。`,
        "仅保留一个符合 Wayfair 要求的值。",
        currentValues,
      ));
    }

    const datatype = rule?.valueFormat?.datatype;
    if (currentValues.some((value) => !datatypeIsValid(datatype, value))) {
      ruleValid = false;
      issues.push(issue(
        rule,
        "INVALID_DATATYPE",
        "BLOCKER",
        `属性「${text(rule?.title || id)}」与要求的数据类型 ${text(datatype) || "未知"} 不匹配。`,
        `按 Wayfair 的 ${text(datatype) || "字段"} 格式修正当前值。`,
        currentValues,
      ));
    }

    const allowedValues = (Array.isArray(rule?.possibleAttributeValues) ? rule.possibleAttributeValues : [])
      .map((item) => text(item?.value))
      .filter(Boolean);
    const customizable = rule?.valueFormat?.canValueBeCustomized === true;
    if (allowedValues.length && !customizable && currentValues.some((value) => !allowedValues.includes(value))) {
      ruleValid = false;
      issues.push(issue(
        rule,
        "INVALID_ALLOWED_VALUE",
        "BLOCKER",
        `属性「${text(rule?.title || id)}」包含 Wayfair 候选范围外的值。`,
        `从允许值中选择：${allowedValues.slice(0, 8).join("、")}${allowedValues.length > 8 ? "…" : ""}`,
        currentValues,
      ));
    }

    checkedValues += 1;
    if (ruleValid) validValues += 1;
  }

  const identityPresent = IDENTITY_ATTRIBUTE_IDS.filter((id) => (values.get(id) || []).length > 0).length;
  const components = {
    requiredCompleteness: Math.round(METHOD.weights.requiredCompleteness * ratio(presentRequired, required.length) * 100) / 100,
    observableValueValidity: Math.round(METHOD.weights.observableValueValidity * ratio(validValues, checkedValues) * 100) / 100,
    recommendedCompleteness: Math.round(METHOD.weights.recommendedCompleteness * ratio(presentRecommended, recommended.length) * 100) / 100,
    identityCompleteness: Math.round(METHOD.weights.identityCompleteness * ratio(identityPresent, IDENTITY_ATTRIBUTE_IDS.length) * 100) / 100,
  };
  const score = Math.round(Object.values(components).reduce((sum, value) => sum + value, 0));
  const blockers = issues.filter((item) => item.severity === "BLOCKER");

  return {
    productId: text(product?.productId),
    classId: text(product?.classId),
    score,
    band: band(score),
    hardGate: blockers.length ? "BLOCKED" : "PASS",
    canRunValidateOnly: blockers.length === 0,
    components,
    stats: {
      activeRules: rules.length,
      required: required.length,
      requiredPresent: presentRequired,
      recommended: recommended.length,
      recommendedPresent: presentRecommended,
      checkedValues,
      validValues,
      blockers: blockers.length,
      warnings: issues.length - blockers.length,
    },
    issues,
  };
}

export function assessWayfairAttributeHealth({ classId, rules, payload }) {
  const activeRules = flattenRules(rules);
  const products = Array.isArray(payload?.proposedProductAdditions) ? payload.proposedProductAdditions : [];
  if (!products.length) throw new Error("属性体检至少需要 1 个 Product Addition 商品");
  if (products.length > 100) throw new Error("属性体检一次最多处理 100 个商品");
  const normalizedClassId = text(classId);
  const assessedProducts = products.map((product) => {
    if (normalizedClassId && text(product?.classId) !== normalizedClassId) {
      const assessed = assessProduct(product, activeRules);
      assessed.issues.unshift({
        code: "CLASS_MISMATCH",
        severity: "BLOCKER",
        attributeId: "core::classId",
        title: "Class ID",
        message: `商品 classId ${text(product?.classId) || "缺失"} 与规则快照 ${normalizedClassId} 不一致。`,
        suggestion: `改为 Class ${normalizedClassId}，或重新读取正确 Class 的 Wayfair 属性规则。`,
        currentValues: [text(product?.classId)].filter(Boolean),
        allowedValues: [normalizedClassId],
      });
      assessed.hardGate = "BLOCKED";
      assessed.canRunValidateOnly = false;
      assessed.stats.blockers += 1;
      return assessed;
    }
    return assessProduct(product, activeRules);
  });
  const hasConditionalRules = activeRules.some((rule) =>
    text(rule?.parentAttributeId || rule?.parentId) || (Array.isArray(rule?.childAttributes) && rule.childAttributes.length),
  );
  const ruleFingerprint = fingerprint({ classId: normalizedClassId, rules: activeRules });
  const payloadFingerprint = fingerprint(payload);
  const assessmentId = `WF-AH-${fingerprint({ classId: normalizedClassId, payloadFingerprint, ruleFingerprint }).slice(0, 16).toUpperCase()}`;

  return {
    assessmentId,
    assessedAt: new Date().toISOString(),
    classId: normalizedClassId,
    ruleFingerprint,
    payloadFingerprint,
    method: METHOD,
    aggregate: {
      products: assessedProducts.length,
      averageScore: Math.round(assessedProducts.reduce((sum, product) => sum + product.score, 0) / assessedProducts.length),
      blockedProducts: assessedProducts.filter((product) => product.hardGate === "BLOCKED").length,
      validateOnlyReadyProducts: assessedProducts.filter((product) => product.canRunValidateOnly).length,
    },
    limitations: hasConditionalRules
      ? [{
          code: "CONDITIONAL_RULES_REQUIRE_VALIDATE_ONLY",
          message: "父子/条件属性的触发语义不在当前规则字段中完整表达，最终结论必须以 Wayfair validateOnly 为准。",
        }]
      : [],
    products: assessedProducts,
  };
}
