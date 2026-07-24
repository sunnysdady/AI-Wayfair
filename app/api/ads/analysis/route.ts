import { getAdvertisingAnalysis } from "../../../../lib/wayfair-ads";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const bindings = getRuntimeBindings;

function date(value: string | null, name: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error(`${name} 必须是 YYYY-MM-DD`);
  return value;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const start = date(url.searchParams.get("start"), "start");
    const end = date(url.searchParams.get("end"), "end");
    if (start > end) return Response.json({ error: "开始日期不能晚于结束日期" }, { status: 400 });
    const data = await getAdvertisingAnalysis(await bindings(), start, end, url.searchParams.get("refresh") === "1");
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "广告分析失败" }, { status: 500 });
  }
}
