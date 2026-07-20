function aggregate(rows = []) {
  const result = new Map();
  for (const row of rows) {
    const partNumber = String(row.partNumber || row.part_number || "").trim();
    if (!partNumber) continue;
    const quantity = Number(row.quantityOnHand ?? row.quantity_on_hand ?? 0);
    result.set(partNumber, (result.get(partNumber) || 0) + (Number.isFinite(quantity) ? quantity : 0));
  }
  return result;
}

export function calculateInventoryValueRisk(currentRows = [], previousRows = [], unitCostsCents = {}) {
  const current = aggregate(currentRows);
  const previous = aggregate(previousRows);
  const costs = unitCostsCents instanceof Map ? unitCostsCents : new Map(Object.entries(unitCostsCents));
  let totalUnits = 0;
  let valuedUnits = 0;
  let inventoryValueCents = 0;
  const changes = [];
  for (const [partNumber, quantity] of current) {
    totalUnits += quantity;
    const cost = Number(costs.get(partNumber));
    if (!Number.isFinite(cost) || cost < 0) continue;
    valuedUnits += quantity;
    inventoryValueCents += quantity * cost;
    const unitDelta = quantity - (previous.get(partNumber) || 0);
    changes.push({ partNumber, unitDelta, valueDelta: Number((Math.abs(unitDelta * cost) / 100).toFixed(2)) });
  }
  changes.sort((a, b) => b.valueDelta - a.valueDelta || a.partNumber.localeCompare(b.partNumber));
  return {
    inventoryValue: Number((inventoryValueCents / 100).toFixed(2)),
    absoluteChangeValue: Number(changes.reduce((sum, item) => sum + item.valueDelta, 0).toFixed(2)),
    costCoverage: totalUnits ? valuedUnits / totalUnits : 0,
    totalUnits,
    valuedUnits,
    unvaluedUnits: totalUnits - valuedUnits,
    topChanges: changes.filter((item) => item.valueDelta > 0).slice(0, 5),
  };
}
