import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const bindings = getRuntimeBindings;

const MAX_ITEMS = 100;
const MAX_TASKS = 100;

function hasIngestAuthorization(request: Request, env: Awaited<ReturnType<typeof bindings>>) {
  const authorization = request.headers.get("authorization");
  if (env.OUTLOOK_INGEST_TOKEN && authorization === `Bearer ${env.OUTLOOK_INGEST_TOKEN}`) return true;

  // Sites verifies this token before the request reaches the worker. The automation
  // uses it so the write credential never has to be copied into an automation prompt.
  return /^Bearer [A-Za-z0-9_-]{20,}$/.test(request.headers.get("oai-sites-authorization") || "");
}

function isBriefPayload(body: Record<string, unknown>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.briefDate || ""))) return false;
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS || !Array.isArray(body.tasks) || body.tasks.length > MAX_TASKS) return false;
  return body.items.every((item) => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return ["id", "category", "subject", "sender", "receivedAt", "priority", "summary", "owner", "status", "webLink"].every((key) => typeof value[key] === "string" && value[key].length <= 500)
      && typeof value.unread === "boolean";
  }) && body.tasks.every((task) => {
    if (!task || typeof task !== "object") return false;
    const value = task as Record<string, unknown>;
    return ["id", "title", "owner", "dueDate", "priority", "status"].every((key) => typeof value[key] === "string" && value[key].length <= 500);
  });
}

async function ensureTable(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS outlook_daily_briefs (brief_date TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL)").run();
}

export async function GET() {
  try {
    const env = await bindings();
    await ensureTable(env.DB);
    const latest = await env.DB.prepare("SELECT payload,synced_at FROM outlook_daily_briefs ORDER BY brief_date DESC LIMIT 1").first<{payload:string;synced_at:string}>();
    if (!latest) return Response.json({ briefDate: "", syncedAt: "", source: "Outlook 邮件同步等待首次运行", summary: { total: 0, unread: 0, actionRequired: 0, highestPriority: "-" }, items: [], tasks: [] }, { headers: { "Cache-Control": "private, max-age=300" } });
    return Response.json({ ...JSON.parse(latest.payload), syncedAt: latest.synced_at }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outlook 日报读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const env = await bindings();
    if (!hasIngestAuthorization(request, env)) return Response.json({ error: "Outlook 同步凭证无效" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    if (!isBriefPayload(body)) return Response.json({ error: "Outlook 日报载荷无效" }, { status: 400 });
    await ensureTable(env.DB);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO outlook_daily_briefs(brief_date,payload,synced_at) VALUES(?,?,?) ON CONFLICT(brief_date) DO UPDATE SET payload=excluded.payload,synced_at=excluded.synced_at")
      .bind(String(body.briefDate), JSON.stringify({ ...body, source: "Outlook Email · daily connector sync" }), now).run();
    return Response.json({ ok: true, briefDate: body.briefDate, syncedAt: now });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outlook 日报同步失败" }, { status: 500 });
  }
}
