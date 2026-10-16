import { cachedAdSpend } from "../../../../lib/wayfair-ads";
import { buildExtendedView } from "@/lib/ads-keyword-rank-service.mjs";
import { refreshAllowed } from "@/lib/ads-refresh-guard.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

export const dynamic = "force-dynamic";

// Read-only advisory view. `refresh=1` pulls the report from Wayfair (create/poll/download
// only) and is a no-op unless ADS_EXTENDED_REPORTS_ENABLED=true. No bid or budget is ever written.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const refresh = url.searchParams.get("refresh") === "1";
    // A refresh triggers outbound Wayfair calls: cross-origin / cross-site (Origin or Sec-Fetch-Site) browser callers are refused (internal sync sends no Origin).
    if (refresh && !refreshAllowed(request)) {
      return Response.json({ error: "刷新请求来源无效" }, { status: 403 });
    }
    const data = await buildExtendedView({
      env: await getRuntimeBindings(),
      kind: "keywords",
      start: url.searchParams.get("start") || undefined,
      end: url.searchParams.get("end") || undefined,
      days: url.searchParams.get("days") || undefined,
      refresh,
      adSpendFn: cachedAdSpend,
    });
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "广告报表读取失败" }, { status: 500 });
  }
}
