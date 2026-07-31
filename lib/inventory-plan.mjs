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
 *   skuMappings:Array<{supplierPartNumber:string;lingxingSku:string}>; // Pipe-delimited values are summed.
 *   warehouseMappings:Array<{supplierId:number;warehouse:string}>;
 * }} config
 */
export function buildCompleteInventoryRows(stockRows, config) {
  const activeParts = config.activePartNumbers.map((part) => String(part).trim());
  if (activeParts.some((part) => !part)) throw new Error("有效商品编号不能为空");
  if (new Set(activeParts).size !== activeParts.length) throw new Error("有效商品编号存在重复");

  const supplierIds = config.warehouseMappings.map((item) => item.supplierId);
  if (new Set(supplierIds).size !== supplierIds.length) {
    throw new Error("仓库映射存在重复或歧义");
  }

  const skuByPart = new Map();
  for (const item of config.skuMappings) {
    if (skuByPart.has(item.supplierPartNumber)) {
      throw new Error(`商品映射存在重复：${item.supplierPartNumber}`);
    }
    const lingxingSkus = [...new Set(
      String(item.lingxingSku ?? "")
        .split("|")
        .map((sku) => sku.trim())
        .filter(Boolean),
    )];
    skuByPart.set(item.supplierPartNumber, lingxingSkus);
  }

  const stockByKey = new Map(
    stockRows.map((row) => [`${row.lingxingSku}\u0000${row.warehouse}`, row]),
  );
  const rows = [];
  const unmappedActiveParts = [];
  let missingCombinations = 0;

  for (const supplierPartNumber of activeParts) {
    const lingxingSkus = skuByPart.get(supplierPartNumber) ?? [];
    if (!lingxingSkus.length) unmappedActiveParts.push(supplierPartNumber);

    for (const warehouse of config.warehouseMappings) {
      const sources = lingxingSkus
        .map((lingxingSku) => stockByKey.get(`${lingxingSku}\u0000${warehouse.warehouse}`))
        .filter(Boolean);
      missingCombinations += lingxingSkus.length
        ? lingxingSkus.length - sources.length
        : 1;

      const normalizedSource = {
        rowNumber: sources[0]?.rowNumber ?? 0,
        lingxingSku: lingxingSkus.join("|"),
        warehouse: warehouse.warehouse,
        productName: [...new Set(sources.map((source) => source.productName).filter(Boolean))].join(" | "),
        available: sources.reduce((sum, source) => sum + source.available, 0),
        locked: sources.reduce((sum, source) => sum + source.locked, 0),
        incoming: sources.reduce((sum, source) => sum + source.incoming, 0),
        transferInTransit: sources.reduce((sum, source) => sum + source.transferInTransit, 0),
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
