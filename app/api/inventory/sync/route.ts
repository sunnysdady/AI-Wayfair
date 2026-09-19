import { buildInventoryFromStockRows, loadInventoryValueRisk, saveInventorySnapshot } from "@/lib/inventory";
import { lingxingCredentials, pullLingxingStockRows } from "@/lib/lingxing.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const bindings = getRuntimeBindings;

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
    const parsed = buildInventoryFromStockRows(pulled.stockRows, pulled.sourceFile);
    if (!parsed.canPush) {
      return Response.json({
        error: "领星库存映射后没有可推送记录",
        errors: parsed.errors.slice(0, 50),
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
