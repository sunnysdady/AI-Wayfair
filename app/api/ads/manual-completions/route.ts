import { validateManualCompletion } from "@/lib/manual-ad-completions.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function ensureTables(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ad_manual_completions (
    task_key TEXT PRIMARY KEY NOT NULL,
    parent_sku TEXT NOT NULL,
    task_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL DEFAULT '',
    ad_group TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '运营负责人',
    assignee TEXT NOT NULL DEFAULT '广告 Agent',
    execution_channel TEXT NOT NULL DEFAULT 'Wayfair Partner Home',
    execution_result TEXT NOT NULL DEFAULT '',
    wayfair_evidence TEXT NOT NULL DEFAULT '',
    receiver TEXT NOT NULL DEFAULT '',
    review_date TEXT NOT NULL DEFAULT '',
    closed_loop_status TEXT NOT NULL DEFAULT 'ASSIGNED',
    status TEXT NOT NULL DEFAULT 'OPEN',
    completed_at TEXT,
    updated_at TEXT NOT NULL
  )`).run();
  await Promise.all([
    "ALTER TABLE ad_manual_completions ADD COLUMN owner TEXT NOT NULL DEFAULT '运营负责人'",
    "ALTER TABLE ad_manual_completions ADD COLUMN assignee TEXT NOT NULL DEFAULT '广告 Agent'",
    "ALTER TABLE ad_manual_completions ADD COLUMN execution_channel TEXT NOT NULL DEFAULT 'Wayfair Partner Home'",
    "ALTER TABLE ad_manual_completions ADD COLUMN execution_result TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE ad_manual_completions ADD COLUMN wayfair_evidence TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE ad_manual_completions ADD COLUMN receiver TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE ad_manual_completions ADD COLUMN review_date TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE ad_manual_completions ADD COLUMN closed_loop_status TEXT NOT NULL DEFAULT 'ASSIGNED'",
  ].map(async (sql) => {
    try {
      await db.prepare(sql).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column|already exists|exists/i.test(message)) throw error;
    }
  }));
  await db.prepare(`CREATE TABLE IF NOT EXISTS ad_manual_completion_events (
    id TEXT PRIMARY KEY NOT NULL,
    task_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS ad_manual_completion_events_task_idx ON ad_manual_completion_events(task_key)").run();
}

export async function GET() {
  try {
    const env = await getRuntimeBindings();
    await ensureTables(env.DB);
    const rows = await env.DB.prepare(`SELECT
      task_key AS "taskKey",
      parent_sku AS "parentSku",
      task_id AS "taskId",
      campaign_id AS "campaignId",
      ad_group AS "adGroup",
      title,
      owner,
      assignee,
      execution_channel AS "executionChannel",
      execution_result AS "executionResult",
      wayfair_evidence AS "wayfairEvidence",
      receiver,
      review_date AS "reviewDate",
      closed_loop_status AS "closedLoopStatus",
      status,
      completed_at AS "completedAt",
      updated_at AS "updatedAt"
      FROM ad_manual_completions ORDER BY updated_at DESC`).all();
    return Response.json({ records: rows.results || [] }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "手动执行记录读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
    const env = await getRuntimeBindings();
    await ensureTables(env.DB);
    const record = validateManualCompletion(await request.json());
    const now = new Date().toISOString();
    const completedAt = record.status === "COMPLETED" ? now : null;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ad_manual_completions(
        task_key,parent_sku,task_id,campaign_id,ad_group,title,owner,assignee,execution_channel,execution_result,wayfair_evidence,receiver,review_date,closed_loop_status,status,completed_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(task_key) DO UPDATE SET
        parent_sku=excluded.parent_sku,
        task_id=excluded.task_id,
        campaign_id=excluded.campaign_id,
        ad_group=excluded.ad_group,
        title=excluded.title,
        owner=excluded.owner,
        assignee=excluded.assignee,
        execution_channel=excluded.execution_channel,
        execution_result=excluded.execution_result,
        wayfair_evidence=excluded.wayfair_evidence,
        receiver=excluded.receiver,
        review_date=excluded.review_date,
        closed_loop_status=excluded.closed_loop_status,
        status=excluded.status,
        completed_at=excluded.completed_at,
        updated_at=excluded.updated_at`)
        .bind(record.taskKey, record.parentSku, record.taskId, record.campaignId, record.adGroup, record.title, record.owner, record.assignee, record.executionChannel, record.executionResult, record.wayfairEvidence, record.receiver, record.reviewDate, record.closedLoopStatus, record.status, completedAt, now),
      env.DB.prepare("INSERT INTO ad_manual_completion_events(id,task_key,event_type,payload,created_at) VALUES(?,?,?,?,?)")
        .bind(crypto.randomUUID(), record.taskKey, record.status === "COMPLETED" ? "CLOSED_LOOP_RECORDED" : "REOPENED", JSON.stringify(record), now),
    ]);
    return Response.json({ record: { ...record, completedAt, updatedAt: now } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "手动执行记录保存失败" }, { status: 400 });
  }
}
