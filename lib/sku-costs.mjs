const MAX_PART_LENGTH = 120;
const MAX_UNIT_COST = 100000;
const HEADER_ALIASES = {
  partNumber: ["part_number", "partnumber", "part", "sku", "sku编码", "sku 编码", "货号", "商品编码", "part number"],
  unitCost: ["unit_cost", "unitcost", "cost", "unit cost", "成本", "单位成本", "采购成本", "单价成本"],
};

/**
 * Every margin, break-even ROAS and contribution figure in the app is derived
 * from `sku_costs`. Until a part has a real cost the app falls back to a
 * store-wide margin estimate, so an import that silently accepts a bad number
 * is worse than no import at all — each row is validated and reported.
 */

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveColumns(headers) {
  const normalized = headers.map(normalizeHeader);
  const find = (aliases) => normalized.findIndex((header) => aliases.includes(header));
  return { partNumber: find(HEADER_ALIASES.partNumber), unitCost: find(HEADER_ALIASES.unitCost) };
}

function parseCost(raw) {
  const cleaned = String(raw ?? "").trim().replace(/[$¥,\s]/g, "");
  if (!cleaned) return { ok: false, reason: "成本为空" };
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { ok: false, reason: `成本「${raw}」不是数字` };
  if (value <= 0) return { ok: false, reason: "成本必须大于 0" };
  if (value > MAX_UNIT_COST) return { ok: false, reason: `成本 ${value} 超出上限 ${MAX_UNIT_COST}` };
  const cents = Math.round(value * 100);
  if (cents <= 0) return { ok: false, reason: "成本小于 1 分" };
  return { ok: true, cents };
}

/**
 * @param {{partNumber: unknown, unitCost: unknown}[]} rows
 * @param {Map<string, number>} sellingPriceCents Latest observed unit price per part, for margin sanity checks.
 */
export function validateCostRows(rows, sellingPriceCents = new Map()) {
  const accepted = new Map();
  const errors = [];
  const warnings = [];

  rows.forEach((row, index) => {
    const line = index + 2; // Row 1 is the header in every supported source file.
    const part = String(row.partNumber ?? "").trim();
    if (!part) { errors.push({ line, message: "SKU 编码为空" }); return; }
    if (part.length > MAX_PART_LENGTH) { errors.push({ line, part, message: `SKU 编码超过 ${MAX_PART_LENGTH} 字符` }); return; }

    const cost = parseCost(row.unitCost);
    if (!cost.ok) { errors.push({ line, part, message: cost.reason }); return; }

    if (accepted.has(part) && accepted.get(part) !== cost.cents) {
      warnings.push({ line, part, message: `SKU 重复且成本不一致，采用最后一行 ${(cost.cents / 100).toFixed(2)}` });
    }
    const price = sellingPriceCents.get(part);
    if (price != null && price > 0 && cost.cents >= price) {
      warnings.push({ line, part, message: `成本 ${(cost.cents / 100).toFixed(2)} 不低于售价 ${(price / 100).toFixed(2)}，该 SKU 毛利为负` });
    }
    accepted.set(part, cost.cents);
  });

  return {
    costs: [...accepted].map(([partNumber, unitCostCents]) => ({ partNumber, unitCostCents })),
    errors,
    warnings,
  };
}

/**
 * Revenue-weighted coverage, matching how /api/orders/summary reports costCoverage:
 * a part that never sells barely affects margin accuracy, one that drives most of
 * the revenue affects all of it.
 */
export function summarizeCostCoverage({ soldParts = [], costedParts = [] } = {}) {
  const costed = new Set(costedParts);
  let coveredRevenueCents = 0;
  let totalRevenueCents = 0;
  const missing = [];

  for (const part of soldParts) {
    const revenue = Number(part.revenueCents || 0);
    totalRevenueCents += revenue;
    if (costed.has(part.partNumber)) coveredRevenueCents += revenue;
    else missing.push({ partNumber: part.partNumber, units: Number(part.units || 0), revenueCents: revenue });
  }

  missing.sort((left, right) => right.revenueCents - left.revenueCents);
  return {
    costedParts: costed.size,
    soldParts: soldParts.length,
    missingParts: missing.length,
    revenueCoverage: totalRevenueCents ? Number((coveredRevenueCents / totalRevenueCents).toFixed(4)) : 0,
    missing,
  };
}

export function costTemplateCsv(missing = []) {
  const header = "part_number,unit_cost";
  const rows = missing.map((item) => `${String(item.partNumber).replace(/[",\n]/g, "")},`);
  return [header, ...rows].join("\n");
}
