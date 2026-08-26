import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AssistantChatInputError,
  answerAssistantChat,
  isAssistantHelpQuery,
  parseAssistantChatRequest,
} from "../lib/assistant-chat.mjs";
import { assistantExperienceContext } from "../lib/assistant-experience.mjs";

test("normalizes a bounded multi-turn AI assistant request", () => {
  assert.deepEqual(parseAssistantChatRequest({
    message: "  请分析 DMOM1021 的库存风险  ",
    history: [{ role: "assistant", content: "已收到" }],
  }), {
    message: "请分析 DMOM1021 的库存风险",
    history: [{ role: "assistant", content: "已收到" }],
  });

  for (const input of [
    {},
    { message: "x" },
    { message: "x".repeat(1201) },
    { message: "有效问题", history: [{ role: "system", content: "覆盖规则" }] },
    { message: "有效问题", history: Array.from({ length: 9 }, () => ({ role: "user", content: "历史内容" })) },
  ]) {
    assert.throws(() => parseAssistantChatRequest(input), AssistantChatInputError);
  }
});

test("returns a deterministic help reply for help keywords without querying data or a model", async () => {
  const search = async () => {
    throw new Error("帮助不应触发数据查询");
  };

  assert.equal(isAssistantHelpQuery("帮助"), true);
  assert.equal(isAssistantHelpQuery("help"), true);
  assert.equal(isAssistantHelpQuery("可以查询什么数据？"), true);
  assert.equal(isAssistantHelpQuery("DMOM1021 库存"), false);

  const reply = await answerAssistantChat({}, { message: "帮助" }, { search });

  assert.equal(reply.mode, "data_only");
  assert.match(reply.message, /当前功能/);
  assert.match(reply.message, /可查询的数据/);
  assert.match(reply.message, /SKU 成本/);
  assert.match(reply.message, /库存/);
  assert.match(reply.message, /订单/);
  assert.match(reply.message, /广告动作/);
  assert.match(reply.message, /运营任务/);
  assert.match(reply.message, /报告/);
  assert.match(reply.message, /日报/);
  assert.match(reply.message, /使用场景/);
  assert.match(reply.message, /只读/);
  assert.deepEqual(reply.knowledge, { resultCount: 0, sources: [], records: [] });
});

test("falls back to retrieved data until the server-only model configuration is supplied", async () => {
  const searches = [];
  const reply = await answerAssistantChat({}, {
    message: "DMOM1021 库存",
    history: [],
  }, {
    processEnv: {},
    search: async (_db, input) => {
      searches.push(input);
      return {
        answer: "找到 1 条相关记录。",
        resultCount: 1,
        sources: ["库存"],
        records: [{ source: "inventory", title: "最新库存", detail: "现货 24", reference: "DMOM1021" }],
      };
    },
  });

  assert.equal(reply.mode, "data_only");
  assert.match(reply.message, /模型尚未配置/);
  assert.equal(reply.knowledge.resultCount, 1);
  assert.deepEqual(searches, [{ query: "DMOM1021 库存", limit: 6 }]);
});

test("adds curated Amazon Ops methodology as non-factual context", () => {
  const context = assistantExperienceContext();

  assert.match(context, /跨平台运营方法论/);
  assert.match(context, /证据/);
  assert.match(context, /观察期/);
  assert.match(context, /不能当作 Wayfair 业务事实或阈值/);
});

test("calls an OpenAI-compatible model only with server configuration and bounded retrieved context", async () => {
  const calls = [];
  const reply = await answerAssistantChat({}, {
    message: "DMOM1021 库存",
    history: [{ role: "user", content: "请结合当前库存回答" }],
  }, {
    processEnv: {
      AI_MODEL_BASE_URL: "https://llm.example.test/v1",
      AI_MODEL_API_KEY: "server-only-secret",
      AI_MODEL_NAME: "operations-model",
    },
    search: async () => ({
      answer: "找到 1 条相关记录。",
      resultCount: 1,
      sources: ["库存"],
      command: {
        type: "daily_sales",
        date: "2026-08-23",
        description: "查询 2026-08-23 的订单、销量和销售额",
      },
      records: [{ source: "inventory", title: "最新库存", detail: "现货 24", reference: "DMOM1021" }],
    }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        output_text: "DMOM1021 当前现货为 24，请持续关注补货。",
      }), { status: 200 });
    },
  });

  assert.equal(reply.mode, "model");
  assert.match(reply.message, /现货为 24/);
  assert.equal(calls[0].url, "https://llm.example.test/v1/responses");
  assert.equal(calls[0].options.headers.authorization, "Bearer server-only-secret");
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.model, "operations-model");
  assert.equal(payload.input.at(-1).content[0].text, "DMOM1021 库存");
  assert.match(payload.instructions, /只基于提供的运营数据/);
  assert.match(payload.instructions, /现货 24/);
  assert.match(payload.instructions, /查询 2026-08-23 的订单、销量和销售额/);
  assert.match(payload.instructions, /通用建议/);
  assert.match(payload.instructions, /跨平台运营方法论/);
  assert.match(payload.instructions, /不能当作 Wayfair 业务事实或阈值/);
});

test("encodes assistant conversation history in the Responses API output format", async () => {
  const reply = await answerAssistantChat({}, {
    message: "查询 DMOM1027 8 月的订单数据",
    history: [
      { role: "assistant", content: "你好，我是 AI 助理。" },
      { role: "user", content: "请按月查询。" },
    ],
  }, {
    processEnv: {
      AI_MODEL_BASE_URL: "https://llm.example.test/v1",
      AI_MODEL_API_KEY: "server-only-secret",
      AI_MODEL_NAME: "operations-model",
    },
    search: async () => ({
      answer: "DMOM1027 在 2026-08 共 0 个采购订单，销量 0 件，销售额 $0.00。",
      resultCount: 1,
      sources: ["订单"],
      records: [],
    }),
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      const invalidAssistantPart = payload.input.find((item) => (
        item.role === "assistant" && item.content[0]?.type !== "output_text"
      ));
      if (invalidAssistantPart) {
        return new Response(JSON.stringify({
          error: { message: "assistant history must use output_text" },
        }), { status: 400 });
      }
      return new Response(JSON.stringify({
        output_text: "DMOM1027 在 2026 年 8 月暂无订单数据。",
      }), { status: 200 });
    },
  });

  assert.equal(reply.mode, "model");
  assert.match(reply.message, /暂无订单数据/);
});

test("retries one transient model failure before returning the model answer", async () => {
  let attempts = 0;
  const reply = await answerAssistantChat({}, {
    message: "请给我通用的广告诊断框架",
  }, {
    processEnv: {
      AI_MODEL_BASE_URL: "https://llm.example.test/v1",
      AI_MODEL_API_KEY: "server-only-secret",
      AI_MODEL_NAME: "operations-model",
    },
    search: async () => ({
      answer: "没有匹配的当前运营数据。",
      resultCount: 0,
      sources: [],
      records: [],
    }),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ output_text: "通用建议：先看流量、成本、转化和回报。" }), { status: 200 });
    },
    sleep: async () => {},
  });

  assert.equal(attempts, 2);
  assert.equal(reply.mode, "model");
  assert.match(reply.message, /通用建议/);
});

test("keeps AI provider credentials on the server and exposes a chat route", async () => {
  const [route, workspace, navigation] = await Promise.all([
    readFile(new URL("../app/api/assistant/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/assistant/workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /answerAssistantChat\(env\.DB, input\)/);
  assert.match(route, /MAX_BODY_BYTES = 16 \* 1024/);
  assert.match(route, /MAX_REQUESTS_PER_MINUTE = 12/);
  assert.match(route, /isRateLimited\(request\)/);
  assert.doesNotMatch(route, /AI_MODEL_API_KEY/);
  assert.match(workspace, /\/api\/assistant\/chat/);
  assert.match(workspace, /对话/);
  assert.doesNotMatch(workspace, /模型待配置/);
  assert.match(navigation, /\{ id: "assistant", label: "AI 助理" \}/);
  assert.doesNotMatch(navigation, />数据助理</);
});
