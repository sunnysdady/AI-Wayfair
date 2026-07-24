import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = await getRuntimeBindings();
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (Number(result?.ok) !== 1) throw new Error("database check failed");
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
