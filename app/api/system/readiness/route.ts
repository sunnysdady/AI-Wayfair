import { METRIC_DEFINITIONS } from "@/lib/metric-definitions.mjs";
import { buildOperatingReadiness } from "@/lib/operating-safety.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { buildWayfairScopeHealth } from "@/lib/wayfair-scope-health.mjs";

export async function GET() {
  const env = await getRuntimeBindings();
  const readiness = buildOperatingReadiness(env);
  let syncStates: { key: string; value: string; updated_at: string }[] = [];
  try {
    const rows = await env.DB.prepare(
      `SELECT key,value,updated_at FROM sync_state
       WHERE key IN ('orders','server:catalog:crawl','product-management:v1:last-run')
          OR key LIKE 'ads-analysis:%'
          OR key LIKE 'ads-action:%'
          OR key LIKE 'inventory:push:%'
       ORDER BY updated_at DESC
       LIMIT 100`,
    ).all<{ key: string; value: string; updated_at: string }>();
    syncStates = rows.results || [];
  } catch {
    // A missing database/table is represented as unverified evidence, not readiness.
  }
  try {
    const latestAdAction = await env.DB.prepare(
      `SELECT event_type,created_at FROM ad_action_events
       WHERE event_type IN ('EXECUTED','FAILED')
       ORDER BY created_at DESC LIMIT 1`,
    ).first<{ event_type: string; created_at: string }>();
    if (latestAdAction) {
      syncStates.push({
        key: "ads-action:latest",
        value: JSON.stringify({
          status: latestAdAction.event_type === "EXECUTED" ? "complete" : "failed",
          error: latestAdAction.event_type === "FAILED" ? "最近一次广告写入失败" : undefined,
        }),
        updated_at: latestAdAction.created_at,
      });
    }
  } catch {
    // No write event means the write scope remains unverified.
  }
  try {
    const latestInventoryPush = await env.DB.prepare(
      `SELECT status,updated_at FROM inventory_push_runs
       WHERE id NOT LIKE 'dryrun-%'
       ORDER BY updated_at DESC LIMIT 1`,
    ).first<{ status: string; updated_at: string }>();
    if (latestInventoryPush) {
      syncStates.push({
        key: "inventory:push:latest",
        value: JSON.stringify({
          status: latestInventoryPush.status === "completed"
            ? "complete"
            : latestInventoryPush.status,
          error: latestInventoryPush.status === "failed"
            ? "最近一次库存写入失败"
            : undefined,
        }),
        updated_at: latestInventoryPush.updated_at,
      });
    }
  } catch {
    // No live inventory receipt means the write scope remains unverified.
  }
  const scopeHealth = buildWayfairScopeHealth({ syncStates });
  return Response.json({ ...readiness, scopeHealth, metrics: METRIC_DEFINITIONS }, {
    headers: { "cache-control": "no-store" },
  });
}
