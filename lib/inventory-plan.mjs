/**
 * Builds the complete Wayfair TRUE_UP matrix for every active part and
 * production warehouse. Missing source rows are intentionally represented as
 * zero inventory because omitting them would leave stale stock on Wayfair.
 *
 * @param {Array<{
 *   rowNumber:number;
 *   lingxingSku:string;
 *   warehouse:string;
 *   productName:string;
 *   available:number;
 *   locked:number;
 *   incoming:number;
 *   transferInTransit:number;
 * }>} stockRows
 * @param {{
 *   activePartNumbers:string[];
 *   skuMappings:Array<{supplierPartNumber:string;lingxingSku:string}>;
 *   warehouseMappings:Array<{supplierId:number;warehouse:string}>;
 * }} config
 */
export function buildCompleteInventoryRows(stockRows, config) {
  const activeParts = config.activePartNumbers.map((part) => String(part).trim());
  if (activeParts.some((part) => !part)) throw new Error("有效商品编号不能为空");
  if (new Set(activeParts).size !== activeParts.length) throw new Error("有效商品编号存在重复");

  const supplierIds = config.warehouseMappings.map((item) => item.supplierId);
  const warehouseNames = config.warehouseMappings.map((item) => item.warehouse);
  if (
    new Set(supplierIds).size !== supplierIds.length
    || new Set(warehouseNames).size !== warehouseNames.length
  ) {
    throw new Error("仓库映射存在重复或歧义");
  }

  const skuByPart = new Map();
  for (const item of config.skuMappings) {
    if (skuByPart.has(item.supplierPartNumber)) {
      throw new Error(`商品映射存在重复：${item.supplierPartNumber}`);
    }
    skuByPart.set(item.supplierPartNumber, item.lingxingSku);
  }

  const stockByKey = new Map(
    stockRows.map((row) => [`${row.lingxingSku}\u0000${row.warehouse}`, row]),
  );
  const rows = [];
  const unmappedActiveParts = [];
  let missingCombinations = 0;

  for (const supplierPartNumber of activeParts) {
    const lingxingSku = skuByPart.get(supplierPartNumber);
    if (!lingxingSku) unmappedActiveParts.push(supplierPartNumber);

    for (const warehouse of config.warehouseMappings) {
      const source = lingxingSku
        ? stockByKey.get(`${lingxingSku}\u0000${warehouse.warehouse}`)
        : undefined;
      if (!source) missingCombinations += 1;

      const normalizedSource = source ?? {
        rowNumber: 0,
        lingxingSku: lingxingSku ?? "",
        warehouse: warehouse.warehouse,
        productName: "",
        available: 0,
        locked: 0,
        incoming: 0,
        transferInTransit: 0,
      };
      rows.push({
        item: {
          discontinued: false,
          supplierPartNumber,
          quantityOnHand: normalizedSource.available,
          quantityOnOrder: normalizedSource.incoming,
          supplierId: warehouse.supplierId,
          quantityBackordered: 0,
        },
        source: normalizedSource,
      });
    }
  }

  return { rows, missingCombinations, unmappedActiveParts };
}
