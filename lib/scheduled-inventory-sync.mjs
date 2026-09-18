/**
 * 定时库存：领星拉数（1 次/秒）→ 数量没变就跳过 → 变化才 dry-run + TRUE_UP。
 * 撞领星/Wayfair 限流时本轮放弃，下一窗口再试，不打断订单同步。
 */
const MIN_PULL_MS = 15 * 60 * 1000;
const STATE_KEY = "server:inventory-auto:last-run";

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

export async function runScheduledInventory({ origin, headers, db } = {}) {
  const jsonHeaders = new Headers(headers || {});
  jsonHeaders.set("content-type", "application/json");
  const now = Date.now();
  const previous = await readState(db);

  if (previous.pulledAt && now - Date.parse(previous.pulledAt) < MIN_PULL_MS - 30_000) {
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
    return {
      status: "rate-limited",
      step: "pull",
      error: String(pulled.error || "领星限流，本轮跳过"),
    };
  }
  if (!pull.ok || pulled.error || !pulled.snapshotId) {
    return {
      status: "failed",
      step: "pull",
      error: String(pulled.error || `领星拉取失败 HTTP ${pull.status}`),
    };
  }

  const mark = fingerprint(pulled.summary);
  const state = {
    pulledAt: new Date().toISOString(),
    snapshotId: pulled.snapshotId,
    fingerprint: mark,
    lastPushAt: previous.lastPushAt || null,
    lastPushedFingerprint: previous.lastPushedFingerprint || null,
  };

  if (mark && mark === previous.lastPushedFingerprint) {
    await writeState(db, { ...state, skipped: "unchanged" });
    return {
      status: "skipped",
      reason: "库存数量未变化，不向 Wayfair 重复 TRUE_UP",
      snapshotId: pulled.snapshotId,
      fingerprint: mark,
    };
  }

  const dry = await fetch(`${origin}/api/inventory/push`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify({ snapshotId: pulled.snapshotId, dryRun: true }),
  });
  const dryBody = await dry.json().catch(() => ({}));
  if (dry.status === 429 || isRateLimitError("", dryBody)) {
    await writeState(db, state);
    return {
      status: "rate-limited",
      step: "dry-run",
      snapshotId: pulled.snapshotId,
      error: String(dryBody.error || "Wayfair dry-run 限流，本轮跳过"),
    };
  }
  if (!dryBody.dryRunAccepted) {
    await writeState(db, state);
    return {
      status: "failed",
      step: "dry-run",
      snapshotId: pulled.snapshotId,
      error: String(dryBody.error || "Dry-run 未被 Wayfair 接受"),
      pushId: dryBody.pushId || null,
    };
  }

  const live = await fetch(`${origin}/api/inventory/push`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify({ snapshotId: pulled.snapshotId, dryRun: false }),
  });
  const liveBody = await live.json().catch(() => ({}));
  if (live.status === 429 || isRateLimitError("", liveBody)) {
    await writeState(db, state);
    return {
      status: "rate-limited",
      step: "live",
      snapshotId: pulled.snapshotId,
      error: String(liveBody.error || "Wayfair 正式推送限流，本轮跳过"),
    };
  }
  if (!live.ok || liveBody.error) {
    await writeState(db, state);
    return {
      status: "failed",
      step: "live",
      snapshotId: pulled.snapshotId,
      error: String(liveBody.error || `正式推送失败 HTTP ${live.status}`),
      pushId: liveBody.pushId || null,
    };
  }

  await writeState(db, {
    ...state,
    lastPushAt: new Date().toISOString(),
    lastPushedFingerprint: mark,
    pushId: liveBody.pushId,
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
