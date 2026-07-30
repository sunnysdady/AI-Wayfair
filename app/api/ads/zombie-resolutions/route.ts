import { upsertOperation } from "@/lib/operation-ledger.mjs";
import { sameOrigin } from "@/lib/http-origin.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { validateZombieResolution } from "@/lib/zombie-resolutions.mjs";

async function ensureTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ad_zombie_resolutions (
    resolution_key TEXT PRIMARY KEY NOT NULL,
    operation_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    listing TEXT NOT NULL,
    action_type TEXT NOT NULL,
    method TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '待分派',
    status TEXT NOT NULL DEFAULT 'DISCOVERED',
    execution_result TEXT,
    evidence TEXT,
    acceptance_criteria TEXT NOT NULL,
    accepted_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
}

export async function GET() {
  try {
    const env = await getRuntimeBindings();
    await ensureTable(env.DB);
    const rows = await env.DB.prepare(`SELECT
      resolution_key AS "resolutionKey",operation_id AS "operationId",
      campaign_id AS "campaignId",listing,action_type AS "actionType",method,
      owner,status,execution_result AS "executionResult",evidence,
      acceptance_criteria AS "acceptanceCriteria",accepted_by AS "acceptedBy",
      created_at AS "createdAt",updated_at AS "updatedAt"
      FROM ad_zombie_resolutions ORDER BY updated_at DESC`).all();
    return Response.json({ records: rows.results || [] }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Zombie 处置读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
    const env = await getRuntimeBindings();
    await ensureTable(env.DB);
    const record = validateZombieResolution(await request.json());
    const operationStatus = record.status;
    const now = new Date().toISOString();
    await upsertOperation(env.DB, {
      operationId: record.operationId,
      sourceType: "ZOMBIE_DIAGNOSIS",
      sourceId: record.resolutionKey,
      objectType: "CAMPAIGN_LISTING",
      objectId: `${record.campaignId}:${record.listing}`,
      title: `${record.listing} · ${record.method}`,
      owner: record.owner,
      status: operationStatus,
      proposedAction: record.method,
      beforeState: { campaignId: record.campaignId, listing: record.listing, actionType: record.actionType },
      intendedAfterState: { method: record.method },
      executionResult: record.executionResult,
      evidence: record.evidence,
      acceptanceCriteria: record.acceptanceCriteria,
      acceptedBy: record.acceptedBy,
    }, "ZOMBIE_RESOLUTION_UPDATED");
    await env.DB.prepare(`INSERT INTO ad_zombie_resolutions(
      resolution_key,operation_id,campaign_id,listing,action_type,method,owner,status,
      execution_result,evidence,acceptance_criteria,accepted_by,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(resolution_key) DO UPDATE SET
      operation_id=excluded.operation_id,campaign_id=excluded.campaign_id,
      listing=excluded.listing,action_type=excluded.action_type,method=excluded.method,
      owner=excluded.owner,status=excluded.status,execution_result=excluded.execution_result,
      evidence=excluded.evidence,acceptance_criteria=excluded.acceptance_criteria,
      accepted_by=excluded.accepted_by,updated_at=excluded.updated_at`)
      .bind(
        record.resolutionKey, record.operationId, record.campaignId, record.listing,
        record.actionType, record.method, record.owner, record.status,
        record.executionResult || null, record.evidence || null,
        record.acceptanceCriteria, record.acceptedBy || null, now, now,
      ).run();
    return Response.json({ record: { ...record, updatedAt: now } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Zombie 处置保存失败" }, { status: 400 });
  }
}
