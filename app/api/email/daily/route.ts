import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { hasOutlookIngestAuthorization } from "@/lib/outlook-ingest-auth.mjs";
import { normalizeEmailBriefItem } from "@/lib/email-summary.mjs";

const bindings = getRuntimeBindings;

const MAX_ITEMS = 100;
const MAX_TASKS = 100;
const MAX_SECTIONS = 24;

function hasIngestAuthorization(request: Request, env: Awaited<ReturnType<typeof bindings>>) {
  return hasOutlookIngestAuthorization(request.headers, env.OUTLOOK_INGEST_TOKEN);
}

function isBriefPayload(body: Record<string, unknown>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.briefDate || ""))) return false;
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS || !Array.isArray(body.tasks) || body.tasks.length > MAX_TASKS) return false;
  if (body.sections != null && (!Array.isArray(body.sections) || body.sections.length > MAX_SECTIONS)) return false;
  const hasValidItems = body.items.every((item) => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    const financial = value.financial as Record<string, unknown> | null | undefined;
    const hasValidFinancial = financial == null || (typeof financial === "object"
      && ["remittanceId", "currency", "paymentDate", "paymentMethod"].every((key) => financial[key] == null || (typeof financial[key] === "string" && financial[key].length <= 120))
      && (financial.amount == null || (typeof financial.amount === "number" && Number.isFinite(financial.amount) && financial.amount >= 0))
      && (financial.invoiceIds == null || (Array.isArray(financial.invoiceIds) && financial.invoiceIds.length <= 100 && financial.invoiceIds.every((id) => typeof id === "string" && id.length <= 120))));
    return ["id", "category", "subject", "sender", "receivedAt", "priority", "summary", "owner", "status", "webLink"].every((key) => typeof value[key] === "string" && value[key].length <= 500)
      && (value.bodyPreview == null || (typeof value.bodyPreview === "string" && value.bodyPreview.length <= 4000))
      && hasValidFinancial
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

function poNumberFor(item: Record<string, unknown>) {
  const text = [item.subject, item.summary, item.bodyPreview].filter(Boolean).join("\n");
  return text.match(/\bPO\s*(?:number|no\.?|#)?\s*[:#-]?\s*([a-z0-9][a-z0-9-]{3,})\b/i)?.[1] || "";
}

async function enrichOrderEmails(db: D1Database, items: Record<string, unknown>[]) {
  const poNumbers = [...new Set(items.map(poNumberFor).filter(Boolean))];
  if (!poNumbers.length) return items.map((item) => normalizeEmailBriefItem(item) as Record<string, unknown>);
  const placeholders = poNumbers.map(() => "?").join(",");
  const orderRows = await db.prepare(`SELECT o.po_number,i.part_number,i.quantity,i.unit_price_cents
    FROM orders o JOIN order_items i ON i.po_number=o.po_number
    WHERE o.po_number IN (${placeholders}) ORDER BY o.po_number,i.line_key`).bind(...poNumbers)
    .all<{po_number:string;part_number:string;quantity:number;unit_price_cents:number}>();
  const wantedSkus = new Set(orderRows.results.map((row) => row.part_number));
  const names = new Map<string, string>();
  if (wantedSkus.size) {
    try {
      const adRows = await db.prepare("SELECT payload FROM ad_report_rows WHERE report_type=? ORDER BY report_date DESC LIMIT 2000")
        .bind("LISTING_REPORT").all<{payload:string}>();
      for (const row of adRows.results) {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        const productName = String(payload.product_name || "").trim();
        if (!productName) continue;
        for (const sku of String(payload.first_10_part_numbers || "").split(",").map((value) => value.trim()).filter(Boolean)) {
          if (wantedSkus.has(sku) && !names.has(sku)) names.set(sku, productName);
        }
      }
    } catch {
      // Product names are optional; order totals remain available from the orders tables.
    }
  }
  const rowsByPo = new Map<string, typeof orderRows.results>();
  for (const row of orderRows.results) rowsByPo.set(row.po_number, [...(rowsByPo.get(row.po_number) || []), row]);
  return items.map((item) => {
    const poNumber = poNumberFor(item);
    const rows = rowsByPo.get(poNumber) || [];
    if (!rows.length) return normalizeEmailBriefItem(item) as Record<string, unknown>;
    const orderItems = rows.map((row) => ({
      sku: row.part_number,
      name: names.get(row.part_number) || "",
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unit_price_cents || 0) / 100,
    }));
    return normalizeEmailBriefItem({
      ...item,
      order: {
        poNumber,
        currency: "USD",
        totalQuantity: orderItems.reduce((sum, orderItem) => sum + orderItem.quantity, 0),
        totalAmount: orderItems.reduce((sum, orderItem) => sum + orderItem.quantity * orderItem.unitPrice, 0),
        items: orderItems,
      },
    }) as Record<string, unknown>;
  });
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
    const payload = JSON.parse(latest.payload) as Record<string, unknown>;
    const normalizedItems: Record<string, unknown>[] = Array.isArray(payload.items)
      ? await enrichOrderEmails(env.DB, payload.items as Record<string, unknown>[])
      : [];
    const financeBrief = normalizedItems
      .filter((item) => /财务|账单|回款|付款|finance|payment|remittance|invoice/i.test(String(item.category || "")))
      .map((item) => String(item.summary || ""))
      .filter(Boolean)
      .join("；");
    const normalizedSections = Array.isArray(payload.sections)
      ? (payload.sections as Record<string, unknown>[]).map((section) => (
        financeBrief && /财务|账单|回款|finance|payment/i.test(String(section.title || ""))
          ? { ...section, body: financeBrief }
          : section
      ))
      : payload.sections;
    const normalizedPayload = Array.isArray(payload.items)
      ? { ...payload, items: normalizedItems, sections: normalizedSections }
      : payload;
    return Response.json({ ...normalizedPayload, syncedAt: latest.synced_at }, { headers: { "Cache-Control": "private, no-store" } });
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
    const normalizedBody = { ...body, items: await enrichOrderEmails(env.DB, body.items as Record<string, unknown>[]) };
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO outlook_daily_briefs(brief_date,payload,synced_at) VALUES(?,?,?) ON CONFLICT(brief_date) DO UPDATE SET payload=excluded.payload,synced_at=excluded.synced_at")
      .bind(String(body.briefDate), JSON.stringify({ ...normalizedBody, source: typeof body.source === "string" ? body.source : "Outlook Email · daily connector sync" }), now).run();
    return Response.json({ ok: true, briefDate: body.briefDate, syncedAt: now });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outlook 日报同步失败" }, { status: 500 });
  }
}
