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
