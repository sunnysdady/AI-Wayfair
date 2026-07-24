import {
  AUGUST_PLAN,
  AUGUST_PLAN_LISTINGS,
  BFIJ_PLAN,
  JULY_EVENTS,
  JULY_PLAN,
  JULY_PLAN_LISTINGS,
  MAKEACE_CPC_PLAN,
  WEEKLY_MILESTONES,
} from "../../../../lib/operating-plan";
import { cachedAdSpend } from "../../../../lib/wayfair-ads";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const DEFAULT_MARGIN_RATE = .2826;

const bindings = getRuntimeBindings;

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function phaseRange(range: string) {
  const [start, end] = range.split("–");
  return [`2026-${start.replace("/", "-")}`, `2026-${end.replace("/", "-")}`];
}

export async function GET() {
  try {
    const env = await bindings();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const start = `${JULY_PLAN.month}-01`;
    const end = `${JULY_PLAN.month}-31`;
    const actualEnd = today < start ? start : today > end ? end : today;
    const endExclusive = addDays(actualEnd, 1);
    const from = `${start}T00:00:00+08:00`;
    const until = `${endExclusive}T00:00:00+08:00`;

    const actual = await env.DB.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(units),0) AS units, COALESCE(SUM(revenue_cents),0)/100.0 AS revenue FROM orders WHERE po_date>=? AND po_date<?`).bind(from, until).first<{ orders: number; units: number; revenue: number }>();
    const orderItems = await env.DB.prepare(`SELECT i.po_number AS poNumber, i.part_number AS partNumber, i.quantity AS quantity, i.unit_price_cents AS unitPriceCents FROM order_items i JOIN orders o ON o.po_number=i.po_number WHERE o.po_date>=? AND o.po_date<?`).bind(from, until).all();
    const rows = (orderItems.results || []) as { poNumber: string; partNumber: string; quantity: number; unitPriceCents: number }[];
    const byPart = new Map<string, { orders: Set<string>; units: number; revenue: number }>();
    for (const row of rows) {
      const current = byPart.get(String(row.partNumber)) || { orders: new Set<string>(), units: 0, revenue: 0 };
      current.orders.add(String(row.poNumber));
      current.units += Number(row.quantity || 0);
      current.revenue += Number(row.unitPriceCents || 0) * Number(row.quantity || 0) / 100;
      byPart.set(String(row.partNumber), current);
    }
    const listings = JULY_PLAN_LISTINGS.filter((item) => Number(item.julyTargetOrders || 0) > 0).map((item) => {
      const orders = new Set<string>();
      let units = 0;
      let revenue = 0;
      for (const part of item.parts) {
        const partActual = byPart.get(part);
        partActual?.orders.forEach((order) => orders.add(order));
        units += partActual?.units || 0;
        revenue += partActual?.revenue || 0;
      }
      return { ...item, actualOrders: orders.size, actualUnits: units, actualRevenue: Number(revenue.toFixed(2)) };
    });

    const elapsedDays = today < start ? 0 : today > end ? 31 : Number(today.slice(8, 10));
    const orders = Number(actual?.orders || 0);
    const remainingOrders = Math.max(0, JULY_PLAN.orderTarget - orders);
    const remainingDays = Math.max(0, 31 - elapsedDays);
    const expectedOrders = Number((JULY_PLAN.orderTarget * elapsedDays / 31).toFixed(1));
    const forecastOrders = elapsedDays ? Number((orders / elapsedDays * 31).toFixed(1)) : 0;
    const advertising = await cachedAdSpend(env.DB, start, actualEnd);
    const profit = await env.DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN c.unit_cost_cents IS NOT NULL THEN (i.unit_price_cents-c.unit_cost_cents)*i.quantity ELSE 0 END),0) AS knownProfitCents,
      COALESCE(SUM(CASE WHEN c.unit_cost_cents IS NULL THEN i.unit_price_cents*i.quantity ELSE 0 END),0) AS unknownRevenueCents,
      COALESCE(SUM(i.unit_price_cents*i.quantity),0) AS revenueCents
      FROM order_items i JOIN orders o ON o.po_number=i.po_number LEFT JOIN sku_costs c ON c.part_number=i.part_number
      WHERE o.po_date>=? AND o.po_date<?`).bind(from, until).first<{ knownProfitCents: number; unknownRevenueCents: number; revenueCents: number }>();
    const grossProfit = Number(profit?.knownProfitCents || 0) / 100 + Number(profit?.unknownRevenueCents || 0) / 100 * DEFAULT_MARGIN_RATE;
    const contributionAfterAds = advertising.spend === null ? null : Number((grossProfit - advertising.spend).toFixed(2));
    const activePhase = BFIJ_PLAN.phases.find((phase) => {
      const [phaseStart, phaseEnd] = phaseRange(phase.range);
      return today >= phaseStart && today <= phaseEnd;
    })?.id || (today < "2026-07-16" ? "before" : "closed");

    return Response.json({
      plan: JULY_PLAN,
      currentOperatingMonth: { month: JULY_PLAN.month, targetStatus: "ACTIVE", note: "128 Orders真实基线计划执行中" },
      status: today < start ? "PREPARATION" : today > end ? "CLOSED" : "ACTIVE",
      asOf: today,
      actual: {
        orders,
        units: Number(actual?.units || 0),
        revenue: Number(actual?.revenue || 0),
        adSpend: advertising.spend,
        adCoverage: advertising.coverage,
        grossProfitBeforeAds: Number(grossProfit.toFixed(2)),
        contributionAfterAds,
        costCoverage: Number(profit?.revenueCents || 0) ? 1 - Number(profit?.unknownRevenueCents || 0) / Number(profit?.revenueCents || 0) : 0,
      },
      progress: {
        elapsedDays,
        totalDays: 31,
        timeProgress: elapsedDays / 31,
        orderCompletion: orders / JULY_PLAN.orderTarget,
        expectedOrders,
        paceGap: Number((orders - expectedOrders).toFixed(1)),
        forecastOrders,
        remainingOrders,
        requiredDailyOrders: remainingDays ? Number((remainingOrders / remainingDays).toFixed(1)) : 0,
      },
      listings,
      events: JULY_EVENTS,
      activity: { ...BFIJ_PLAN, activePhase },
      cpcPlan: MAKEACE_CPC_PLAN,
      nextPlan: {
        plan: AUGUST_PLAN,
        listings: AUGUST_PLAN_LISTINGS.filter((item) => Number(item.augustUnits || 0) > 0).map((item) => ({ ...item, actualUnits: 0 })),
        milestones: WEEKLY_MILESTONES,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "计划进度读取失败" }, { status: 500 });
  }
}
