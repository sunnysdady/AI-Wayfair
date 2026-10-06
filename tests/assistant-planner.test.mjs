import assert from "node:assert/strict";
import test from "node:test";

import { answerAssistantChat } from "../lib/assistant-chat.mjs";
import { plannerInstructions, planAssistantCommands } from "../lib/assistant-planner.mjs";
import { validatePlannedCommands } from "../lib/assistant-search.mjs";

const ENV = { AI_MODEL_BASE_URL: "https://llm.example.test/v1", AI_MODEL_API_KEY: "k", AI_MODEL_NAME: "m" };
const NOW = () => "2026-10-06T07:51:00.000Z";

function modelReply(text) {
  return new Response(JSON.stringify({ output_text: text }));
}

test("validatePlannedCommands keeps whitelisted tools and drops unsafe or malformed ones", () => {
  const commands = validatePlannedCommands([
    { tool: "ad_spend", date: "2026-10-04" },
    { tool: "ad_spend", date: "2026-10-04" },
    { tool: "daily_sales", date: "2026-02-31" },
    { tool: "inventory_sku", sku: "MFC-D3-B" },
    { tool: "cost_sku", sku: "x; DROP TABLE orders" },
    { tool: "ad_spend", date_from: "2026-10-01", date_to: "2026-10-07" },
    { tool: "ad_spend", date_from: "2026-01-01", date_to: "2026-10-07" },
    { tool: "run_sql", sql: "select 1" },
    null,
  ]);
  assert.deepEqual(commands.map((c) => c.type), ["ad_spend", "inventory_sku", "ad_spend"]);
  assert.equal(commands[1].sku, "MFC-D3-B");
  assert.equal(commands[2].dateFrom, "2026-10-01");
  assert.equal(commands[2].date, null);
});

test("validatePlannedCommands caps the number of commands", () => {
  const many = ["daily_report", "tasks", "orders_recent", "reports", "ad_actions", "inventory_overview"].map((tool) => ({ tool }));
  assert.equal(validatePlannedCommands(many).length, 4);
});

test("planner prompt anchors relative dates to Beijing time", () => {
  assert.match(plannerInstructions("2026-10-06T07:51:00.000Z"), /北京时间 2026-10-06（星期二）/);
});

test("planAssistantCommands parses fenced JSON and validates the plan", async () => {
  const fetchImpl = async () => modelReply('```json\n{"commands":[{"tool":"daily_sales","date":"2026-10-04"},{"tool":"ad_spend","date":"2026-10-04"}]}\n```');
  const commands = await planAssistantCommands(ENV, { message: "查询字段：日期 2026-10-04 …", history: [] }, { fetchImpl, now: NOW });
  assert.deepEqual(commands.map((c) => c.type), ["daily_sales", "ad_spend"]);
});

test("planAssistantCommands rejects unparsable output so callers can fall back", async () => {
  const fetchImpl = async () => modelReply("我不知道");
  await assert.rejects(planAssistantCommands(ENV, { message: "你好呀", history: [] }, { fetchImpl, now: NOW }));
});

test("answerAssistantChat runs every planned command and feeds merged data to the answer model", async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (/意图规划器/.test(body.instructions)) {
      return modelReply('{"commands":[{"tool":"daily_sales","date":"2026-10-04"},{"tool":"ad_spend","date":"2026-10-04"}]}');
    }
    return modelReply("10/04 销售额 $822.95，广告花费 $56.38");
  };
  const executed = [];
  const search = async (_db, _input, searchOptions) => {
    executed.push(searchOptions.plannedCommand.type);
    return {
      answer: `${searchOptions.plannedCommand.type} 结果`,
      command: searchOptions.plannedCommand,
      resultCount: 1,
      sources: [searchOptions.plannedCommand.type],
      records: [{ source: searchOptions.plannedCommand.type, title: "t", reference: "r", detail: "d" }],
      searchedAt: NOW(),
    };
  };

  const reply = await answerAssistantChat({}, {
    message: "查询字段： - 日期：2026-10-04 - 数据源：CAMPAIGN_REPORT - 指标：Spend、Clicks、Impressions、14 天归因销售额、Orders",
  }, { processEnv: ENV, fetchImpl, now: NOW, search, usePlanner: true });

  assert.deepEqual(executed, ["daily_sales", "ad_spend"]);
  assert.equal(reply.mode, "model");
  assert.match(requests[1].instructions, /daily_sales 结果\nad_spend 结果/);
});

test("answerAssistantChat falls back to keyword search when the planner fails", async () => {
  const errors = [];
  let fallbackCalls = 0;
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (/意图规划器/.test(body.instructions)) return new Response("nope", { status: 500 });
    return modelReply("ok");
  };
  const search = async (_db, _input, searchOptions) => {
    assert.equal(searchOptions?.plannedCommand, undefined);
    fallbackCalls += 1;
    return { answer: "关键词结果", resultCount: 0, sources: [], records: [], searchedAt: NOW() };
  };
  const reply = await answerAssistantChat({}, { message: "DMOM1021 库存风险" }, {
    processEnv: ENV, fetchImpl, now: NOW, search, usePlanner: true, logger: { error: (m) => errors.push(m) },
  });
  assert.equal(fallbackCalls, 1);
  assert.equal(reply.mode, "model");
  assert.match(errors[0], /意图规划失败/);
});

test("long messages are truncated for retrieval instead of throwing", async () => {
  const seen = [];
  const search = async (_db, input) => {
    seen.push(input.query.length);
    return { answer: "x", resultCount: 0, sources: [], records: [], searchedAt: NOW() };
  };
  await answerAssistantChat({}, { message: "库存".repeat(300) }, { processEnv: {}, search });
  assert.deepEqual(seen, [120]);
});

test("system prompt and planner carry the operating mindset", async () => {
  const { assistantOperatingMindset } = await import("../lib/assistant-experience.mjs");
  const mindset = assistantOperatingMindset();
  assert.match(mindset, /TACOS/);
  assert.match(mindset, /归因窗口未成熟/);
  assert.match(mindset, /结论放第一句/);
  assert.match(plannerInstructions(NOW()), /补全对比数据/);
});

test("the answer prompt includes the operating mindset", async () => {
  let instructions = "";
  const fetchImpl = async (_url, init) => {
    instructions = JSON.parse(init.body).instructions;
    return modelReply("ok");
  };
  const search = async () => ({ answer: "a", resultCount: 0, sources: [], records: [], searchedAt: NOW() });
  await answerAssistantChat({}, { message: "昨天广告怎么样" }, { processEnv: ENV, fetchImpl, search });
  assert.match(instructions, /运营思维与回答方式/);
});

test("the answer prompt asks for Feishu plain-text formatting", async () => {
  let instructions = "";
  const fetchImpl = async (_url, init) => {
    instructions = JSON.parse(init.body).instructions;
    return modelReply("ok");
  };
  const search = async () => ({ answer: "a", resultCount: 0, sources: [], records: [], searchedAt: NOW() });
  await answerAssistantChat({}, { message: "昨天广告怎么样" }, { processEnv: ENV, fetchImpl, search });
  assert.match(instructions, /飞书纯文本/);
});

function recordingDb(calls, resultsFor) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async all() { return { results: resultsFor(sql) }; },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };
}

test("validatePlannedCommands accepts ranges for daily_sales and SKU-level ad spend", () => {
  const commands = validatePlannedCommands([
    { tool: "daily_sales", date_from: "2026-09-30", date_to: "2026-10-06" },
    { tool: "daily_sales", date_from: "2026-10-06", date_to: "2026-10-06" },
    { tool: "ad_spend_sku", sku: "dmom1021", date_from: "2026-10-01", date_to: "2026-10-05" },
    { tool: "ad_spend_sku", sku: "DMOM1021" },
    { tool: "ad_spend_sku", date: "2026-10-05" },
    { tool: "daily_sales", date_from: "2026-01-01", date_to: "2026-10-06" },
  ]);
  assert.deepEqual(commands.map((c) => c.type), ["daily_sales_range", "daily_sales", "ad_spend_sku", "ad_spend_sku"]);
  assert.equal(commands[2].sku, "DMOM1021");
  assert.equal(commands[3].dateFrom, null);
});

test("daily sales range sums every day and lists per-day revenue", async () => {
  const { searchAssistantKnowledge } = await import("../lib/assistant-search.mjs");
  const calls = [];
  const db = recordingDb(calls, (sql) => /GROUP BY 1/.test(sql) ? [
    { day: "2026-10-04", orders: 6, units: 7, revenue_cents: 82295 },
    { day: "2026-10-05", orders: 4, units: 5, revenue_cents: 61600 },
  ] : []);
  const [command] = validatePlannedCommands([{ tool: "daily_sales", date_from: "2026-10-04", date_to: "2026-10-05" }]);
  const result = await searchAssistantKnowledge(db, { query: "最近两天销量" }, { plannedCommand: command, idFactory: () => "a" });
  assert.match(result.answer, /合计销量 12 件、订单 10 个、销售额 \$1438\.95/);
  assert.match(result.answer, /10-04 \$822\.95/);
  assert.deepEqual(calls[0].values, ["2026-10-04", "2026-10-05"]);
});

test("SKU-level ad spend matches listing or part number and reports CPC and campaigns", async () => {
  const { searchAssistantKnowledge } = await import("../lib/assistant-search.mjs");
  const calls = [];
  const db = recordingDb(calls, (sql) => /GROUP BY payload::jsonb->>'campaign_id'/.test(sql)
    ? [{ campaign_name: "DMOM1021-宽二680", spend: "5.81" }]
    : [{ report_date: "2026-10-05", listing: "DMOM1021", spend: "6.13", clicks: "12", impressions: "800", attributed_sales: "0", attributed_orders: "0" }]);
  const [command] = validatePlannedCommands([{ tool: "ad_spend_sku", sku: "DMOM1021", date: "2026-10-05" }]);
  const result = await searchAssistantKnowledge(db, { query: "DMOM1021 昨天广告" }, { plannedCommand: command, idFactory: () => "a" });
  assert.match(result.answer, /DMOM1021（Listing DMOM1021）2026-10-05 广告花费合计 \$6\.13/);
  assert.match(result.answer, /CPC \$0\.51/);
  assert.match(result.answer, /DMOM1021-宽二680（\$5\.81）/);
  assert.match(calls[0].sql, /LISTING_REPORT/);
  assert.match(calls[0].sql, /first_10_part_numbers/);
  assert.deepEqual(calls[0].values, ["2026-10-05", "2026-10-05", "%DMOM1021%", "%DMOM1021%"]);
});

test("SKU-level ad spend says so when the listing has no ad rows", async () => {
  const { searchAssistantKnowledge } = await import("../lib/assistant-search.mjs");
  const db = recordingDb([], () => []);
  const [command] = validatePlannedCommands([{ tool: "ad_spend_sku", sku: "ZZZ999" }]);
  const result = await searchAssistantKnowledge(db, { query: "ZZZ999 广告" }, { plannedCommand: command, idFactory: () => "a" });
  assert.match(result.answer, /没有找到 ZZZ999/);
});

test("planner prompt treats vague time words as the last 7 days", () => {
  assert.match(plannerInstructions(NOW()), /模糊时间词.*最近 7 天/);
});

test("sku_economics expands a listing into part numbers and derives margin, cover days and break-even ROAS", async () => {
  const { searchAssistantKnowledge } = await import("../lib/assistant-search.mjs");
  const calls = [];
  const db = recordingDb(calls, (sql) => {
    if (/first_10_part_numbers' AS parts/.test(sql)) return [{ listing: "DMOM1021", parts: "LFC-2B-680, LFC-2W-680", report_date: "2026-10-05" }];
    if (/FROM sku_costs/.test(sql)) return [
      { part_number: "LFC-2B-680", unit_cost_cents: 6420, currency: "USD" },
      { part_number: "LFC-2W-680", unit_cost_cents: 6420, currency: "USD" },
    ];
    if (/FROM inventory_snapshot_rows/.test(sql)) return [
      { part_number: "LFC-2B", on_hand: 0, on_order: 0 },
      { part_number: "LFC-2W", on_hand: 102, on_order: 0 },
    ];
    if (/FROM order_items/.test(sql)) return [
      { part_number: "LFC-2B-680", units_30d: 10, units_90d: 68, revenue_cents_90d: 709080 },
      { part_number: "LFC-2W-680", units_30d: 6, units_90d: 37, revenue_cents_90d: 389400 },
    ];
    return [];
  });
  const [command] = validatePlannedCommands([{ tool: "sku_economics", sku: "DMOM1021" }]);
  const result = await searchAssistantKnowledge(db, { query: "DMOM1021 值不值" }, {
    plannedCommand: command, idFactory: () => "a", now: () => "2026-10-06T08:00:00.000Z",
  });
  assert.match(result.answer, /LFC-2B-680：成本 \$64\.20/);
  assert.match(result.answer, /推断匹配/);
  assert.match(result.answer, /LFC-2W-680：成本 \$64\.20，现货 102.*可售约 510 天/);
  // revenue 1,098,480 ; cost 105*6420 = 674,100 ; margin 38.6% ; break-even 1/0.386 = 2.59
  assert.match(result.answer, /实际毛利率 38\.6%/);
  assert.match(result.answer, /保本 WSC ROAS ≈ 2\.59×/);
  assert.match(result.answer, /LFC-2B-680：成本 \$64\.20，现货 0.*可售约 0 天/);
  assert.match(result.answer, /最紧张的子 SKU 可售约 0 天/);
  assert.deepEqual(calls.find((c) => /FROM order_items/.test(c.sql)).values.slice(0, 2), ["2026-09-06", "2026-07-08"]);
});

test("sku_economics falls back to the store margin estimate when a sold part has no cost", async () => {
  const { searchAssistantKnowledge } = await import("../lib/assistant-search.mjs");
  const db = recordingDb([], (sql) => {
    if (/first_10_part_numbers' AS parts/.test(sql)) return [{ listing: "DMOM1031", parts: "MFC-D03", report_date: "2026-10-05" }];
    if (/FROM order_items/.test(sql)) return [{ part_number: "MFC-D03", units_30d: 1, units_90d: 3, revenue_cents_90d: 30000 }];
    return [];
  });
  const [command] = validatePlannedCommands([{ tool: "sku_economics", sku: "MFC-D03" }]);
  const result = await searchAssistantKnowledge(db, { query: "MFC-D03 保本线" }, { plannedCommand: command, idFactory: () => "a", now: () => "2026-10-06T08:00:00.000Z" });
  assert.match(result.answer, /成本缺失/);
  assert.match(result.answer, /按店铺估算 28\.26%/);
  assert.match(result.answer, /3\.54×/);
});

test("sku_economics says so when the SKU is not in the ad report", async () => {
  const { searchAssistantKnowledge } = await import("../lib/assistant-search.mjs");
  const db = recordingDb([], () => []);
  const [command] = validatePlannedCommands([{ tool: "sku_economics", sku: "ZZZ999" }]);
  const result = await searchAssistantKnowledge(db, { query: "ZZZ999 经济账" }, { plannedCommand: command, idFactory: () => "a" });
  assert.match(result.answer, /找不到 ZZZ999/);
});

test("one failing data command is skipped while the others still answer", async () => {
  const errors = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (/意图规划器/.test(body.instructions)) {
      return modelReply('{"commands":[{"tool":"daily_sales","date":"2026-10-04"},{"tool":"ad_spend","date":"2026-10-04"}]}');
    }
    return modelReply("ok");
  };
  const search = async (_db, _input, searchOptions) => {
    if (searchOptions?.plannedCommand?.type === "daily_sales") throw new Error("db down");
    return { answer: "广告结果", command: searchOptions.plannedCommand, resultCount: 1, sources: ["ad_report"], records: [], searchedAt: NOW() };
  };
  const reply = await answerAssistantChat({}, { message: "昨天销量和广告" }, {
    processEnv: ENV, fetchImpl, now: NOW, search, usePlanner: true, logger: { error: (m) => errors.push(m) },
  });
  assert.equal(reply.mode, "model");
  assert.match(reply.knowledge.answer, /广告结果/);
  assert.match(errors[0], /取数失败 daily_sales: db down/);
});

test("planner prompt keeps store-wide sales out of single-SKU judgments", () => {
  const prompt = plannerInstructions(NOW());
  assert.match(prompt, /全店汇总，评估单个 SKU/);
  assert.match(prompt, /不要用于 DMOM 开头的 Listing 编号/);
});
