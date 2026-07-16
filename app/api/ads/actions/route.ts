const ALLOWED_ACTIONS = new Set(["SET_LISTING_BID", "SET_LISTING_ACTIVE", "INCREASE_DAILY_CAP"]);

async function bindings() { return (await import("cloudflare:workers")).env; }

async function ensureActionQueue(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_action_queue (id TEXT PRIMARY KEY NOT NULL, run_key TEXT NOT NULL, listing TEXT NOT NULL, campaign_id TEXT NOT NULL, action_type TEXT NOT NULL, before_payload TEXT NOT NULL, proposed_payload TEXT NOT NULL, status TEXT DEFAULT 'PLANNED' NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS ad_action_queue_run_idx ON ad_action_queue(run_key)").run();
}

export async function GET(request: Request) {
  try {
    const env = await bindings();
    await ensureActionQueue(env.DB);
    const url = new URL(request.url);
    const runKey = url.searchParams.get("runKey");
    const query = runKey
      ? env.DB.prepare("SELECT * FROM ad_action_queue WHERE run_key=? ORDER BY created_at DESC").bind(runKey)
      : env.DB.prepare("SELECT * FROM ad_action_queue ORDER BY created_at DESC LIMIT 100");
    const rows = await query.all();
    return Response.json({ actions: rows.results || [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "执行单读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const env = await bindings();
    await ensureActionQueue(env.DB);
    const body = await request.json() as {
      runKey?: string;
      listing?: string;
      campaignId?: string;
      actionType?: string;
      before?: Record<string, unknown>;
      proposed?: Record<string, unknown>;
    };
    if (!body.runKey || !body.listing || !body.campaignId || !body.actionType || !ALLOWED_ACTIONS.has(body.actionType)) {
      return Response.json({ error: "执行单参数不完整或动作类型不允许" }, { status: 400 });
    }
    const id = `${body.runKey}:${body.campaignId}:${body.listing}:${body.actionType}`;
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO ad_action_queue(id,run_key,listing,campaign_id,action_type,before_payload,proposed_payload,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET before_payload=excluded.before_payload,proposed_payload=excluded.proposed_payload,status='PLANNED',updated_at=excluded.updated_at`)
      .bind(id, body.runKey, body.listing, body.campaignId, body.actionType, JSON.stringify(body.before || {}), JSON.stringify(body.proposed || {}), "PLANNED", now, now).run();
    return Response.json({ id, status: "PLANNED", message: "已加入本周执行单；生产写入仍需人工确认。" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "执行单保存失败" }, { status: 500 });
  }
}


export async function DELETE(request: Request) {
  try {
    const env = await bindings();
    await ensureActionQueue(env.DB);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "缺少执行单 id" }, { status: 400 });
    await env.DB.prepare("DELETE FROM ad_action_queue WHERE id=?").bind(id).run();
    return Response.json({ ok: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "执行单删除失败" }, { status: 500 });
  }
}
