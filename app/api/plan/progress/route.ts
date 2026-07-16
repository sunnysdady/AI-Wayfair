import { AUGUST_PLAN, PLAN_LISTINGS, WEEKLY_MILESTONES } from "../../../../lib/operating-plan";
import { cachedAdSpend } from "../../../../lib/wayfair-ads";

async function bindings() { return (await import("cloudflare:workers")).env; }

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const env = await bindings();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const start = `${AUGUST_PLAN.month}-01`, end = `${AUGUST_PLAN.month}-31`, endExclusive = addDays(end, 1);
    const actualEnd = today < start ? start : today > end ? end : today;
    const actual = await env.DB.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(units),0) AS units, COALESCE(SUM(revenue_cents),0)/100.0 AS revenue FROM orders WHERE datetime(po_date)>=datetime(?) AND datetime(po_date)<datetime(?)`).bind(`${start}T00:00:00+08:00`, `${endExclusive}T00:00:00+08:00`).first<{ orders: number; units: number; revenue: number }>();
    const skuActual = await env.DB.prepare(`SELECT i.part_number AS partNumber, SUM(i.quantity) AS units, SUM(i.unit_price_cents*i.quantity)/100.0 AS revenue FROM order_items i JOIN orders o ON o.po_number=i.po_number WHERE datetime(o.po_date)>=datetime(?) AND datetime(o.po_date)<datetime(?) GROUP BY i.part_number`).bind(`${start}T00:00:00+08:00`, `${endExclusive}T00:00:00+08:00`).all();
    const actualByPart = new Map((skuActual.results || []).map((item) => [String(item.partNumber), Number(item.units || 0)]));
    const listings = PLAN_LISTINGS.filter((item) => item.augustUnits > 0).map((item) => ({ ...item, actualUnits: item.parts.reduce((sum, part) => sum + (actualByPart.get(part) || 0), 0) }));
    const elapsedDays = today < start ? 0 : today > end ? 31 : Number(today.slice(8, 10));
    const expectedUnits = Number((AUGUST_PLAN.unitTarget * elapsedDays / 31).toFixed(1));
    const units = Number(actual?.units || 0), remainingUnits = Math.max(0, AUGUST_PLAN.unitTarget - units), remainingDays = Math.max(0, 31 - elapsedDays);
    const forecastUnits = elapsedDays ? Number((units / elapsedDays * 31).toFixed(1)) : 0;
    const ad = await cachedAdSpend(env.DB, start, actualEnd);
    return Response.json({
      plan: AUGUST_PLAN, currentOperatingMonth: { month: today.slice(0, 7), targetStatus: today.slice(0, 7) === AUGUST_PLAN.month ? "ACTIVE" : "NOT_CONFIGURED", note: today.slice(0, 7) === "2026-07" ? "7月经营目标未建档；不使用8月目标冒充当前月目标。" : "" },
      status: today < start ? "PREPARATION" : today > end ? "CLOSED" : "ACTIVE", asOf: today,
      actual: { orders: Number(actual?.orders || 0), units, revenue: Number(actual?.revenue || 0), adSpend: ad.spend, adCoverage: ad.coverage },
      progress: { elapsedDays, totalDays: 31, timeProgress: elapsedDays / 31, unitCompletion: units / AUGUST_PLAN.unitTarget, expectedUnits, paceGap: Number((units - expectedUnits).toFixed(1)), forecastUnits, remainingUnits, requiredDailyUnits: remainingDays ? Number((remainingUnits / remainingDays).toFixed(1)) : 0 },
      listings, milestones: WEEKLY_MILESTONES,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "计划进度读取失败" }, { status: 500 });
  }
}
