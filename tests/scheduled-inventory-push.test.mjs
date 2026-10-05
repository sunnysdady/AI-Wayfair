import assert from "node:assert/strict";
import test from "node:test";
import { runScheduledInventory } from "../lib/scheduled-inventory-sync.mjs";

const STATE_KEY = "server:inventory-auto:last-run";
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * 内存版 D1 + fetch 桩：只覆盖定时库存用到的 SQL 与三个接口。
 * baseline = { totalRows, zeroStockRows } 表示"上一次成功正式推送"的快照摘要。
 */
function harness({ state = null, baseline = null, pulled, dry, live } = {}) {
  const store = new Map();
  if (state) store.set(STATE_KEY, JSON.stringify(state));
  const calls = [];
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() {
          if (sql.includes("FROM sync_state")) {
            const value = store.get(args[0]);
            return value ? { value } : null;
          }
          if (sql.includes("FROM inventory_push_runs")) return baseline ? { snapshot_id: "baseline-snapshot" } : null;
          if (sql.includes("FROM inventory_snapshots")) return baseline ? { summary: JSON.stringify(baseline) } : null;
          throw new Error(`unexpected SQL: ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT INTO sync_state")) store.set(args[0], args[1]);
          else throw new Error(`unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ path, body });
    if (path === "/api/inventory/sync") return pulled instanceof Response ? pulled.clone() : json(pulled);
    if (path === "/api/inventory/push") {
      const reply = body.dryRun === false ? live : dry;
      if (!reply) throw new Error(`no stub for push dryRun=${body.dryRun}`);
      return reply instanceof Response ? reply.clone() : json(reply);
    }
    throw new Error(`unexpected fetch ${path}`);
  };
  return {
    calls,
    state: () => JSON.parse(store.get(STATE_KEY)),
    patchState: (patch) => store.set(STATE_KEY, JSON.stringify({ ...JSON.parse(store.get(STATE_KEY)), ...patch })),
    run: () => runScheduledInventory({ origin: "https://example.test", headers: {}, db }),
    restore: () => { globalThis.fetch = realFetch; },
  };
}

const pull = (summary = {}) => ({
  snapshotId: "snap-1",
  source: "lingxing-api",
  summary: { qtyHash: "hash-a", totalRows: 430, zeroStockRows: 100, ...summary },
});
const dryOk = { dryRunAccepted: true, pushId: "dryrun-1" };
const liveOk = { pushId: "push-1", itemCount: 430, status: "completed" };
const pushCalls = (h, dryRun) => h.calls.filter((c) => c.path === "/api/inventory/push" && c.body.dryRun === dryRun);

test("首次推送成功：记录结果，并把下一次推送窗口锁到 1 小时后", async () => {
  const h = harness({ pulled: pull(), dry: dryOk, live: liveOk });
  try {
    const before = Date.now();
    const result = await h.run();
    assert.equal(result.status, "succeeded");
    assert.equal(pushCalls(h, true).length, 1);
    assert.equal(pushCalls(h, false).length, 1);
    assert.equal(pushCalls(h, false)[0].body.zeroStockConfirmed, false);
    const state = h.state();
    assert.equal(state.push.status, "succeeded");
    assert.equal(state.lastPushedFingerprint, "hash-a");
    const wait = Date.parse(state.nextPushAfter) - before;
    assert.ok(wait >= HOUR - 5000 && wait <= HOUR + 5000, `nextPushAfter 应在约 1 小时后，实际 ${wait}ms`);
  } finally { h.restore(); }
});

test("1 小时窗口内：照常拉取并更新快照，但不向 Wayfair 推送", async () => {
  const future = new Date(Date.now() + 40 * MIN).toISOString();
  const h = harness({
    state: { pulledAt: new Date(Date.now() - 20 * MIN).toISOString(), snapshotId: "old", fingerprint: "hash-old", lastPushedFingerprint: "hash-old", nextPushAfter: future },
    pulled: pull(),
  });
  try {
    const result = await h.run();
    assert.equal(result.status, "skipped");
    assert.match(result.reason, /不足 1 小时/);
    assert.equal(h.calls.filter((c) => c.path === "/api/inventory/push").length, 0);
    const state = h.state();
    assert.equal(state.snapshotId, "snap-1");
    assert.equal(state.nextPushAfter, future);
  } finally { h.restore(); }
});

test("窗口到点后会再次推送", async () => {
  const h = harness({
    state: { pulledAt: new Date(Date.now() - 20 * MIN).toISOString(), lastPushedFingerprint: "hash-old", nextPushAfter: new Date(Date.now() - MIN).toISOString() },
    pulled: pull(),
    dry: dryOk,
    live: liveOk,
  });
  try {
    assert.equal((await h.run()).status, "succeeded");
  } finally { h.restore(); }
});

test("数量没变化：不重复 TRUE_UP", async () => {
  const h = harness({
    state: { pulledAt: new Date(Date.now() - 20 * MIN).toISOString(), lastPushedFingerprint: "hash-a" },
    pulled: pull(),
  });
  try {
    const result = await h.run();
    assert.equal(result.status, "skipped");
    assert.equal(h.calls.filter((c) => c.path === "/api/inventory/push").length, 0);
  } finally { h.restore(); }
});

test("安全闸门拦截(403)：记为 blocked，并等满 1 小时，不再每 15 分钟重试", async () => {
  const h = harness({
    pulled: pull(),
    dry: dryOk,
    live: json({ error: "生产写入被安全闸门阻止：Inventory 正式写入开关未启用" }, 403),
  });
  try {
    const first = await h.run();
    assert.equal(first.status, "blocked");
    assert.match(first.error, /安全闸门/);
    const state = h.state();
    assert.equal(state.push.status, "blocked");
    assert.equal(state.lastPushedFingerprint, null);
    assert.ok(Date.parse(state.nextPushAfter) > Date.now() + 55 * MIN);

    // 15 分钟后的下一轮：只拉取，不再 dry-run / 推送
    h.patchState({ pulledAt: new Date(Date.now() - 16 * MIN).toISOString() });
    const callsBefore = h.calls.length;
    const second = await h.run();
    assert.equal(second.status, "skipped");
    assert.equal(h.calls.slice(callsBefore).filter((c) => c.path === "/api/inventory/push").length, 0);
    assert.equal(h.state().push.status, "blocked");
  } finally { h.restore(); }
});

test("限流或临时失败不占用 1 小时窗口，下一轮直接重试", async () => {
  for (const live of [json({ error: "429 too many requests" }, 429), json({ error: "Wayfair 库存批次未全部成功" }, 422)]) {
    const h = harness({ pulled: pull(), dry: dryOk, live });
    try {
      const result = await h.run();
      assert.ok(["rate-limited", "failed"].includes(result.status), result.status);
      const state = h.state();
      assert.equal(state.nextPushAfter, null);
      assert.equal(state.push.status, result.status);
      assert.equal(state.lastPushedFingerprint, null);
    } finally { h.restore(); }
  }
});

test("零库存占比≥50% 且没有成功推送过的基线：不自动确认，也不白跑 dry-run", async () => {
  const h = harness({ pulled: pull({ zeroStockRows: 235 }), dry: dryOk, live: liveOk, baseline: null });
  try {
    const result = await h.run();
    assert.equal(result.status, "needs-confirm");
    assert.match(result.error, /没有成功推送过的基线/);
    assert.equal(h.calls.filter((c) => c.path === "/api/inventory/push").length, 0);
    assert.equal(h.state().push.status, "needs-confirm");
  } finally { h.restore(); }
});

test("零库存占比高但与上次成功推送接近：代为确认并推送", async () => {
  const h = harness({
    pulled: pull({ zeroStockRows: 235 }),
    dry: dryOk,
    live: liveOk,
    baseline: { totalRows: 430, zeroStockRows: 225 },
  });
  try {
    const result = await h.run();
    assert.equal(result.status, "succeeded");
    assert.equal(pushCalls(h, false)[0].body.zeroStockConfirmed, true);
  } finally { h.restore(); }
});

test("零库存占比比上次成功推送高出超过 10 个百分点：交给人工", async () => {
  const h = harness({
    pulled: pull({ zeroStockRows: 235 }),
    dry: dryOk,
    live: liveOk,
    baseline: { totalRows: 430, zeroStockRows: 86 },
  });
  try {
    const result = await h.run();
    assert.equal(result.status, "needs-confirm");
    assert.match(result.error, /高出过多/);
    assert.equal(h.calls.filter((c) => c.path === "/api/inventory/push").length, 0);
  } finally { h.restore(); }
});

test("领星拉取失败会写入状态，供页面展示；下次拉取成功后自动清除", async () => {
  const failing = harness({ pulled: json({ error: "领星鉴权失败" }, 500) });
  try {
    const result = await failing.run();
    assert.equal(result.status, "failed");
    assert.equal(failing.state().pullError.error, "领星鉴权失败");
  } finally { failing.restore(); }

  const recovering = harness({
    state: { pulledAt: new Date(Date.now() - 20 * MIN).toISOString(), pullError: { at: "x", error: "旧错误" } },
    pulled: pull(),
    dry: dryOk,
    live: liveOk,
  });
  try {
    await recovering.run();
    assert.equal(recovering.state().pullError, undefined);
  } finally { recovering.restore(); }
});

test("预览接口返回自动任务状态，页面展示拉取/推送结果与下次推送时间", async () => {
  const { readFile } = await import("node:fs/promises");
  const [route, page] = await Promise.all([
    readFile(new URL("../app/api/inventory/preview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /server:inventory-auto:last-run/);
  assert.match(route, /nextPushAfter/);
  assert.match(route, /auto\s*\}\)|,auto\)|auto\}\)/);
  assert.match(page, /data-testid="inventory-auto-status"/);
  assert.match(page, /自动推送 Wayfair（每小时一次）/);
  assert.match(page, /被安全闸门拦截/);
  assert.match(page, /需人工确认零库存/);
});
