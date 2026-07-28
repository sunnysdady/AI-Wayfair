import { listOperations, upsertOperation } from "@/lib/operation-ledger.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

// upsertOperation appends every state change to operation_events.
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(request: Request) {
  try {
    const env = await getRuntimeBindings();
    const url = new URL(request.url);
    const records = await listOperations(env.DB, {
      status: url.searchParams.get("status") || "",
      objectId: url.searchParams.get("objectId") || "",
      limit: Number(url.searchParams.get("limit") || 200),
    });
    return Response.json({ records }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "闭环任务读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
    const env = await getRuntimeBindings();
    const operation = await upsertOperation(env.DB, await request.json(), "MANUAL_UPDATE");
    return Response.json({ operation });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "闭环任务保存失败" }, { status: 400 });
  }
}
