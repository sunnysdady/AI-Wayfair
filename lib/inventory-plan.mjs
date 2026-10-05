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
 *   warehouseMappings:Array<{supplierId:number;warehouse:string}>; // Pipe-delimited warehouses are summed.
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
  // 每个补零的"商品×领星SKU×仓库"一条，条数与 missingCombinations 一致，供运营导出核对。
  const missingDetails = [];
  let missingCombinations = 0;

  for (const supplierPartNumber of activeParts) {
    const lingxingSkus = skuByPart.get(supplierPartNumber) ?? [];
    if (!lingxingSkus.length) unmappedActiveParts.push(supplierPartNumber);

    for (const warehouse of config.warehouseMappings) {
      const warehouseNames = [...new Set(
        String(warehouse.warehouse ?? "")
          .split("|")
          .map((name) => name.trim())
          .filter(Boolean),
      )];
      const sources = lingxingSkus.flatMap((lingxingSku) => warehouseNames
        .map((warehouseName) => stockByKey.get(`${lingxingSku}\u0000${warehouseName}`))
        .filter(Boolean));
      const expectedPairs = Math.max(lingxingSkus.length * warehouseNames.length, 1);
      missingCombinations += expectedPairs - sources.length;
      if (!lingxingSkus.length) {
        missingDetails.push({
          supplierPartNumber,
          supplierId: warehouse.supplierId,
          lingxingSku: "",
          warehouse: warehouseNames.join("|"),
          reason: "商品未映射领星 SKU",
        });
      } else {
        for (const lingxingSku of lingxingSkus) {
          for (const warehouseName of warehouseNames) {
            if (stockByKey.has(`${lingxingSku}\u0000${warehouseName}`)) continue;
            missingDetails.push({
              supplierPartNumber,
              supplierId: warehouse.supplierId,
              lingxingSku,
              warehouse: warehouseName,
              reason: "领星无该 SKU 在此仓的库存记录",
            });
          }
        }
      }

      const normalizedSource = {
        rowNumber: sources[0]?.rowNumber ?? 0,
        lingxingSku: lingxingSkus.join("|"),
        warehouse: warehouseNames.join("|") || warehouse.warehouse,
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

  return { rows, missingCombinations, missingDetails, unmappedActiveParts };
}

/**
 * 按领星 SKU 汇总"领星无库存记录"的仓库数，帮运营判断是编码对不上还是个别仓没货。
 * 只统计 reason 为"领星无该 SKU 在此仓的库存记录"的条目；未映射商品（多为停售）不在其中。
 *
 * @param {Array<{lingxingSku:string;warehouse:string;reason:string}>} details
 * @param {number} totalWarehouses 映射表里不同领星仓库的总数
 */
export function summarizeMissingBySku(details, totalWarehouses) {
  const bySku = new Map();
  for (const item of details) {
    if (!item.lingxingSku) continue;
    const warehouses = bySku.get(item.lingxingSku) ?? new Set();
    warehouses.add(item.warehouse);
    bySku.set(item.lingxingSku, warehouses);
  }
  return [...bySku.entries()]
    .map(([lingxingSku, warehouses]) => ({
      lingxingSku,
      missingWarehouses: warehouses.size,
      totalWarehouses,
      allMissing: warehouses.size >= totalWarehouses,
      warehouses: [...warehouses].sort().join("、"),
    }))
    .sort((a, b) => Number(b.allMissing) - Number(a.allMissing) || b.missingWarehouses - a.missingWarehouses || a.lingxingSku.localeCompare(b.lingxingSku));
}
