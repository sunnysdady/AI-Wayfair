import ExcelJS from "exceljs";

import { costTemplateCsv, resolveColumns, summarizeCostCoverage, validateCostRows } from "@/lib/sku-costs.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const bindings = getRuntimeBindings;

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const SOLD_LOOKBACK_DAYS = 180;

type SoldPart = { partNumber: string; units: number; revenueCents: number; unitPriceCents: number };

async function ensureCostTable(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS sku_costs (part_number TEXT PRIMARY KEY NOT NULL, unit_cost_cents INTEGER NOT NULL, source TEXT DEFAULT 'manual' NOT NULL, updated_at TEXT NOT NULL)").run();
}

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(value: string, days: number) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

async function loadSoldParts(db: D1Database): Promise<SoldPart[]> {
  const since = `${addDays(shanghaiToday(), -SOLD_LOOKBACK_DAYS)}T00:00:00+08:00`;
  const rows = await db.prepare(`SELECT i.part_number AS part_number,
      SUM(i.quantity) AS units,
      SUM(i.unit_price_cents*i.quantity) AS revenue_cents,
      MAX(i.unit_price_cents) AS unit_price_cents
    FROM order_items i JOIN orders o ON o.po_number=i.po_number
    WHERE o.po_date >= ? GROUP BY i.part_number`)
    .bind(since)
    .all<{ part_number: string; units: number; revenue_cents: number; unit_price_cents: number }>();
  return (rows.results || []).map((row) => ({
    partNumber: row.part_number,
    units: Number(row.units || 0),
    revenueCents: Number(row.revenue_cents || 0),
    unitPriceCents: Number(row.unit_price_cents || 0),
  }));
}

async function loadCoverage(db: D1Database) {
  const [soldParts, costed] = await Promise.all([
    loadSoldParts(db),
    db.prepare("SELECT part_number, unit_cost_cents, source, updated_at FROM sku_costs ORDER BY part_number")
      .all<{ part_number: string; unit_cost_cents: number; source: string; updated_at: string }>(),
  ]);
  const costs = (costed.results || []).map((row) => ({
    partNumber: row.part_number,
    unitCost: Number(row.unit_cost_cents) / 100,
    source: row.source,
    updatedAt: row.updated_at,
  }));
  const summary = summarizeCostCoverage({ soldParts, costedParts: costs.map((item) => item.partNumber) });
  return { soldParts, costs, summary };
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) return { headers: [] as string[], rows: [] as string[][] };
  const split = (line: string) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim());
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

async function parseWorkbook(file: File) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await file.arrayBuffer()) as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("工作簿没有可读工作表");
  const headers: string[] = [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1).map((cell) => {
      if (cell && typeof cell === "object" && "result" in cell) return String((cell as { result?: unknown }).result ?? "");
      if (cell && typeof cell === "object" && "text" in cell) return String((cell as { text?: unknown }).text ?? "");
      return cell == null ? "" : String(cell);
    });
    if (rowNumber === 1) headers.push(...values);
    else rows.push(values);
  });
  return { headers, rows };
}

export async function GET(request: Request) {
  try {
    const env = await bindings();
    await ensureCostTable(env.DB);
    const { costs, summary } = await loadCoverage(env.DB);
    if (new URL(request.url).searchParams.get("template") === "1") {
      return new Response(costTemplateCsv(summary.missing), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="sku-costs-${shanghaiToday()}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    return Response.json({ ...summary, costs, lookbackDays: SOLD_LOOKBACK_DAYS }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "SKU 成本读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const env = await bindings();
    await ensureCostTable(env.DB);

    let parsed: { headers: string[]; rows: string[][] };
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const file = (await request.formData()).get("file");
      if (!(file instanceof File)) return Response.json({ error: "请选择 CSV 或 XLSX 成本文件" }, { status: 400 });
      if (!file.size || file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "文件为空或超过 5MB" }, { status: 400 });
      parsed = file.name.toLowerCase().endsWith(".xlsx") ? await parseWorkbook(file) : parseCsv(await file.text());
    } else {
      const body = await request.json() as { csv?: string };
      if (typeof body.csv !== "string" || !body.csv.trim()) return Response.json({ error: "请提供 csv 文本" }, { status: 400 });
      parsed = parseCsv(body.csv);
    }

    const columns = resolveColumns(parsed.headers);
    if (columns.partNumber < 0 || columns.unitCost < 0) {
      return Response.json({ error: "缺少 SKU 与成本列；表头需包含 part_number/SKU 与 unit_cost/成本" }, { status: 422 });
    }
    if (parsed.rows.length > MAX_ROWS) return Response.json({ error: `行数超过上限 ${MAX_ROWS}` }, { status: 422 });

    const soldParts = await loadSoldParts(env.DB);
    const priceByPart = new Map(soldParts.map((part) => [part.partNumber, part.unitPriceCents]));
    const { costs, errors, warnings } = validateCostRows(
      parsed.rows.map((row) => ({ partNumber: row[columns.partNumber], unitCost: row[columns.unitCost] })),
      priceByPart,
    );

    // A partial import would leave margins half-real and half-estimated with no
    // way to tell which, so nothing is written unless every row is valid.
    if (errors.length) {
      return Response.json({ error: "成本文件校验未通过，未写入任何数据", errors: errors.slice(0, 50), warnings }, { status: 422 });
    }
    if (!costs.length) return Response.json({ error: "文件没有可导入的成本行" }, { status: 422 });

    const now = new Date().toISOString();
    const statements = costs.map((cost) => env.DB.prepare(
      "INSERT INTO sku_costs(part_number,unit_cost_cents,source,updated_at) VALUES(?,?,?,?) ON CONFLICT(part_number) DO UPDATE SET unit_cost_cents=excluded.unit_cost_cents,source=excluded.source,updated_at=excluded.updated_at",
    ).bind(cost.partNumber, cost.unitCostCents, "manual", now));
    for (let index = 0; index < statements.length; index += 80) await env.DB.batch(statements.slice(index, index + 80));

    const after = await loadCoverage(env.DB);
    return Response.json({
      imported: costs.length,
      warnings,
      ...after.summary,
      message: `已写入 ${costs.length} 个 SKU 成本；按收入加权的成本覆盖率 ${Math.round(after.summary.revenueCoverage * 100)}%。`,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "SKU 成本导入失败" }, { status: 400 });
  }
}
