import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { buildAdReviewDashboard } from "@/lib/ad-review-dashboard.mjs";

const bindings = getRuntimeBindings;

async function ensureTables(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_decision_runs (run_key TEXT PRIMARY KEY NOT NULL, decision_start TEXT NOT NULL, decision_end TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_action_queue (id TEXT PRIMARY KEY NOT NULL, run_key TEXT NOT NULL, listing TEXT NOT NULL, campaign_id TEXT NOT NULL, action_type TEXT NOT NULL, before_payload TEXT NOT NULL, proposed_payload TEXT NOT NULL, status TEXT DEFAULT 'PLANNED' NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_action_events (id TEXT PRIMARY KEY NOT NULL, action_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_weekly_reviews (action_id TEXT PRIMARY KEY NOT NULL, source_run_key TEXT NOT NULL, evaluation_run_key TEXT NOT NULL, listing TEXT NOT NULL, campaign_id TEXT NOT NULL, verdict TEXT NOT NULL, payload TEXT NOT NULL, evaluated_at TEXT NOT NULL)").run();
}

export async function GET() {
  try {
    const env = await bindings();
    await ensureTables(env.DB);
    const [runs, actions, reviews] = await Promise.all([
      env.DB.prepare("SELECT run_key,decision_start,decision_end,created_at FROM ad_decision_runs ORDER BY decision_end DESC LIMIT 12").all<{run_key:string;decision_start:string;decision_end:string;created_at:string}>(),
      env.DB.prepare(`SELECT q.id,q.run_key,q.listing,q.campaign_id,q.action_type,q.before_payload,q.proposed_payload,q.status,q.updated_at,
        e.event_type AS result_event_type,e.payload AS result_payload,e.created_at AS result_at
        FROM ad_action_queue q LEFT JOIN ad_action_events e ON e.id=(SELECT e2.id FROM ad_action_events e2 WHERE e2.action_id=q.id AND e2.event_type IN ('EXECUTED','FAILED') ORDER BY e2.created_at DESC LIMIT 1)
        WHERE q.action_type IN ('SET_LISTING_BID','SET_LISTING_ACTIVE')
        ORDER BY q.updated_at DESC LIMIT 200`).all(),
      env.DB.prepare("SELECT action_id,source_run_key,evaluation_run_key,listing,campaign_id,verdict,payload,evaluated_at FROM ad_weekly_reviews ORDER BY evaluated_at DESC LIMIT 200").all(),
    ]);
    const dashboard = buildAdReviewDashboard({ runs: runs.results || [], actions: actions.results || [], reviews: reviews.results || [] });
    return Response.json(dashboard, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "周度调整历史读取失败" }, { status: 500 });
  }
}
