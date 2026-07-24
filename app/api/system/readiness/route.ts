import { METRIC_DEFINITIONS } from "@/lib/metric-definitions.mjs";
import { buildOperatingReadiness } from "@/lib/operating-safety.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

export async function GET() {
  const readiness = buildOperatingReadiness(await getRuntimeBindings());
  return Response.json({ ...readiness, metrics: METRIC_DEFINITIONS }, {
    headers: { "cache-control": "no-store" },
  });
}
