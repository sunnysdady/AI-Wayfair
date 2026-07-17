import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const seedBrief = {
  briefDate: "2026-07-17",
  syncedAt: "2026-07-17T04:00:00.000Z",
  source: "Outlook Email · initial connector sync",
  summary: { total: 4, unread: 3, actionRequired: 4, highestPriority: "P1" },
  items: [
    { id: "CS668331277", subject: "PO CS668331277 · FedEx Home Delivery", sender: "NewSupplierOps@wayfair.com", receivedAt: "2026-07-17T07:59:16+08:00", unread: true, priority: "P1", summary: "新订单通知，Must Ship By 07/20/2026。", owner: "履约同事", status: "待交接", webLink: "https://outlook.live.com/mail/" },
    { id: "CA668285426", subject: "PO CA668285426 · Ship Ground", sender: "NewSupplierOps@wayfair.com", receivedAt: "2026-07-17T02:51:46+08:00", unread: true, priority: "P1", summary: "Wayfair Canada 新订单通知，Must Ship By 07/20/2026。", owner: "履约同事", status: "待交接", webLink: "https://outlook.live.com/mail/" },
    { id: "CS668268073", subject: "PO CS668268073 · FedEx Home Delivery", sender: "NewSupplierOps@wayfair.com", receivedAt: "2026-07-17T01:02:48+08:00", unread: true, priority: "P1", summary: "新订单通知，需要履约同事确认订单登记。", owner: "履约同事", status: "待交接", webLink: "https://outlook.live.com/mail/" },
    { id: "CS668200000", subject: "PO CS668200000 · FedEx Home Delivery", sender: "NewSupplierOps@wayfair.com", receivedAt: "2026-07-16T10:55:05+08:00", unread: false, priority: "P2", summary: "订单通知已读，Dashboard保留跟踪证据。", owner: "履约同事", status: "已读", webLink: "https://outlook.live.com/mail/" },
  ],
  tasks: [
    { id: "handoff-2026-07-17", title: "将 3 封未读 PO 通知交接履约同事", owner: "运营", dueDate: "2026-07-17", priority: "P1", status: "待处理" },
  ],
};

const bindings = getRuntimeBindings;

async function ensureTable(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS outlook_daily_briefs (brief_date TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL)").run();
}

export async function GET() {
  try {
    const env = await bindings();
    await ensureTable(env.DB);
    const latest = await env.DB.prepare("SELECT payload,synced_at FROM outlook_daily_briefs ORDER BY brief_date DESC LIMIT 1").first<{payload:string;synced_at:string}>();
    if (!latest) return Response.json(seedBrief, { headers: { "Cache-Control": "private, max-age=300" } });
    return Response.json({ ...JSON.parse(latest.payload), syncedAt: latest.synced_at }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outlook 日报读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const env = await bindings();
    if (!env.OUTLOOK_INGEST_TOKEN || request.headers.get("authorization") !== `Bearer ${env.OUTLOOK_INGEST_TOKEN}`) return Response.json({ error: "Outlook 同步凭证无效" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.briefDate || "")) || !Array.isArray(body.items) || body.items.length > 100 || !Array.isArray(body.tasks)) return Response.json({ error: "Outlook 日报载荷无效" }, { status: 400 });
    await ensureTable(env.DB);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO outlook_daily_briefs(brief_date,payload,synced_at) VALUES(?,?,?) ON CONFLICT(brief_date) DO UPDATE SET payload=excluded.payload,synced_at=excluded.synced_at")
      .bind(String(body.briefDate), JSON.stringify({ ...body, source: "Outlook Email · daily connector sync" }), now).run();
    return Response.json({ ok: true, briefDate: body.briefDate, syncedAt: now });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outlook 日报同步失败" }, { status: 500 });
  }
}
