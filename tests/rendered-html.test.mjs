import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the Wayfair AI operations product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Wayfair AI 运营中台/);
  assert.match(html, /Dashboard/);
  assert.match(html, /最近 7 天/);
  assert.match(html, /广告前商品毛利/);
  assert.match(html, /广告后店铺贡献/);
  assert.doesNotMatch(html, /实际利润/);
  assert.match(html, />广告</);
  assert.match(html, /Ops API（库存 \+ 订单）/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("keeps July execution and BFIJ strategy between June review and August preparation", async () => {
  const [page, plan] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/operating-plan.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /6月复盘 → 7月真实基线执行 → 8月下一阶段准备/);
  assert.match(page, /7月执行计划/);
  assert.match(page, /BFIJ 活动广告策略/);
  assert.doesNotMatch(page, /7月 · 目标未建档/);
  assert.match(plan, /orderTarget: 128/);
  assert.match(plan, /adBudget: 790/);
  assert.match(plan, /strategyBudget: 330/);
  assert.match(plan, /officialEventRange: "2026-07-23\/2026-07-28"/);
  assert.match(plan, /flashConfirmationDeadline: "2026-07-17"/);
});

test("separates the visible advertising period from the mature weekly decision window", async () => {
  const [page, ads] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /成熟周（推荐）/);
  assert.match(page, /最近 14 天/);
  assert.match(page, /批量加入执行单/);
  assert.match(page, /保本ROAS/);
  assert.match(page, /BM CPC/);
  assert.match(page, /money2\(row\.cpcBaseline\.cpc\)/);
  assert.match(page, /7月余/);
  assert.match(page, /8月留/);
  assert.match(ads, /attributionWindowDays: ATTRIBUTION_DAYS/);
  assert.match(ads, /rolling56d/);
  assert.match(ads, /ad_decision_runs/);
  assert.match(ads, /ad_report_rows/);
  assert.match(ads, /inventory/);
  assert.match(ads, /recommendCpcAction/);
  assert.match(ads, /augustReserveUnits/);
});

test("shares the Makeace June CPC anchor across July, BFIJ and August", async () => {
  const [strategy, plan, route] = await Promise.all([
    readFile(new URL("../lib/makeace-cpc-plan.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/operating-plan.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan/progress/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(strategy, /sourcePage: 22/);
  assert.match(strategy, /"Filing Cabinets": 0\.53/);
  assert.match(strategy, /"Bike And Sport Racks": 0\.57/);
  assert.match(strategy, /CPC_NOT_BID/);
  assert.match(strategy, /单次Bid下调不超过10%/);
  assert.match(plan, /活动赢家只加Cap/);
  assert.doesNotMatch(plan, /赢家1\.3×～1\.5×|通过Gate的主力 \+20%～35%/);
  assert.match(route, /cpcPlan: MAKEACE_CPC_PLAN/);
});

test("persists real inventory snapshots and uploaded monthly reports", async () => {
  const [page, inventory, reportRoute, hosting] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /补充复盘资料/);
  assert.match(page, /直接阅读完整原报告/);
  assert.match(page, /选择领星库存 XLSX/);
  assert.match(inventory, /inventory_snapshots/);
  assert.match(inventory, /inventory_snapshot_rows/);
  assert.match(reportRoute, /env\.FILES\.put/);
  assert.match(reportRoute, /export async function DELETE/);
  assert.match(hosting, /"r2": "FILES"/);
});

test("ships the complete evidence library instead of summary placeholders", async () => {
  const files = [
    "Wayfair_7月推广计划_v3真实基线_20260623.html",
    "Wayfair 北美地区 Black Friday in July官宣定档！.pdf",
    "YB店_8月150单完整增长Playbook.html",
    "YB店_店铺诊断报告.html",
    "YB店_SKU健康体检.html",
    "YB店_SKU广告重构执行清单_2026-07-15.xlsx",
  ];
  for (const file of files) {
    const contents = await readFile(new URL(`../public/reports/${file}`, import.meta.url));
    assert.ok(contents.byteLength > 100, `${file} should contain a real report`);
  }
});

test("restores persisted weekly actions after the advertising page reloads", async () => {
  const [{ queuedActionState }, page] = await Promise.all([
    import("../lib/ad-action-queue.mjs"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(queuedActionState([
    { campaign_id: "622741", listing: "DMOM1000", status: "PLANNED" },
    { campaign_id: "622731", listing: "DMOM1029", status: "EXECUTED" },
  ]), {
    "622741:DMOM1000": "saved",
    "622731:DMOM1029": "executed",
  });
  assert.match(page, /\/api\/ads\/actions\?runKey=/);
  assert.match(page, /queuedActionState/);
  assert.match(page, /本周执行批次/);
  assert.match(page, /确认并预检/);
  assert.match(page, /执行已预检项/);
});

test("ships the compact operations shell and bulk advertising workflow", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /className="sidebar"/);
  assert.match(page, /label: "帮助"/);
  assert.match(page, /批量加入执行单/);
  assert.match(page, /确认并预检/);
  assert.match(page, /执行已预检项/);
  assert.match(page, /执行结果/);
  assert.doesNotMatch(page, /输入：执行广告修改/);
  assert.match(page, /日级投放效率/);
  assert.match(page, /归因销售额/);
  assert.match(page, /无订单消耗/);
  assert.doesNotMatch(page, /className="ad-history"/);
  assert.match(page, /筛选 Listing、Campaign 或 Part/);
  assert.doesNotMatch(page, /className="workspace"/);
  assert.doesNotMatch(page, /className="ai-cadence"/);
  assert.doesNotMatch(page, /本阶段执行边界/);
  assert.doesNotMatch(page, /meta: "(?:今天|本月|Gate|每周|资料|V2|6\/6|\?)"/);
  assert.doesNotMatch(page, /item\.meta/);
  assert.match(styles, /--type-body:14px/);
  assert.match(styles, /\.action-list\.rich \.action-head\.selectable/);
});

test("organizes the operating product around five primary workspaces", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /label: "Dashboard"/);
  assert.match(page, /label: "日报"/);
  assert.match(page, /label: "广告"/);
  assert.match(page, /label: "计划与复盘"/);
  assert.match(page, /label: "商品与库存"/);
  assert.match(page, /PRIMARY_NAV[\s\S]*label: "日报"/);
  assert.match(page, /className="nav-submenu"/);
  assert.match(page, /广告管理器/);
  assert.match(page, /AI 优化/);
  assert.match(page, /运营计划/);
  assert.match(page, /复盘资料/);
  assert.match(page, /库存更新/);
  assert.match(page, /商品数据/);
  assert.doesNotMatch(page, /function SecondaryNav/);
  assert.doesNotMatch(page, /<SecondaryNav/);
  assert.doesNotMatch(page, /subpage-heading/);
  assert.doesNotMatch(styles, /\.secondary-nav/);
  assert.doesNotMatch(styles, /\.subpage-heading/);
  assert.match(styles, /\.nav-submenu/);
});

test("does not render dead button affordances in operating workspaces", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");
  const buttons = page.match(/<button\b[\s\S]*?<\/button>/g) || [];
  assert.ok(buttons.length > 10, "expected the workspace to expose real controls");
  for (const button of buttons) {
    assert.match(button, /onClick=/, `button is missing an action: ${button}`);
  }
  assert.match(page, /aria-label="打开6月复盘资料"/);
  assert.match(page, /aria-label="查看7月执行计划"/);
  assert.match(page, /aria-label="查看8月准备计划"/);
  assert.match(page, /aria-label="查看6月月度复盘"/);
  assert.match(page, /aria-label="返回7月执行计划"/);
  assert.doesNotMatch(page, /<button className="text-link">/);
});

test("keeps an API-backed advertising manager ahead of AI recommendations", async () => {
  const [page, ads] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Campaign 管理/);
  assert.match(page, /Listing 表现/);
  assert.match(page, /日级投放效率/);
  assert.match(page, /曝光/);
  assert.match(page, /点击/);
  assert.match(page, /CPC/);
  assert.match(page, /CTR/);
  assert.match(page, /CVR/);
  assert.match(page, /Daily Cap/);
  assert.match(page, /Bid/);
  assert.match(page, /归因销售额/);
  assert.match(page, /Retail 销售额/);
  assert.match(page, /Retail ROAS/);
  assert.match(page, /CPA/);
  assert.match(page, /Lifetime Budget/);
  assert.match(page, /Target ROAS/);
  assert.match(page, /投放周期/);
  assert.match(page, /商品名称 \/ 类目/);
  assert.match(ads, /CAMPAIGN_REPORT/);
  assert.match(ads, /LISTING_REPORT/);
  assert.match(ads, /campaign_daily_cap_USD/);
  assert.match(ads, /campaign_lifetime_budget_USD/);
  assert.match(ads, /campaign_start_date/);
  assert.match(ads, /campaign_end_date/);
  assert.match(ads, /target_roas_percentage/);
  assert.match(ads, /attributed_retail_sales_window_view_through_USD_Day_14/);
  assert.match(ads, /cpa:/);
  assert.match(ads, /product_default_bid/);
  assert.match(ads, /product_name/);
  assert.match(ads, /class_name/);
});

test("splits advertising optimization into a manual to-do list and AI one-click execution", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /手动优化 To-Do List/);
  assert.match(page, /AI 优化 · 一键执行/);
  assert.match(page, /Keyword Targeting/);
  assert.match(page, /\$750/);
  assert.match(page, /Product Targeting/);
  assert.match(page, /\$650/);
  assert.match(page, /DMOM1021/);
  assert.match(page, /filing cabinets/);
  assert.match(page, /关键词、否词、Campaign Cap 和 tROAS 保留人工执行/);
  assert.match(page, /仅对已通过 Gate 的 Listing Bid 与启停动作执行/);
  assert.match(styles, /\.optimization-mode-switch/);
  assert.match(styles, /\.keyword-allocation-grid/);
  assert.match(styles, /\.manual-todo-list/);
});

test("keeps Listing performance focused on search, filters, sorting and decision metrics", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");
  assert.match(page, /tab!=='listings'&&<section className="period-bar ad-period">/);
  assert.match(page, /tab==='manager'&&<>\s*<section className="stat-grid six ad-manager-kpis">/);
  assert.match(page, /tab==='listings'&&<section className="card ad-manager-card listing-performance-card"><div className="manager-filters">/);
  assert.match(page, /api-table listing-manager-table listing-performance-table/);
  const listingBranch = page.split("{tab==='listings'&&")[1]?.split("</section>}")[0] || "";
  assert.doesNotMatch(listingBranch, /section-head|manager-source|Retail 销售额|Retail ROAS|field="units"/);
});

test("gives advertising recommendations a readable action and evidence hierarchy", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className="recommendation-cell"/);
  assert.match(page, /className="recommendation-title"/);
  assert.match(page, /className="recommendation-reason"/);
  assert.match(page, /className="recommendation-evidence"/);
  assert.match(page, /className="recommendation-alerts"/);
  assert.match(styles, /\.recommendation-cell\{/);
  assert.match(styles, /\.recommendation-evidence>div\{/);
  assert.doesNotMatch(styles, /action-list\.rich article>div:nth-child\(4\)/);
});

test("shows AI campaign learning diagnostics and the operator escalation checklist", async () => {
  const [page, styles, ads] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
  ]);

  assert.match(ads, /aiCampaignDiagnostics/);
  assert.match(ads, /diagnoseAiCampaign/);
  assert.match(page, /AI Campaign 学习诊断/);
  assert.match(page, /14天归因订单/);
  assert.match(page, /联系 Account Manager/);
  assert.match(page, /状态冲突/);
  assert.match(page, /platformObservedAt/);
  assert.match(page, /学习期内禁止修改 tROAS、Daily Cap 与 Listing/);
  assert.match(page, /ai-learning-escalation/);
  assert.match(styles, /\.ai-campaign-diagnostics\{/);
  assert.match(styles, /\.ai-diagnosis-card\{/);
});

test("adds zombie campaign findings to the AI execution list without treating manual work as API executable", async () => {
  const [page, ads, queue] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/wayfair-ads.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ads/actions/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(ads, /detectZombieCampaigns/);
  assert.match(ads, /zombieAudit/);
  assert.match(page, /僵尸 Campaign 规则/);
  assert.match(page, /硬僵尸/);
  assert.match(page, /准僵尸/);
  assert.match(queue, /PAUSE_CAMPAIGN/);
  assert.match(queue, /CHECK_LISTING_ELIGIBILITY/);
  assert.match(queue, /CHECK_LOW_DELIVERY/);
  assert.match(queue, /API_ACTIONS = new Set\(\["SET_LISTING_BID", "SET_LISTING_ACTIVE"\]\)/);
});
