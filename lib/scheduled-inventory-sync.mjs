/**
 * 定时库存：领星拉数（每轮最多 1 次/15 分钟）→ 每小时最多向 Wayfair 推送一次。
 * 推送前先 dry-run，数量没变就跳过；变化才 TRUE_UP。
 * 撞领星/Wayfair 限流时本轮放弃，下一窗口再试，不打断订单同步。
 *
 * 推送节奏：成功、被安全闸门拦截、需要人工确认零库存，这三种情况都要等满 1 小时再试；
 * 限流或临时失败不占用这 1 小时，下一轮（15 分钟后）直接重试。
 */
const MIN_PULL_MS = 15 * 60 * 1000;
const MIN_PUSH_MS = 60 * 60 * 1000;
const WINDOW_GUARD_MS = 30_000;
const STATE_KEY = "server:inventory-auto:last-run";
// 与 /api/inventory/push 的零库存确认阈值保持一致。
const ZERO_RATIO_CONFIRM = 0.5;
// 零库存占比比上次成功推送高出这么多，就不再自动确认，留给人工。
const ZERO_RATIO_DRIFT = 0.1;

function fingerprint(summary = {}) {
  if (summary.qtyHash) return String(summary.qtyHash);
  return [
    summary.totalQuantityOnHand ?? "",
    summary.zeroStockRows ?? "",
    summary.totalRows ?? "",
    summary.stockRows ?? "",
  ].join("|");
}

function isRateLimitError(error, body = {}) {
  const message = String(error || body.error || body.message || "");
  const status = body.status || body.statusCode;
  return status === 429
    || /429|rate limit|too many|限流|过于频繁|throttl/i.test(message);
}

async function readState(db) {
  if (!db?.prepare) return {};
  const row = await db.prepare("SELECT value FROM sync_state WHERE key=?").bind(STATE_KEY).first();
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value);
  } catch {
    return {};
  }
}

async function writeState(db, value) {
  if (!db?.prepare) return;
  const updatedAt = new Date().toISOString();
  await db.prepare(
    "INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
  ).bind(STATE_KEY, JSON.stringify(value), updatedAt).run();
}

/** 上一次成功正式推送的零库存占比（含页面手动推送）；没有成功推送过则返回 null。 */
async function lastPushedZeroRatio(db) {
  if (!db?.prepare) return null;
  try {
    const run = await db.prepare(
      "SELECT snapshot_id FROM inventory_push_runs WHERE id NOT LIKE 'dryrun-%' AND status='completed' ORDER BY updated_at DESC LIMIT 1",
    ).first();
    if (!run?.snapshot_id) return null;
    const snapshot = await db.prepare("SELECT summary FROM inventory_snapshots WHERE id=?").bind(run.snapshot_id).first();
    const summary = JSON.parse(snapshot?.summary || "{}");
    const total = Number(summary.totalRows);
    const zero = Number(summary.zeroStockRows);
    return total > 0 && Number.isFinite(zero) ? zero / total : null;
  } catch {
    return null;
  }
}

function pushRecord(now, status, fields = {}) {
  return { at: new Date(now).toISOString(), status, ...fields };
}

export async function runScheduledInventory({ origin, headers, db } = {}) {
  const jsonHeaders = new Headers(headers || {});
  jsonHeaders.set("content-type", "application/json");
  const now = Date.now();
  const previous = await readState(db);

  if (previous.pulledAt && now - Date.parse(previous.pulledAt) < MIN_PULL_MS - WINDOW_GUARD_MS) {
    return {
      status: "skipped",
      reason: "领星库存拉取间隔未到（避免和看板同步叠限流）",
      lastPulledAt: previous.pulledAt,
    };
  }

  const pull = await fetch(`${origin}/api/inventory/sync`, {
    method: "POST",
    headers,
    cache: "no-store",
  });
  const pulled = await pull.json().catch(() => ({}));
  if (isRateLimitError("", pulled) || pull.status === 429) {
    const error = String(pulled.error || "领星限流，本轮跳过");
    await writeState(db, { ...previous, pullError: { at: new Date(now).toISOString(), error } });
    return { status: "rate-limited", step: "pull", error };
  }
  if (!pull.ok || pulled.error || !pulled.snapshotId) {
    const error = String(pulled.error || `领星拉取失败 HTTP ${pull.status}`);
    await writeState(db, { ...previous, pullError: { at: new Date(now).toISOString(), error } });
    return { status: "failed", step: "pull", error };
  }

  const mark = fingerprint(pulled.summary);
  // 推送相关字段原样带到下一轮，只有真正发生推送尝试时才改写。
  const state = {
    pulledAt: new Date(now).toISOString(),
    snapshotId: pulled.snapshotId,
    fingerprint: mark,
    lastPushAt: previous.lastPushAt || null,
    lastPushedFingerprint: previous.lastPushedFingerprint || null,
    pushId: previous.pushId || null,
    nextPushAfter: previous.nextPushAfter || null,
    push: previous.push || null,
  };
  const nextWindow = new Date(now + MIN_PUSH_MS).toISOString();
  const settle = (status, fields, holdWindow) => writeState(db, {
    ...state,
    push: pushRecord(now, status, fields),
    nextPushAfter: holdWindow ? nextWindow : state.nextPushAfter,
  });

  if (mark && mark === previous.lastPushedFingerprint) {
    await writeState(db, { ...state, skipped: "unchanged" });
    return {
      status: "skipped",
      reason: "库存数量未变化，不向 Wayfair 重复 TRUE_UP",
      snapshotId: pulled.snapshotId,
      fingerprint: mark,
    };
  }

  if (state.nextPushAfter && now < Date.parse(state.nextPushAfter) - WINDOW_GUARD_MS) {
    await writeState(db, state);
    return {
      status: "skipped",
      reason: "快照已更新；距上次推送不足 1 小时，等待下一个推送窗口",
      snapshotId: pulled.snapshotId,
      nextPushAfter: state.nextPushAfter,
    };
  }

  // 零库存占比高时，路由要求人工确认。定时任务只在占比没有明显高于
  // 上次成功推送（基线）时才代为确认；没有基线或占比突增，一律留给人工。
  const zeroRows = Number(pulled.summary?.zeroStockRows);
  const totalRows = Number(pulled.summary?.totalRows);
  const zeroRatio = totalRows > 0 && Number.isFinite(zeroRows) ? zeroRows / totalRows : 0;
  let zeroStockConfirmed = false;
  if (zeroRatio >= ZERO_RATIO_CONFIRM) {
    const baseline = await lastPushedZeroRatio(db);
    if (baseline === null || zeroRatio > baseline + ZERO_RATIO_DRIFT) {
      const error = baseline === null
        ? `零库存占比 ${Math.round(zeroRatio * 100)}%，且没有成功推送过的基线；请在页面人工确认并推送一次`
        : `零库存占比 ${Math.round(zeroRatio * 100)}%，比上次成功推送（${Math.round(baseline * 100)}%）高出过多；请人工核对后在页面推送`;
      await settle("needs-confirm", { step: "zero-stock", error, snapshotId: pulled.snapshotId }, true);
      return { status: "needs-confirm", step: "zero-stock", snapshotId: pulled.snapshotId, error };
    }
    zeroStockConfirmed = true;
  }

  const dry = await fetch(`${origin}/api/inventory/push`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify({ snapshotId: pulled.snapshotId, dryRun: true }),
  });
  const dryBody = await dry.json().catch(() => ({}));
  if (dry.status === 429 || isRateLimitError("", dryBody)) {
    const error = String(dryBody.error || "Wayfair dry-run 限流，本轮跳过");
    await settle("rate-limited", { step: "dry-run", error, snapshotId: pulled.snapshotId }, false);
    return { status: "rate-limited", step: "dry-run", snapshotId: pulled.snapshotId, error };
  }
  if (!dryBody.dryRunAccepted) {
    const error = String(dryBody.error || "Dry-run 未被 Wayfair 接受");
    await settle("failed", { step: "dry-run", error, snapshotId: pulled.snapshotId, pushId: dryBody.pushId || null }, false);
    return {
      status: "failed",
      step: "dry-run",
      snapshotId: pulled.snapshotId,
      error,
      pushId: dryBody.pushId || null,
    };
  }

  const live = await fetch(`${origin}/api/inventory/push`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify({ snapshotId: pulled.snapshotId, dryRun: false, zeroStockConfirmed }),
  });
  const liveBody = await live.json().catch(() => ({}));
  if (live.status === 429 || isRateLimitError("", liveBody)) {
    const error = String(liveBody.error || "Wayfair 正式推送限流，本轮跳过");
    await settle("rate-limited", { step: "live", error, snapshotId: pulled.snapshotId }, false);
    return { status: "rate-limited", step: "live", snapshotId: pulled.snapshotId, error };
  }
  if (live.status === 403) {
    // 安全闸门（环境变量/Supplier 清单）没放行：属于配置问题，重试没有意义，等下个整点窗口。
    const error = String(liveBody.error || "库存生产写入被安全闸门阻止");
    await settle("blocked", { step: "live", error, snapshotId: pulled.snapshotId }, true);
    return { status: "blocked", step: "live", snapshotId: pulled.snapshotId, error };
  }
  if (live.status === 400 && /零库存/.test(String(liveBody.error || ""))) {
    const error = String(liveBody.error);
    await settle("needs-confirm", { step: "zero-stock", error, snapshotId: pulled.snapshotId }, true);
    return { status: "needs-confirm", step: "zero-stock", snapshotId: pulled.snapshotId, error };
  }
  if (!live.ok || liveBody.error) {
    const error = String(liveBody.error || `正式推送失败 HTTP ${live.status}`);
    await settle("failed", { step: "live", error, snapshotId: pulled.snapshotId, pushId: liveBody.pushId || null }, false);
    return {
      status: "failed",
      step: "live",
      snapshotId: pulled.snapshotId,
      error,
      pushId: liveBody.pushId || null,
    };
  }

  await writeState(db, {
    ...state,
    lastPushAt: new Date(now).toISOString(),
    lastPushedFingerprint: mark,
    pushId: liveBody.pushId,
    nextPushAfter: nextWindow,
    push: pushRecord(now, "succeeded", {
      step: "live",
      snapshotId: pulled.snapshotId,
      pushId: liveBody.pushId,
      itemCount: liveBody.itemCount,
      feedStatus: liveBody.status,
    }),
  });
  return {
    status: "succeeded",
    snapshotId: pulled.snapshotId,
    pushId: liveBody.pushId,
    itemCount: liveBody.itemCount,
    feedStatus: liveBody.status,
    source: pulled.source || "lingxing-api",
  };
}
