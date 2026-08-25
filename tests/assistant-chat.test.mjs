import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AssistantChatInputError,
  answerAssistantChat,
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
  assert.match(payload.instructions, /跨平台运营方法论/);
  assert.match(payload.instructions, /不能当作 Wayfair 业务事实或阈值/);
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
  assert.match(navigation, /\{ id: "assistant", label: "AI 助理" \}/);
  assert.doesNotMatch(navigation, />数据助理</);
});
