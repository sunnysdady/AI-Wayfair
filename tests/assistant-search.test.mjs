import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AssistantSearchInputError,
  parseAssistantSearchRequest,
  searchAssistantKnowledge,
} from "../lib/assistant-search.mjs";

test("normalizes a bounded assistant search request", () => {
  assert.deepEqual(parseAssistantSearchRequest({
    query: "  DMOM1021   库存 ",
    limit: 4,
  }), {
    query: "DMOM1021 库存",
    limit: 4,
  });
  assert.deepEqual(parseAssistantSearchRequest({ query: "DMOM1021" }), {
    query: "DMOM1021",
    limit: 8,
  });
});

test("rejects unsafe or oversized assistant search requests", () => {
  for (const input of [
    {},
    { query: "x" },
    { query: "x".repeat(121) },
    { query: "DMOM1021", limit: 0 },
    { query: "DMOM1021", limit: 13 },
    { query: "DMOM1021", limit: "8" },
  ]) {
    assert.throws(() => parseAssistantSearchRequest(input), AssistantSearchInputError);
  }
});

test("searches saved operational data with bound parameters and writes a minimal audit record", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async all() {
              return {
                results: [
                  {
                    source: "inventory",
                    reference: "DMOM1021",
                    title: "最新库存",
                    detail: "现货 24 · 在途 12 · 仓库 US",
                    occurredAt: "2026-08-25T00:00:00.000Z",
                  },
                  {
                    source: "operation",
                    reference: "op-001",
                    title: "核查 DMOM1021 库存",
                    detail: "DISCOVERED · 待分派",
                    occurredAt: "2026-08-24T00:00:00.000Z",
                  },
                ],
              };
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };

  const result = await searchAssistantKnowledge(db, {
    query: "DMOM1021",
    limit: 6,
  }, {
    now: () => "2026-08-25T08:00:00.000Z",
    idFactory: () => "audit-001",
  });

  assert.equal(result.resultCount, 2);
  assert.deepEqual(result.sources, ["库存", "运营任务"]);
  assert.match(result.answer, /2 条/);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /inventory_snapshot_rows/);
  assert.match(calls[0].sql, /operations/);
  assert.match(calls[0].sql, /ILIKE \? ESCAPE/);
  assert.ok(calls[0].values.every((value, index) => index === calls[0].values.length - 1 || value === "%DMOM1021%"));
  assert.equal(calls[0].values.at(-1), 6);
  assert.match(calls[1].sql, /INSERT INTO assistant_query_audit/);
  assert.deepEqual(calls[1].values, ["audit-001", "DMOM1021", 2, "2026-08-25T08:00:00.000Z"]);
});

test("returns a transparent no-result answer while still auditing the lookup", async () => {
  const writes = [];
  const db = {
    prepare() {
      return {
        bind(...values) {
          return {
            async all() {
              return { results: [] };
            },
            async run() {
              writes.push(values);
              return { success: true };
            },
          };
        },
      };
    },
  };

  const result = await searchAssistantKnowledge(db, { query: "未命中" });

  assert.equal(result.resultCount, 0);
  assert.deepEqual(result.sources, []);
  assert.match(result.answer, /未在已同步的数据中找到/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], "未命中");
});

test("keeps the assistant API read-only, same-origin, and body-bounded", async () => {
  const route = await readFile(new URL("../app/api/assistant/search/route.ts", import.meta.url), "utf8");
  assert.match(route, /function sameOrigin/);
  assert.match(route, /MAX_BODY_BYTES = 4 \* 1024/);
  assert.match(route, /searchAssistantKnowledge\(env\.DB, input\)/);
  assert.match(route, /cache-control.*private, max-age=60/);
  assert.doesNotMatch(route, /export async function (GET|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /request\.json\(\)/);
});
