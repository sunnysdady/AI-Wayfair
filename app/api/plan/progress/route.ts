import {
  AUGUST_PLAN,
  AUGUST_PLAN_LISTINGS,
  AUGUST_OPERATIONS_GUIDE,
  BFIJ_PLAN,
  JULY_EVENTS,
  LISTING_PORTFOLIO_POLICY,
  MAKEACE_CPC_PLAN,
  WEEKLY_MILESTONES,
} from "../../../../lib/operating-plan";
import {
  AUGUST_PROMOTION_EVENTS,
  AUGUST_PROMOTION_PLAN,
  AUGUST_PROMOTION_PORTFOLIO,
  AUGUST_QUANTITY_PROMOTION,
  promotionReviewSummary,
  syncPromotionsToSalesPlan,
} from "../../../../lib/august-promotion.mjs";
import {
  AUGUST_SALES_MILESTONES,
  AUGUST_SALES_PLAN,
  AUGUST_SALES_PLAN_ROWS,
  summarizeAugustSalesPlan,
} from "../../../../lib/august-sales-plan.mjs";
import {
  SEPTEMBER_SALES_PLAN,
  SEPTEMBER_SALES_PLAN_ROWS,
  summarizeSeptemberSalesPlan,
} from "../../../../lib/september-sales-plan.mjs";
import { cachedAdSpend } from "../../../../lib/wayfair-ads";
import { eventCycleForDate } from "../../../../lib/event-cycle.mjs";
import { lingxingDate, lingxingDayStart } from "@/lib/lingxing-business-time.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import {
  AUGUST_AD_EXECUTION_STATUS,
  AUGUST_EXECUTION_POLICY,
  evaluateAugustStageTwo,
} from "@/lib/august-execution-policy.mjs";

const DEFAULT_MARGIN_RATE = .2826;
const CURRENT_PLAN = Object.freeze({
  ...SEPTEMBER_SALES_PLAN,
  status: "ACTIVE",
  baseAdBudget: SEPTEMBER_SALES_PLAN.adBudget,
  scopeWarning: "9月目标按运营负责人确认的销售计划执行；8月计划已转入历史归档。",
});

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
    const today = lingxingDate();
    const start = `${CURRENT_PLAN.month}-01`;
    const totalDays = new Date(
      Date.UTC(Number(CURRENT_PLAN.month.slice(0, 4)), Number(CURRENT_PLAN.month.slice(5, 7)), 0),
    ).getUTCDate();
    const end = `${CURRENT_PLAN.month}-${String(totalDays).padStart(2, "0")}`;
    const actualEnd = today < start ? start : today > end ? end : today;
    const endExclusive = addDays(actualEnd, 1);
    const from = lingxingDayStart(start);
    const until = lingxingDayStart(endExclusive);

    const actual = await env.DB.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(units),0) AS units, COALESCE(SUM(revenue_cents),0)/100.0 AS revenue FROM orders WHERE po_date>=? AND po_date<? AND revenue_cents > 0`).bind(from, until).first<{ orders: number; units: number; revenue: number }>();
    // September has a confirmed SKU target list, but not a verified part-number
    // mapping. Do not fabricate per-SKU actuals from the August mapping.
    const listings: never[] = [];

    const elapsedDays = today < start ? 0 : today > end ? totalDays : Number(today.slice(8, 10));
    const orders = Number(actual?.orders || 0);
    const remainingOrders = Math.max(0, CURRENT_PLAN.orderTarget - orders);
    const remainingDays = Math.max(0, totalDays - elapsedDays);
    const expectedOrders = Number((CURRENT_PLAN.orderTarget * elapsedDays / totalDays).toFixed(1));
    const forecastOrders = elapsedDays ? Number((orders / elapsedDays * totalDays).toFixed(1)) : 0;
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
    const eventCycle = eventCycleForDate(today);

    return Response.json({
      plan: {
        ...CURRENT_PLAN,
        baselineOrders: 0,
        floorOrders: 0,
        stretchOrders: CURRENT_PLAN.orderTarget,
        adBudget: CURRENT_PLAN.baseAdBudget,
        estimatedNetProfit: 0,
      },
      currentOperatingMonth: { month: CURRENT_PLAN.month, targetStatus: "ACTIVE", note: `${CURRENT_PLAN.orderTarget} Orders计划执行中` },
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
        totalDays,
        timeProgress: elapsedDays / totalDays,
        orderCompletion: orders / CURRENT_PLAN.orderTarget,
        expectedOrders,
        paceGap: Number((orders - expectedOrders).toFixed(1)),
        forecastOrders,
        remainingOrders,
        requiredDailyOrders: remainingDays ? Number((remainingOrders / remainingDays).toFixed(1)) : 0,
      },
      listings,
      events: JULY_EVENTS,
      eventCycle,
      listingPortfolioPolicy: LISTING_PORTFOLIO_POLICY,
      activity: { ...BFIJ_PLAN, activePhase },
      cpcPlan: MAKEACE_CPC_PLAN,
      augustArchive: {
        advertisingExecution: AUGUST_AD_EXECUTION_STATUS,
        executionPolicy: AUGUST_EXECUTION_POLICY,
        executionStage: evaluateAugustStageTwo({
          promotionEvents: AUGUST_PROMOTION_EVENTS,
          projectedPostAdMargin: promotionReviewSummary(AUGUST_PROMOTION_PLAN).projectedPostAdMargin,
          fillRate: 0,
          minimumInventoryCoverDays: 0,
          listingOperationalEvidenceVerified: false,
          mappingScopeVerified: false,
        }),
        plan: AUGUST_PLAN,
        operatingGuide: AUGUST_OPERATIONS_GUIDE,
        listings: AUGUST_PLAN_LISTINGS.filter((item) => Number(item.augustUnits || 0) > 0).map((item) => ({ ...item, actualUnits: 0 })),
        milestones: WEEKLY_MILESTONES,
        salesPlan: AUGUST_SALES_PLAN,
        salesPlanRows: syncPromotionsToSalesPlan(AUGUST_SALES_PLAN_ROWS),
        salesPlanSummary: summarizeAugustSalesPlan(AUGUST_SALES_PLAN_ROWS),
        salesMilestones: AUGUST_SALES_MILESTONES,
        promotionPlanStatus: "SYNCED_AFTER_SUBMISSION",
        promotionEvents: AUGUST_PROMOTION_EVENTS,
        promotionPlan: AUGUST_PROMOTION_PLAN,
        quantityPromotion: AUGUST_QUANTITY_PROMOTION,
        promotionPortfolio: AUGUST_PROMOTION_PORTFOLIO,
        promotionSummary: promotionReviewSummary(AUGUST_PROMOTION_PLAN),
      },
      septemberPlan: {
        plan: SEPTEMBER_SALES_PLAN,
        rows: SEPTEMBER_SALES_PLAN_ROWS,
        summary: summarizeSeptemberSalesPlan(),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "计划进度读取失败" }, { status: 500 });
  }
}
