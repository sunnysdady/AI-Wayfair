import { WAYFAIR_ADVERTISING_AUDIENCE, buildCampaignUpdates, executeCampaignUpdates } from "@/lib/ad-action-queue.mjs";

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
    body: JSON.stringify({ grant_type: "client_credentials", client_id: env.WAYFAIR_AD_CLIENT_ID, client_secret: env.WAYFAIR_AD_CLIENT_SECRET, audience: WAYFAIR_ADVERTISING_AUDIENCE }),
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
    if (response.status === 401) {
      throw new Error(`Wayfair 拒绝了广告写入凭证（HTTP 401）${details}。请求已使用生产 OAuth audience；请核对 Sites 的广告 Client ID 与 Client Secret 是否同时属于已开启 Modify Bids 的 advertising ops 应用`);
    }
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
    const result = await env.DB.prepare("SELECT * FROM ad_action_queue WHERE run_key=? AND status=? AND action_type='SET_LISTING_BID' ORDER BY campaign_id,listing").bind(body.runKey, requiredStatus).all<QueueRow>();
    const actions = result.results || [];
    const campaigns = buildCampaignUpdates(actions);
    if (!campaigns.length) return Response.json({ error: requiredStatus === "APPROVED" ? "没有已确认、可预检的 Bid 动作" : "没有已通过预检的 Bid 动作" }, { status: 409 });
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
    const allActionIds = campaigns.flatMap((campaign) => campaign.actionIds);
    try {
      for (const actionId of allActionIds) await record(env.DB, [actionId], "EXECUTING", { runKey: body.runKey }, "EXECUTING");
      let accessToken: string;
      try {
        accessToken = await token(env);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Wayfair OAuth 失败";
        await record(env.DB, allActionIds, "FAILED", { error: detail }, "FAILED");
        return Response.json({ error: `${detail}；尚未向 Wayfair 提交任何 Campaign` }, { status: 502 });
      }
      const outcomes = await executeCampaignUpdates(campaigns, (campaign) => updateCampaign(accessToken, campaign.campaignId, campaign.listings));
      for (const outcome of outcomes) {
        if (outcome.ok) {
          await record(env.DB, outcome.actionIds, "EXECUTED", { campaignId: outcome.campaignId, response: outcome.response }, "EXECUTED");
        } else {
          await record(env.DB, outcome.actionIds, "FAILED", { campaignId: outcome.campaignId, error: outcome.error }, "FAILED");
        }
      }
      const successCount = outcomes.filter((item) => item.ok).reduce((sum, item) => sum + item.actionIds.length, 0);
      const failedCount = outcomes.filter((item) => !item.ok).reduce((sum, item) => sum + item.actionIds.length, 0);
      const message = failedCount
        ? `执行完成：成功 ${successCount} 项，失败 ${failedCount} 项。每项结果与原因已显示在批次表。`
        : `已成功执行 ${successCount} 项广告修改。`;
      return Response.json({ mode: "live", campaignCount: campaigns.length, actionCount: successCount, successCount, failedCount, outcomes, message }, { status: failedCount ? 207 : 200 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "广告执行失败";
      return Response.json({ error: `${detail}；已写入 Wayfair 的结果不会被覆盖，请刷新批次查看逐项状态` }, { status: 500 });
    } finally {
      await env.DB.prepare("DELETE FROM ad_execution_locks WHERE run_key=?").bind(body.runKey).run();
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "广告执行失败" }, { status: 500 });
  }
}
