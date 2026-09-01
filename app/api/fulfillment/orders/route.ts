import { FULFILLMENT_COLUMNS, listFulfillmentRecords, upsertFulfillmentRecord } from "@/lib/fulfillment-ledger.mjs";
import { sameOrigin } from "@/lib/http-origin.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

export async function GET(request: Request) {
  try {
    const env = await getRuntimeBindings();
    const limit = Number(new URL(request.url).searchParams.get("limit") || 500);
    const records = await listFulfillmentRecords(env.DB, { limit });
    return Response.json({ columns: FULFILLMENT_COLUMNS, records }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "履约订单读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
    const env = await getRuntimeBindings();
    const record = await upsertFulfillmentRecord(env.DB, await request.json());
    return Response.json({ record });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "履约订单保存失败" }, { status: 400 });
  }
}
