import { createFulfillmentWorkbook, fulfillmentExportFileName } from "@/lib/fulfillment-downloads.mjs";
import { listFulfillmentRecordsForExport, parseFulfillmentFilters } from "@/lib/fulfillment-ledger.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

export async function GET(request: Request) {
  try {
    const env = await getRuntimeBindings();
    const url = new URL(request.url);
    const filters = parseFulfillmentFilters({
      start: url.searchParams.get("start") || undefined,
      end: url.searchParams.get("end") || undefined,
      status: url.searchParams.get("status") || undefined,
    });
    const records = await listFulfillmentRecordsForExport(env.DB, filters);
    return new Response(await createFulfillmentWorkbook(records), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fulfillmentExportFileName(filters))}`,
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: "订单导出失败，请检查筛选条件后重试" }, { status: 400 });
  }
}
