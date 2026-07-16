import { buildCampaignUpdates } from "@/lib/ad-action-queue.mjs";

type QueueRow = {
  id: string; run_key: string; listing: string; campaign_id: string; action_type: string;
  before_payload: string; proposed_payload: string; status: string;
};

async function bindings() { return (await import("cloudflare:workers")).env; }

async function ensureTables(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_action_queue (id TEXT PRIMARY KEY NOT NULL, run_key TEXT NOT NULL, listing TEXT NOT NULL, campaign_id TEXT NOT NULL, action_type TEXT NOT NULL, before_payload TEXT NOT NULL, proposed_payload TEXT NOT NULL, status TEXT DEFAULT 'PLANNED' NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_action_events (id TEXT PRIMARY KEY NOT NULL, action_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS ad_action_events_action_idx ON ad_action_events(action_id)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS ad_execution_locks (run_key TEXT PRIMARY KEY NOT NULL, acquired_at TEXT NOT NULL)").run();
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function token(env: Env) {
  if (!env.WAYFAIR_AD_CLIENT_ID || !env.WAYFAIR_AD_CLIENT_SECRET) throw new Error("Advertising API 凭证未配置");
  const response = await fetch("https://sso.auth.wayfair.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: env.WAYFAIR_AD_CLIENT_ID, client_secret: env.WAYFAIR_AD_CLIENT_SECRET, audience: "https://api.wayfair.io/" }),
  });
  if (!response.ok) throw new Error(`Wayfair OAuth 失败（HTTP ${response.status}）`);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Wayfair OAuth 响应缺少 access_token");
  return body.access_token;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function updateCampaign(accessToken: string, campaignId: string, listings: Record<string, { bid: string; isActive: boolean }>) {
  const payload = { campaignProductData: { listings } };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`https://api.wayfair.io/advertising/v1/campaign/${campaignId}`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (attempt < 2) { await wait(500 * (2 ** attempt)); continue; }
      throw new Error(`Wayfair Advertising API 网络失败：${error instanceof Error ? error.message : "连接中断"}`);
    }
    const body = await response.json().catch(() => ({})) as { message?: string; details?: string[] };
    if (response.ok) return body;
    if ((response.status === 429 || response.status >= 500) && attempt < 2) { await wait(500 * (2 ** attempt)); continue; }
    const details = body.details?.length ? `：${body.details.join("；")}` : "";
    throw new Error(`${body.message || "Wayfair Advertising API 执行失败"}${details}（HTTP ${response.status}）`);
  }
  throw new Error("Wayfair Advertising API 执行失败");
}

async function record(db: D1Database, actionIds: string[], eventType: string, payload: unknown, status: string) {
  const now = new Date().toISOString();
  for (const actionId of actionIds) {
    await db.batch([
      db.prepare("UPDATE ad_action_queue SET status=?,updated_at=? WHERE id=?").bind(status, now, actionId),
      db.prepare("INSERT INTO ad_action_events(id,action_id,event_type,payload,created_at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), actionId, eventType, JSON.stringify(payload), now),
    ]);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
    const env = await bindings();
    await ensureTables(env.DB);
    const staleExecution = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await env.DB.prepare("UPDATE ad_action_queue SET status='FAILED',updated_at=? WHERE status='EXECUTING' AND updated_at<?").bind(new Date().toISOString(), staleExecution).run();
    const body = await request.json() as { runKey?: string; dryRun?: boolean; confirmation?: string };
    if (!body.runKey || !/^weekly:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(body.runKey)) return Response.json({ error: "周执行批次格式无效" }, { status: 400 });
    const requiredStatus = body.dryRun === false ? "VALIDATED" : "APPROVED";
    const result = await env.DB.prepare("SELECT * FROM ad_action_queue WHERE run_key=? AND status=? AND action_type IN ('SET_LISTING_BID','SET_LISTING_ACTIVE') ORDER BY campaign_id,listing").bind(body.runKey, requiredStatus).all<QueueRow>();
    const actions = result.results || [];
    const campaigns = buildCampaignUpdates(actions);
    if (!campaigns.length) return Response.json({ error: requiredStatus === "APPROVED" ? "没有已确认、可预检的 Bid/启停动作" : "没有已通过预检的动作" }, { status: 409 });
    if (body.dryRun !== false) {
      for (const campaign of campaigns) await record(env.DB, campaign.actionIds, "VALIDATED", { campaignId: campaign.campaignId, listings: campaign.listings }, "VALIDATED");
      return Response.json({ mode: "dry-run", campaignCount: campaigns.length, actionCount: actions.length, campaigns, message: "API 载荷预检通过，尚未写入 Wayfair。" });
    }
    if (env.ALLOW_WAYFAIR_AD_LIVE_CHANGES !== "true") return Response.json({ error: "正式广告修改尚未在生产环境显式启用" }, { status: 403 });
    if (body.confirmation !== "执行广告修改") return Response.json({ error: "确认文字必须是“执行广告修改”" }, { status: 400 });
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await env.DB.prepare("DELETE FROM ad_execution_locks WHERE acquired_at<?").bind(staleBefore).run();
    try { await env.DB.prepare("INSERT INTO ad_execution_locks(run_key,acquired_at) VALUES(?,?)").bind(body.runKey, new Date().toISOString()).run(); }
    catch { return Response.json({ error: "该周执行批次正在处理，请勿重复提交" }, { status: 409 }); }
    const completed: string[] = [];
    const allActionIds = campaigns.flatMap((campaign) => campaign.actionIds);
    try {
      for (const actionId of allActionIds) await record(env.DB, [actionId], "EXECUTING", { runKey: body.runKey }, "EXECUTING");
      const accessToken = await token(env);
      for (const campaign of campaigns) {
        const response = await updateCampaign(accessToken, campaign.campaignId, campaign.listings);
        await record(env.DB, campaign.actionIds, "EXECUTED", { campaignId: campaign.campaignId, response }, "EXECUTED");
        completed.push(...campaign.actionIds);
      }
    } catch (error) {
      const pending = allActionIds.filter((id) => !completed.includes(id));
      if (pending.length) await record(env.DB, pending, "FAILED", { error: error instanceof Error ? error.message : "执行失败", completed: completed.length }, "FAILED");
      const detail = error instanceof Error ? error.message : "广告执行失败";
      return Response.json({ error: `${detail}；已成功 ${completed.length} 项，失败项已留痕` }, { status: 502 });
    } finally {
      await env.DB.prepare("DELETE FROM ad_execution_locks WHERE run_key=?").bind(body.runKey).run();
    }
    return Response.json({ mode: "live", campaignCount: campaigns.length, actionCount: completed.length, message: `已执行 ${completed.length} 项广告修改。` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "广告执行失败" }, { status: 500 });
  }
}
