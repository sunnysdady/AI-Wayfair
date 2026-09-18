/**
 * 定时：领星拉库存 → Wayfair dry-run → 通过后正式 TRUE_UP。
 * 失败不抛到外层（由 cron 记入结果），避免挡住订单/邮件同步。
 */
export async function runScheduledInventory({ origin, headers }) {
  const jsonHeaders = new Headers(headers);
  jsonHeaders.set("content-type", "application/json");

  const pull = await fetch(`${origin}/api/inventory/sync`, {
    method: "POST",
    headers,
    cache: "no-store",
  });
  const pulled = await pull.json().catch(() => ({}));
  if (!pull.ok || pulled.error || !pulled.snapshotId) {
    return {
      status: "failed",
      step: "pull",
      error: String(pulled.error || `领星拉取失败 HTTP ${pull.status}`),
    };
  }

  const snapshotId = pulled.snapshotId;
  const dry = await fetch(`${origin}/api/inventory/push`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify({ snapshotId, dryRun: true }),
  });
  const dryBody = await dry.json().catch(() => ({}));
  if (!dryBody.dryRunAccepted) {
    return {
      status: "failed",
      step: "dry-run",
      snapshotId,
      error: String(dryBody.error || "Dry-run 未被 Wayfair 接受"),
      pushId: dryBody.pushId || null,
    };
  }

  const live = await fetch(`${origin}/api/inventory/push`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify({ snapshotId, dryRun: false }),
  });
  const liveBody = await live.json().catch(() => ({}));
  if (!live.ok || liveBody.error) {
    return {
      status: "failed",
      step: "live",
      snapshotId,
      error: String(liveBody.error || `正式推送失败 HTTP ${live.status}`),
      pushId: liveBody.pushId || null,
    };
  }
  return {
    status: "succeeded",
    snapshotId,
    pushId: liveBody.pushId,
    itemCount: liveBody.itemCount,
    feedStatus: liveBody.status,
    source: pulled.source || "lingxing-api",
  };
}
