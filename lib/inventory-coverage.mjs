/**
 * 库存铺货覆盖度：按商品看有多少个实体仓有货。
 * 商品没铺到某个仓（该仓为 0）是正常现象；只有"有货的实体仓不足 minWarehouses 个"的商品才算覆盖不足。
 * 共用同一个实体仓的多个 supplierId（如两个 GA 供应商 ID）只算一个仓。
 *
 * @param {Array<{supplierPartNumber:string;supplierId:number;quantityOnHand:number}>} items
 * @param {Array<{supplierId:number;warehouse:string}>} warehouseMappings
 */
export const MIN_STOCKED_WAREHOUSES = 2;

export function partCoverage(items, warehouseMappings, minWarehouses = MIN_STOCKED_WAREHOUSES) {
  const warehouseBySupplier = new Map(warehouseMappings.map((item) => [item.supplierId, String(item.warehouse ?? "").trim()]));
  const stockedByPart = new Map();
  for (const item of items) {
    if (!stockedByPart.has(item.supplierPartNumber)) stockedByPart.set(item.supplierPartNumber, new Set());
    if (item.quantityOnHand > 0) stockedByPart.get(item.supplierPartNumber).add(warehouseBySupplier.get(item.supplierId) ?? `#${item.supplierId}`);
  }
  const thinPartNumbers = [...stockedByPart].filter(([, set]) => set.size < minWarehouses).map(([part]) => part);
  const zeroPartNumbers = [...stockedByPart].filter(([, set]) => set.size === 0).map(([part]) => part);
  const parts = stockedByPart.size;
  return {
    parts,
    minWarehouses,
    thinParts: thinPartNumbers.length,
    thinPartRatio: parts ? thinPartNumbers.length / parts : 0,
    thinPartNumbers,
    zeroParts: zeroPartNumbers.length,
  };
}
