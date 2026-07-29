import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

async function ensureTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS daily_operating_reports (
    report_date TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    generation_mode TEXT NOT NULL DEFAULT 'SCHEDULED'
  )`).run();
}

export async function GET(request: Request) {
  try {
    const env = await getRuntimeBindings();
    await ensureTable(env.DB);
    const url = new URL(request.url);
    if (url.searchParams.get("available") === "1") {
      const rows = await env.DB.prepare(
        "SELECT report_date FROM daily_operating_reports ORDER BY report_date DESC LIMIT 31",
      ).all<{ report_date: string }>();
      return Response.json(
        { dates: rows.results.map((row) => row.report_date) },
        { headers: { "cache-control": "private, max-age=300" } },
      );
    }
    const reportDate = url.searchParams.get("date");
    if (reportDate && !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      return Response.json({ error: "工作日报日期无效" }, { status: 400 });
    }
    const row = reportDate
      ? await env.DB.prepare(
        "SELECT payload,generated_at FROM daily_operating_reports WHERE report_date=?",
      ).bind(reportDate).first<{ payload: string; generated_at: string }>()
      : await env.DB.prepare(
        "SELECT payload,generated_at FROM daily_operating_reports ORDER BY report_date DESC LIMIT 1",
      ).first<{ payload: string; generated_at: string }>();
    if (!row) {
      return Response.json({
        reportDate: reportDate || "",
        generatedAt: "",
        source: "DigitalOcean server scheduler",
        status: "WAITING_FOR_SCHEDULED_RUN",
      }, { headers: { "cache-control": "private, no-store" } });
    }
    return Response.json(
      { ...JSON.parse(row.payload), generatedAt: row.generated_at },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "工作日报读取失败" },
      { status: 500 },
    );
  }
}
