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
 *   livePartNumbers?:string[]; // Wayfair Catalog 实时在售清单，优先于 activePartNumbers
 *   skuMappings:Array<{supplierPartNumber:string;lingxingSku:string}>; // Pipe-delimited values are summed.
 *   warehouseMappings:Array<{supplierId:number;warehouse:string;splitBufferRate?:number}>; // Pipe-delimited warehouses are merged into one Wayfair ID.
 * }} config
 */
function splitWarehouseNames(value) {
  return String(value ?? "").split("|").map((name) => name.trim()).filter(Boolean);
}

/**
 * 合并仓的可售量规则：
 * - 各成员仓、各别名 SKU 的可用量相加；在途量直接相加。
 * - 只有当同一商品的库存分散在 ≥2 个成员仓时才有"一单拆不开"的风险，此时按 splitBufferRate 向下取整留余量；
 *   库存只在一个仓时按实数上报，不打折。
 */
export function mergedAvailable(sources, splitBufferRate = 0) {
  const total = sources.reduce((sum, source) => sum + source.available, 0);
  const warehousesWithStock = new Set(sources.filter((source) => source.available > 0).map((source) => source.warehouse));
  if (warehousesWithStock.size < 2 || !splitBufferRate) return { total, reported: total };
  return { total, reported: Math.floor(total * (1 - splitBufferRate)) };
}

export function buildCompleteInventoryRows(stockRows, config) {
  // livePartNumbers（Wayfair Catalog 实时在售）优先；没有则回退到配置里写死的清单。
  const activeParts = (config.livePartNumbers?.length ? config.livePartNumbers : config.activePartNumbers).map((part) => String(part).trim());
  if (activeParts.some((part) => !part)) throw new Error("有效商品编号不能为空");
  if (new Set(activeParts).size !== activeParts.length) throw new Error("有效商品编号存在重复");

  const supplierIds = config.warehouseMappings.map((item) => item.supplierId);
  if (new Set(supplierIds).size !== supplierIds.length) {
    throw new Error("仓库映射存在重复或歧义");
  }

  // 一个领星仓只能归属一个 Wayfair 仓 ID，否则同一批货会被重复上报（曾出现 360344/360346 同指亚特兰大2仓）。
  const supplierByWarehouse = new Map();
  for (const mapping of config.warehouseMappings) {
    const names = splitWarehouseNames(mapping.warehouse);
    if (new Set(names).size !== names.length) throw new Error(`仓库映射存在重复：${mapping.supplierId} 内重复列出同一领星仓`);
    for (const name of names) {
      const owner = supplierByWarehouse.get(name);
      if (owner !== undefined) throw new Error(`仓库映射存在重复：领星仓「${name}」同时归属 ${owner} 和 ${mapping.supplierId}`);
      supplierByWarehouse.set(name, mapping.supplierId);
    }
    const rate = mapping.splitBufferRate ?? 0;
    if (!(rate >= 0 && rate < 1)) throw new Error(`仓库映射 ${mapping.supplierId} 的 splitBufferRate 必须在 [0,1) 之间`);
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
    if (!lingxingSkus.length) {
      // 没有领星 SKU 映射 = 库存未知，不能当成 0 推给 Wayfair；只报警，不生成推送行。
      unmappedActiveParts.push(supplierPartNumber);
      for (const warehouse of config.warehouseMappings) {
        missingDetails.push({
          supplierPartNumber,
          supplierId: warehouse.supplierId,
          lingxingSku: "",
          warehouse: String(warehouse.warehouse ?? "").trim(),
          reason: "商品未映射领星 SKU（未推送，保持 Wayfair 现状）",
        });
      }
      continue;
    }

    for (const warehouse of config.warehouseMappings) {
      const warehouseNames = [...new Set(splitWarehouseNames(warehouse.warehouse))];
      const sources = lingxingSkus.flatMap((lingxingSku) => warehouseNames
        .map((warehouseName) => stockByKey.get(`${lingxingSku}\u0000${warehouseName}`))
        .filter(Boolean));
      const expectedPairs = lingxingSkus.length * warehouseNames.length;
      missingCombinations += expectedPairs - sources.length;
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

      const merged = mergedAvailable(sources, warehouse.splitBufferRate);
      const normalizedSource = {
        rowNumber: sources[0]?.rowNumber ?? 0,
        lingxingSku: lingxingSkus.join("|"),
        warehouse: warehouseNames.join("|") || warehouse.warehouse,
        productName: [...new Set(sources.map((source) => source.productName).filter(Boolean))].join(" | "),
        available: merged.total,
        reportedAvailable: merged.reported,
        locked: sources.reduce((sum, source) => sum + source.locked, 0),
        incoming: sources.reduce((sum, source) => sum + source.incoming, 0),
        transferInTransit: sources.reduce((sum, source) => sum + source.transferInTransit, 0),
      };
      rows.push({
        item: {
          discontinued: false,
          supplierPartNumber,
          quantityOnHand: normalizedSource.reportedAvailable,
          quantityOnOrder: normalizedSource.incoming,
          supplierId: warehouse.supplierId,
          quantityBackordered: 0,
        },
        source: normalizedSource,
      });
    }
  }

  // 商品级口径：按商品汇总全部仓库，避免"商品×仓库"行数把零库存占比放大。
  const totalByPart = new Map();
  for (const { item } of rows) {
    totalByPart.set(item.supplierPartNumber, (totalByPart.get(item.supplierPartNumber) ?? 0) + item.quantityOnHand);
  }
  const zeroParts = [...totalByPart].filter(([, qty]) => qty === 0).map(([part]) => part);
  const partStats = {
    activeParts: activeParts.length,
    pushedParts: totalByPart.size,
    zeroParts: zeroParts.length,
    zeroPartRatio: totalByPart.size ? zeroParts.length / totalByPart.size : 0,
    zeroPartNumbers: zeroParts,
  };

  return { rows, missingCombinations, missingDetails, unmappedActiveParts, partStats };
}
