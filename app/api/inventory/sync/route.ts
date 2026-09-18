import mapping from "@/lib/inventory-mapping.json";
import { loadInventoryValueRisk, saveInventorySnapshot } from "@/lib/inventory";
import { buildCompleteInventoryRows } from "@/lib/inventory-plan.mjs";
import { lingxingCredentials, pullLingxingStockRows } from "@/lib/lingxing.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const bindings = getRuntimeBindings;

function finalizePulledStock(stockRows, sourceFile) {
  const planned = buildCompleteInventoryRows(stockRows, mapping);
  const rows = planned.rows;
  const items = rows.map((row) => row.item);
  const warnings = [];
  if (planned.missingCombinations) {
    warnings.push({ field: "映射", message: `${planned.missingCombinations}个有效商品×仓库组合在领星结果中没有记录，已按完整 TRUE_UP 补零` });
  }
  if (planned.unmappedActiveParts.length) {
    warnings.push({ field: "商品映射", message: `${planned.unmappedActiveParts.length}个 Wayfair 有效商品没有领星 SKU 映射，已在全部仓库保留为零库存` });
  }
  const zeroStockRows = items.filter((item) => item.quantityOnHand === 0).length;
  const mappedSkus = new Set(mapping.skuMappings.flatMap((item) => String(item.lingxingSku).split("|").map((sku) => sku.trim()).filter(Boolean)));
  const mappedWarehouses = new Set(mapping.warehouseMappings.flatMap((item) => String(item.warehouse).split("|").map((name) => name.trim()).filter(Boolean)));
  const summary = {
    totalRows: items.length,
    validRows: items.length,
    errorRows: 0,
    zeroStockRows,
    zeroStockRatio: items.length ? zeroStockRows / items.length : 0,
    totalQuantityOnHand: items.reduce((sum, item) => sum + item.quantityOnHand, 0),
    supplierCount: new Set(items.map((item) => item.supplierId)).size,
    skuMappings: mapping.activePartNumbers.length,
    warehouseMappings: mapping.warehouseMappings.length,
    stockRows: stockRows.length,
    missingCombinations: planned.missingCombinations,
    ignoredStockRows: stockRows.filter((row) => !mappedSkus.has(row.lingxingSku) || !mappedWarehouses.has(row.warehouse)).length,
  };
  return { items, rows, errors: [], warnings, summary, canPush: items.length > 0, sourceFile };
}

export async function GET() {
  try {
    const env = await bindings();
    const credentials = lingxingCredentials(env);
    return Response.json({
      configured: credentials.configured,
      baseUrl: credentials.baseUrl,
      source: credentials.configured ? "lingxing-api" : "xlsx-upload",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "领星配置读取失败" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const env = await bindings();
    const credentials = lingxingCredentials(env);
    if (!credentials.configured) {
      return Response.json({ error: "领星 API 未配置：请设置 LINGXING_APP_ID 与 LINGXING_APP_SECRET" }, { status: 503 });
    }
    const pulled = await pullLingxingStockRows(env);
    const parsed = finalizePulledStock(pulled.stockRows, pulled.sourceFile);
    if (!parsed.canPush) {
      return Response.json({
        error: "领星库存映射后没有可推送记录",
        warnings: parsed.warnings,
        summary: parsed.summary,
        warehouses: pulled.warehouses.length,
        inventoryRows: pulled.inventoryRows.length,
      }, { status: 422 });
    }
    const snapshot = await saveInventorySnapshot(env.DB, parsed);
    const valueRisk = await loadInventoryValueRisk(env.DB, snapshot.id);
    return Response.json({
      snapshotId: snapshot.id,
      createdAt: snapshot.createdAt,
      sourceFile: parsed.sourceFile,
      source: "lingxing-api",
      canPush: true,
      summary: parsed.summary,
      valueRisk,
      warnings: parsed.warnings,
      errors: [],
      warehouses: pulled.warehouses.length,
      inventoryRows: pulled.inventoryRows.length,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "领星库存拉取失败" }, { status: 502 });
  }
}
