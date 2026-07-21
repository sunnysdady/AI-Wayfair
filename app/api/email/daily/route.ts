import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const bindings = getRuntimeBindings;

const MAX_ITEMS = 100;
const MAX_TASKS = 100;
const MAX_SECTIONS = 24;

function hasIngestAuthorization(request: Request, env: Awaited<ReturnType<typeof bindings>>) {
  const authorization = request.headers.get("authorization");
  if (env.OUTLOOK_INGEST_TOKEN && authorization === `Bearer ${env.OUTLOOK_INGEST_TOKEN}`) return true;

  // Sites verifies and removes OAI-Sites-Authorization before requests reach this
  // Worker. This marker is accepted only behind that protected Sites gateway, so
  // the automation does not need a second secret copied into its prompt.
  return request.headers.get("x-wayfair-automation") === "outlook-daily-sync";
}

function isBriefPayload(body: Record<string, unknown>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.briefDate || ""))) return false;
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS || !Array.isArray(body.tasks) || body.tasks.length > MAX_TASKS) return false;
  if (body.sections != null && (!Array.isArray(body.sections) || body.sections.length > MAX_SECTIONS)) return false;
  const hasValidItems = body.items.every((item) => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return ["id", "category", "subject", "sender", "receivedAt", "priority", "summary", "owner", "status", "webLink"].every((key) => typeof value[key] === "string" && value[key].length <= 500)
      && (value.bodyPreview == null || (typeof value.bodyPreview === "string" && value.bodyPreview.length <= 4000))
      && typeof value.unread === "boolean";
  });
  const hasValidTasks = body.tasks.every((task) => {
    if (!task || typeof task !== "object") return false;
    const value = task as Record<string, unknown>;
    return ["id", "title", "owner", "dueDate", "priority", "status"].every((key) => typeof value[key] === "string" && value[key].length <= 500);
  });
  const hasValidSections = (body.sections || []).every((section) => {
    if (!section || typeof section !== "object") return false;
    const value = section as Record<string, unknown>;
    return typeof value.title === "string" && value.title.length <= 120 && typeof value.body === "string" && value.body.length <= 4000
      && (value.tone == null || (typeof value.tone === "string" && value.tone.length <= 30));
  });
  return hasValidItems && hasValidTasks && hasValidSections;
}

async function ensureTable(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS outlook_daily_briefs (brief_date TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL)").run();
}

export async function GET(request: Request) {
  try {
    const env = await bindings();
    await ensureTable(env.DB);
    const url = new URL(request.url);
    if (url.searchParams.get("available") === "1") {
      const rows = await env.DB.prepare("SELECT brief_date FROM outlook_daily_briefs ORDER BY brief_date DESC LIMIT 31").all<{brief_date:string}>();
      return Response.json({ dates: rows.results.map((row) => row.brief_date) }, { headers: { "Cache-Control": "private, max-age=300" } });
    }
    const briefDate = url.searchParams.get("date");
    if (briefDate && !/^\d{4}-\d{2}-\d{2}$/.test(briefDate)) return Response.json({ error: "日报日期无效" }, { status: 400 });
    const latest = briefDate
      ? await env.DB.prepare("SELECT payload,synced_at FROM outlook_daily_briefs WHERE brief_date=?").bind(briefDate).first<{payload:string;synced_at:string}>()
      : await env.DB.prepare("SELECT payload,synced_at FROM outlook_daily_briefs ORDER BY brief_date DESC LIMIT 1").first<{payload:string;synced_at:string}>();
    if (!latest) return Response.json({ briefDate: briefDate || "", syncedAt: "", source: "Outlook 邮件同步等待首次运行", summary: { total: 0, unread: 0, actionRequired: 0, highestPriority: "-" }, items: [], tasks: [] }, { headers: { "Cache-Control": "private, max-age=300" } });
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
      .bind(String(body.briefDate), JSON.stringify({ ...body, source: typeof body.source === "string" ? body.source : "Outlook Email · daily connector sync" }), now).run();
    return Response.json({ ok: true, briefDate: body.briefDate, syncedAt: now });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outlook 日报同步失败" }, { status: 500 });
  }
}
