import ExcelJS from "exceljs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const bindings = getRuntimeBindings;

type Detail = { supplierPartNumber: string; supplierId: number; lingxingSku: string; warehouse: string; reason: string };

// 导出最新库存快照里"领星没有记录、被补 0"的商品×仓库组合，供运营核对是否误清零。
export async function GET() {
  try {
    const env = await bindings();
    const row = await env.DB.prepare("SELECT id,summary,created_at FROM inventory_snapshots ORDER BY created_at DESC LIMIT 1").first<{ id: string; summary: string; created_at: string }>();
    if (!row) return Response.json({ error: "尚无库存快照" }, { status: 404 });
    const summary = JSON.parse(row.summary);
    const details: Detail[] | undefined = summary.missingDetails;
    if (!Array.isArray(details)) {
      return Response.json({ error: "当前快照没有未匹配明细，请先点“从领星刷新”生成新快照" }, { status: 404 });
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("未匹配组合");
    sheet.columns = [
      { header: "Wayfair 商品编号", key: "supplierPartNumber", width: 24 },
      { header: "Wayfair 供应商ID", key: "supplierId", width: 16 },
      { header: "领星 SKU", key: "lingxingSku", width: 24 },
      { header: "领星仓库", key: "warehouse", width: 28 },
      { header: "原因", key: "reason", width: 30 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const item of details) sheet.addRow(item);
    const buffer = await workbook.xlsx.writeBuffer();
    const stamp = row.created_at.slice(0, 16).replace(/[-:T]/g, "");
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="inventory-unmatched-${stamp}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "未匹配明细导出失败" }, { status: 500 });
  }
}
