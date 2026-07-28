import { validateManualCompletion } from "@/lib/manual-ad-completions.mjs";
import { upsertOperation } from "@/lib/operation-ledger.mjs";
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
    status TEXT NOT NULL DEFAULT 'OPEN',
    operation_id TEXT,
    owner TEXT NOT NULL DEFAULT '待分派',
    execution_result TEXT,
    evidence TEXT,
    acceptance_criteria TEXT,
    accepted_by TEXT,
    review_due_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  )`).run();
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
      status,
      operation_id AS "operationId",
      owner,
      execution_result AS "executionResult",
      evidence,
      acceptance_criteria AS "acceptanceCriteria",
      accepted_by AS "acceptedBy",
      review_due_at AS "reviewDueAt",
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
    const operationStatus = {
      OPEN: "DISCOVERED",
      IN_PROGRESS: "EXECUTING",
      PENDING_ACCEPTANCE: "PENDING_ACCEPTANCE",
      VERIFIED: "VERIFIED",
      REOPENED: "REOPENED",
      FAILED: "FAILED",
    }[record.status] || "DISCOVERED";
    await upsertOperation(env.DB, {
      operationId: record.operationId,
      sourceType: "MANUAL_AD",
      sourceId: record.taskKey,
      objectType: "PARENT_SKU",
      objectId: record.parentSku,
      title: record.title || record.taskId,
      owner: record.owner,
      status: operationStatus,
      proposedAction: record.title || record.taskId,
      beforeState: { campaignId: record.campaignId, adGroup: record.adGroup },
      intendedAfterState: { acceptanceCriteria: record.acceptanceCriteria },
      executionResult: record.executionResult,
      evidence: record.evidence,
      acceptanceCriteria: record.acceptanceCriteria,
      acceptedBy: record.acceptedBy,
      reviewDueAt: record.reviewDueAt,
    }, "MANUAL_TASK_UPDATED");
    const completedAt = record.status === "VERIFIED" ? now : null;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ad_manual_completions(
        task_key,parent_sku,task_id,campaign_id,ad_group,title,status,operation_id,owner,
        execution_result,evidence,acceptance_criteria,accepted_by,review_due_at,completed_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(task_key) DO UPDATE SET
        parent_sku=excluded.parent_sku,
        task_id=excluded.task_id,
        campaign_id=excluded.campaign_id,
        ad_group=excluded.ad_group,
        title=excluded.title,
        status=excluded.status,
        operation_id=excluded.operation_id,
        owner=excluded.owner,
        execution_result=excluded.execution_result,
        evidence=excluded.evidence,
        acceptance_criteria=excluded.acceptance_criteria,
        accepted_by=excluded.accepted_by,
        review_due_at=excluded.review_due_at,
        completed_at=excluded.completed_at,
        updated_at=excluded.updated_at`)
        .bind(
          record.taskKey, record.parentSku, record.taskId, record.campaignId,
          record.adGroup, record.title, record.status, record.operationId, record.owner,
          record.executionResult || null, record.evidence || null,
          record.acceptanceCriteria, record.acceptedBy || null,
          record.reviewDueAt || null, completedAt, now,
        ),
      env.DB.prepare("INSERT INTO ad_manual_completion_events(id,task_key,event_type,payload,created_at) VALUES(?,?,?,?,?)")
        .bind(crypto.randomUUID(), record.taskKey, record.status, JSON.stringify(record), now),
    ]);
    return Response.json({ record: { ...record, completedAt, updatedAt: now } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "手动执行记录保存失败" }, { status: 400 });
  }
}
