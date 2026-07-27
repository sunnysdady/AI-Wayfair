import { buildCampaignUpdates } from "@/lib/ad-action-queue.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { buildOperatingReadiness } from "@/lib/operating-safety.mjs";

const ALLOWED_ACTIONS = new Set(["SET_LISTING_BID", "SET_LISTING_ACTIVE", "INCREASE_DAILY_CAP", "PAUSE_CAMPAIGN", "CHECK_LISTING_ELIGIBILITY", "CHECK_LOW_DELIVERY"]);
const API_ACTIONS = new Set(["SET_LISTING_BID", "SET_LISTING_ACTIVE"]);

const bindings = getRuntimeBindings;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function ensureActionQueue(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_action_queue (id TEXT PRIMARY KEY NOT NULL, run_key TEXT NOT NULL, listing TEXT NOT NULL, campaign_id TEXT NOT NULL, action_type TEXT NOT NULL, before_payload TEXT NOT NULL, proposed_payload TEXT NOT NULL, status TEXT DEFAULT 'PLANNED' NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS ad_action_queue_run_idx ON ad_action_queue(run_key)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_action_events (id TEXT PRIMARY KEY NOT NULL, action_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS ad_action_events_action_idx ON ad_action_events(action_id)").run();
}

export async function GET(request: Request) {
  try {
    const env = await bindings();
    await ensureActionQueue(env.DB);
    const url = new URL(request.url);
    const runKey = url.searchParams.get("runKey");
    const resultJoin = `SELECT q.*,e.event_type AS result_event_type,e.payload AS result_payload,e.created_at AS result_at
      FROM ad_action_queue q
      LEFT JOIN ad_action_events e ON e.id=(
        SELECT e2.id FROM ad_action_events e2
        WHERE e2.action_id=q.id AND e2.event_type IN ('VALIDATED','EXECUTED','FAILED')
        ORDER BY e2.created_at DESC LIMIT 1
      )`;
    const query = runKey
      ? env.DB.prepare(`${resultJoin} WHERE q.run_key=? ORDER BY q.created_at DESC`).bind(runKey)
      : env.DB.prepare(`${resultJoin} ORDER BY q.created_at DESC LIMIT 100`);
    const rows = await query.all();
    const readiness = buildOperatingReadiness(env);
    return Response.json({ actions: rows.results || [], liveEnabled: readiness.live.ads.allowed, liveBlockers: readiness.live.ads.blockers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "执行单读取失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
    const env = await bindings();
    await ensureActionQueue(env.DB);
    const body = await request.json() as { id?: string; status?: string };
    if (!body.id || body.status !== "APPROVED") return Response.json({ error: "只能将待确认或执行失败的动作审批为 APPROVED" }, { status: 400 });
    const existing = await env.DB.prepare("SELECT * FROM ad_action_queue WHERE id=?").bind(body.id).first<{id:string;campaign_id:string;listing:string;action_type:string;before_payload:string;proposed_payload:string;status:string}>();
    if (!existing) return Response.json({ error: "执行项不存在" }, { status: 404 });
    if (!["PLANNED", "FAILED"].includes(existing.status)) return Response.json({ error: `当前状态 ${existing.status} 不能重新确认` }, { status: 409 });
    if (!API_ACTIONS.has(existing.action_type)) return Response.json({ error: "该动作不在 Advertising API 写入范围，需在 Partner Home 人工处理" }, { status: 409 });
    try { buildCampaignUpdates([{ ...existing, status: "APPROVED" }]); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "执行载荷无效" }, { status: 400 }); }
    const now = new Date().toISOString();
    const retrying = existing.status === "FAILED";
    await env.DB.batch([
      env.DB.prepare("UPDATE ad_action_queue SET status='APPROVED',updated_at=? WHERE id=?").bind(now, body.id),
      env.DB.prepare("INSERT INTO ad_action_events(id,action_id,event_type,payload,created_at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), body.id, retrying ? "RETRY_APPROVED" : "APPROVED", JSON.stringify({ previousStatus: existing.status }), now),
    ]);
    return Response.json({ id: body.id, status: "APPROVED", message: retrying ? "失败项已恢复，请重新执行 API Dry-run 预检。" : "已确认进入 API 预检。" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "执行项确认失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
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
    if (!/^weekly:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(body.runKey) || !/^\d+$/.test(body.campaignId) || body.listing.length > 100) return Response.json({ error: "执行批次、Campaign 或 Listing 格式无效" }, { status: 400 });
    const decision = await env.DB.prepare("SELECT payload FROM ad_decision_runs WHERE run_key=?").bind(body.runKey).first<{ payload: string }>();
    if (!decision) return Response.json({ error: "决策批次不存在，不能绕过运营辩论 Gate" }, { status: 409 });
    let proposedBySystem: {
      action?: { type?: string; before?: Record<string, unknown>; proposed?: Record<string, unknown> };
      operatorReview?: { verdict?: string; requiresHumanApproval?: boolean; singleVariable?: boolean; [key: string]: unknown };
    } | undefined;
    try {
      const payload = JSON.parse(decision.payload) as { listings?: Array<Record<string, unknown>>; liveSafetyFindings?: Array<Record<string, unknown>> };
      proposedBySystem = [...(payload.liveSafetyFindings || []), ...(payload.listings || [])].find((item) =>
        String(item.listing) === body.listing && String(item.campaignId) === body.campaignId,
      ) as typeof proposedBySystem;
    } catch {
      return Response.json({ error: "决策批次损坏，不能进入执行单" }, { status: 409 });
    }
    if (!proposedBySystem || proposedBySystem.action?.type !== body.actionType || proposedBySystem.operatorReview?.verdict !== "CANDIDATE" || proposedBySystem.operatorReview?.requiresHumanApproval !== true) {
      return Response.json({ error: "运营 Agent 辩论未形成候选动作，禁止加入执行单" }, { status: 409 });
    }
    if (proposedBySystem.operatorReview.singleVariable !== true) {
      return Response.json({ error: "动作未通过单一变量 Gate" }, { status: 409 });
    }
    if (JSON.stringify(proposedBySystem.action.before || {}) !== JSON.stringify(body.before || {}) || JSON.stringify(proposedBySystem.action.proposed || {}) !== JSON.stringify(body.proposed || {})) {
      return Response.json({ error: "执行载荷与运营辩论后的候选方案不一致" }, { status: 409 });
    }
    const id = `${body.runKey}:${body.campaignId}:${body.listing}:${body.actionType}`;
    const now = new Date().toISOString();
    const existing = await env.DB.prepare("SELECT status FROM ad_action_queue WHERE id=?").bind(id).first<{status:string}>();
    if (existing && !["PLANNED", "FAILED"].includes(existing.status)) return Response.json({ error: `执行项已进入 ${existing.status}，不能被重置` }, { status: 409 });
    const mutation = await env.DB.prepare("SELECT id,action_type,status FROM ad_action_queue WHERE campaign_id=? AND listing=? AND status IN ('PLANNED','APPROVED','VALIDATED','EXECUTING') AND id<>? LIMIT 1").bind(body.campaignId, body.listing, id).first<{ id: string; action_type: string; status: string }>();
    if (mutation) return Response.json({ error: `该 Campaign × Listing 已有 ${mutation.action_type} 处于 ${mutation.status}，单一变量锁禁止叠加动作` }, { status: 409 });
    if (API_ACTIONS.has(body.actionType)) {
      try { buildCampaignUpdates([{ id, campaign_id: body.campaignId, listing: body.listing, action_type: body.actionType, before_payload: body.before || {}, proposed_payload: body.proposed || {}, status: "APPROVED" }]); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "执行载荷无效" }, { status: 400 }); }
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ad_action_queue(id,run_key,listing,campaign_id,action_type,before_payload,proposed_payload,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET before_payload=excluded.before_payload,proposed_payload=excluded.proposed_payload,status='PLANNED',updated_at=excluded.updated_at`)
        .bind(id, body.runKey, body.listing, body.campaignId, body.actionType, JSON.stringify(body.before || {}), JSON.stringify(body.proposed || {}), "PLANNED", now, now),
      env.DB.prepare("INSERT INTO ad_action_events(id,action_id,event_type,payload,created_at) VALUES(?,?,?,?,?)")
        .bind(crypto.randomUUID(), id, "OPERATOR_DEBATE_ACCEPTED", JSON.stringify(proposedBySystem.operatorReview), now),
    ]);
    return Response.json({ id, status: "PLANNED", message: "已加入本周执行单；生产写入仍需人工确认。" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "执行单保存失败" }, { status: 500 });
  }
}


export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
    const env = await bindings();
    await ensureActionQueue(env.DB);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "缺少执行单 id" }, { status: 400 });
    const existing = await env.DB.prepare("SELECT status FROM ad_action_queue WHERE id=?").bind(id).first<{status:string}>();
    if (!existing) return Response.json({ error: "执行项不存在" }, { status: 404 });
    if (!["PLANNED", "FAILED"].includes(existing.status)) return Response.json({ error: `当前状态 ${existing.status} 不允许删除` }, { status: 409 });
    await env.DB.prepare("DELETE FROM ad_action_events WHERE action_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM ad_action_queue WHERE id=?").bind(id).run();
    return Response.json({ ok: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "执行单删除失败" }, { status: 500 });
  }
}
