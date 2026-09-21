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

test("translates a natural-language date and sales question into a bounded daily-sales query", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async all() {
              return {
                results: [{
                  sales_day: "2026-08-23",
                  orders: 4,
                  units: 6,
                  revenue_cents: 56550,
                }],
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

  const result = await searchAssistantKnowledge(db, { query: "8.23 的销量是多少" }, {
    now: () => "2026-08-25T08:00:00.000Z",
    idFactory: () => "audit-daily-sales",
  });

  assert.deepEqual(result.command, {
    type: "daily_sales",
    date: "2026-08-23",
    description: "查询 2026-08-23 的订单、销量和销售额",
  });
  assert.equal(result.resultCount, 1);
  assert.match(result.answer, /2026-08-23 的销量为 6 件/);
  assert.match(calls[0].sql, /FROM orders/);
  assert.match(calls[0].sql, /Etc\/GMT\+4/);
  assert.deepEqual(calls[0].values, ["2026-08-23"]);
  assert.deepEqual(calls[1].values, ["audit-daily-sales", "8.23 的销量是多少", 1, "2026-08-25T08:00:00.000Z"]);
});

test("translates a SKU and month order request into a bounded SKU-month query", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async all() {
              return {
                results: [{
                  part_number: "DMOM1027",
                  orders: 3,
                  units: 7,
                  revenue_cents: 12345,
                }],
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
    query: "查询DMOM1027 8 月的订单数据",
  }, {
    now: () => "2026-08-25T08:00:00.000Z",
    idFactory: () => "audit-sku-month-orders",
  });

  assert.deepEqual(result.command, {
    type: "sku_month_orders",
    sku: "DMOM1027",
    month: "2026-08",
    description: "查询 SKU DMOM1027 在 2026-08 的订单、销量和销售额",
  });
  assert.equal(result.resultCount, 1);
  assert.match(result.answer, /DMOM1027 在 2026-08 共 3 个采购订单/);
  assert.match(result.answer, /销量 7 件/);
  assert.match(result.answer, /销售额 \$123\.45/);
  assert.match(calls[0].sql, /JOIN order_items/);
  assert.match(calls[0].sql, /Etc\/GMT\+4/);
  assert.deepEqual(calls[0].values, ["DMOM1027", "2026-08-01"]);
  assert.deepEqual(calls[1].values, ["audit-sku-month-orders", "查询DMOM1027 8 月的订单数据", 1, "2026-08-25T08:00:00.000Z"]);
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

test("keeps assistant search read-only and only exposed through the Lark bot", async () => {
  const [larkBot, webhook] = await Promise.all([
    readFile(new URL("../lib/lark-bot.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/lark/webhook/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(larkBot, /answerAssistantChat\(env\.DB, /);
  assert.doesNotMatch(larkBot, /request\.json\(\)/);
  assert.doesNotMatch(larkBot, /export async function (GET|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(webhook, /export async function (GET|PUT|PATCH|DELETE)/);
});

test("detects intent domains from natural-language queries", async () => {
  const { detectIntent } = await import("../lib/assistant-search.mjs");
  assert.equal(detectIntent("DMOM1027 的库存是多少"), "inventory");
  assert.equal(detectIntent("最近广告怎么样"), "ad");
  assert.equal(detectIntent("今天的日报"), "daily");
  assert.equal(detectIntent("有哪些缺货的SKU"), "inventory");
  assert.equal(detectIntent("这个SKU成本多少"), "cost");
  assert.equal(detectIntent("帮我看看最近订单"), "order");
});

test("resolves SKU inventory intent into a bounded latest-snapshot inventory query", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async all() {
              return {
                results: [{
                  part_number: "DMOM1027",
                  quantity_on_hand: 3,
                  quantity_on_order: 12,
                  warehouse: "US",
                  created_at: "2026-09-21T09:00:08.504Z",
                }],
              };
            },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };

  const result = await searchAssistantKnowledge(db, { query: "DMOM1027 的库存是多少" }, {
    now: () => "2026-09-21T10:00:00.000Z",
    idFactory: () => "audit-inventory-sku",
  });

  assert.equal(result.resultCount, 1);
  assert.equal(result.command.type, "inventory_sku");
  assert.match(result.answer, /DMOM1027 当前库存/);
  assert.match(result.answer, /现货 3/);
  assert.match(result.answer, /在途 12/);
  assert.match(calls[0].sql, /inventory_snapshot_rows/);
  assert.deepEqual(calls[0].values, ["%DMOM1027%", 8]);
  assert.deepEqual(calls[1].values, ["audit-inventory-sku", "DMOM1027 的库存是多少", 1, "2026-09-21T10:00:00.000Z"]);
});

test("resolves shortage intent into a zero-on-hand SKU list query", async () => {
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
                    part_number: "DMOM1001",
                    quantity_on_hand: 0,
                    quantity_on_order: 5,
                    warehouse: "US",
                    created_at: "2026-09-21T09:00:08.504Z",
                  },
                  {
                    part_number: "DMOM1002",
                    quantity_on_hand: 0,
                    quantity_on_order: 0,
                    warehouse: "US",
                    created_at: "2026-09-21T09:00:08.504Z",
                  },
                ],
              };
            },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };

  const result = await searchAssistantKnowledge(db, { query: "有哪些缺货的SKU" }, {
    now: () => "2026-09-21T10:00:00.000Z",
    idFactory: () => "audit-shortage",
  });

  assert.equal(result.command.type, "inventory_shortage");
  assert.equal(result.resultCount, 2);
  assert.match(result.answer, /缺货/);
  assert.match(result.answer, /DMOM1001/);
  assert.match(calls[0].sql, /quantity_on_hand = 0/);
  assert.deepEqual(calls[0].values, [8]);
  assert.deepEqual(calls[1].values, ["audit-shortage", "有哪些缺货的SKU", 2, "2026-09-21T10:00:00.000Z"]);
});

test("resolves daily-report intent into the latest operating report and Outlook brief", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async all() {
              if (sql.includes("daily_operating_reports")) {
                return {
                  results: [{
                    report_date: "2026-09-20",
                    payload: JSON.stringify({
                      performance: {
                        daily: { orders: 2, units: 2, revenue: 266.13, adSpend: 24.17, contributionAfterAds: 84.21 },
                        delta: { orders: 0 },
                      },
                    }),
                    generated_at: "2026-09-21T00:00:00.086Z",
                  }],
                };
              }
              if (sql.includes("outlook_daily_briefs")) {
                return {
                  results: [{
                    brief_date: "2026-09-20",
                    payload: JSON.stringify({ summary: { total: 4, actionRequired: 3, highestPriority: "P1" } }),
                    synced_at: "2026-09-21T00:00:00.086Z",
                  }],
                };
              }
              return { results: [] };
            },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };

  const result = await searchAssistantKnowledge(db, { query: "今天的日报" }, {
    now: () => "2026-09-21T10:00:00.000Z",
    idFactory: () => "audit-daily-report",
  });

  assert.equal(result.command.type, "daily_report");
  assert.equal(result.resultCount, 2);
  assert.match(result.answer, /运营日报（2026-09-20）/);
  assert.match(result.answer, /订单 2/);
  assert.match(result.answer, /收入 \$266\.13/);
  assert.match(result.answer, /Outlook 日报（2026-09-20）/);
  assert.match(result.answer, /待处理 3 项/);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].values, ["audit-daily-report", "今天的日报", 2, "2026-09-21T10:00:00.000Z"]);
});

test("resolves ad/task/order/report/cost intents into bounded recent-list queries", async () => {
  const scenarios = [
    { query: "最近广告怎么样", type: "ad_actions", table: /ad_action_queue/ },
    { query: "有哪些待办任务", type: "tasks", table: /operations/ },
    { query: "最近的订单", type: "orders_recent", table: /FROM orders/ },
    { query: "有哪些报告", type: "reports", table: /report_uploads/ },
    { query: "DMOM1027 成本多少", type: "cost_sku", table: /sku_costs/ },
  ];
  for (const scenario of scenarios) {
    const calls = [];
    const db = {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values });
            return {
              async all() {
                return {
                  results: [{
                    part_number: "DMOM1027", listing: "DMOM1027", id: "op-1",
                    title: "示例任务", owner: "测试", status: "DISCOVERED",
                    po_number: "PO-1", po_date: "2026-09-20T00:00:00Z", units: 1,
                    revenue_cents: 1000, kind: "CSV", file_name: "a.csv",
                    unit_cost_cents: 500, currency: "UNVERIFIED", updated_at: "2026-09-20",
                    action_type: "PAUSE", campaign_id: "622727",
                  }],
                };
              },
              async run() { return { success: true }; },
            };
          },
        };
      },
    };
    const result = await searchAssistantKnowledge(db, { query: scenario.query }, {
      now: () => "2026-09-21T10:00:00.000Z",
      idFactory: () => "audit-scenario",
    });
    assert.equal(result.command.type, scenario.type, `command type for ${scenario.query}`);
    assert.match(calls[0].sql, scenario.table, `sql table for ${scenario.query}`);
  }
});
