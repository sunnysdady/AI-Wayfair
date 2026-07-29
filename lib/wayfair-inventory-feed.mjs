const COMPLETED_STATUSES = new Set(["COMPLETED", "COMPLETE", "SUCCESS", "SUCCEEDED"]);
const FAILED_STATUSES = new Set(["FAILED", "ERROR", "REJECTED", "CANCELLED", "CANCELED"]);
const DEFAULT_MAX_PROCESSING_MS = 30 * 60 * 1000;

function asCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

export function classifyInventoryFeed(feed, options = {}) {
  if (!feed || typeof feed !== "object") {
    return { state: "failed", reason: "Wayfair 未返回库存 feed 回执" };
  }

  const status = String(feed.status || "").toUpperCase();
  const itemCount = asCount(feed.itemCount);
  const errorCount = asCount(feed.errorCount);
  const completedCount = asCount(feed.completedCount);
  const processingCount = asCount(feed.processingCount);
  const errors = Array.isArray(feed.errors) ? feed.errors.filter(Boolean) : [];
  const receiptId = String(feed.id || feed.handle || "");

  if (!receiptId) return { state: "failed", reason: "Wayfair 回执缺少 feed ID" };
  if (itemCount === null) return { state: "failed", reason: "Wayfair 回执缺少处理单元数量" };
  if (errorCount === null) return { state: "failed", reason: "Wayfair 回执缺少错误计数" };
  if (completedCount === null || processingCount === null) return { state: "failed", reason: "Wayfair 回执缺少完成进度" };
  if (errorCount > 0 || errors.length > 0) {
    return { state: "failed", reason: errors.map((item) => item?.message).filter(Boolean).join("；") || `Wayfair 返回 ${errorCount} 条错误` };
  }
  if (FAILED_STATUSES.has(status)) return { state: "failed", reason: `Wayfair feed 状态为 ${status}` };
  if (COMPLETED_STATUSES.has(status) && feed.completedAt && processingCount === 0 && completedCount === itemCount) return { state: "completed", reason: "" };
  if (COMPLETED_STATUSES.has(status)) return { state: "failed", reason: `Wayfair 完成计数异常：${completedCount}/${itemCount}，仍处理中 ${processingCount}` };
  const submittedAt = Date.parse(String(feed.submittedAt || ""));
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  const maxProcessingMs = Number.isFinite(options.maxProcessingMs)
    ? Number(options.maxProcessingMs)
    : DEFAULT_MAX_PROCESSING_MS;
  if (!options.allowIndefiniteProcessing && Number.isFinite(submittedAt) && now - submittedAt > maxProcessingMs) {
    return {
      state: "failed",
      reason: `Wayfair feed 处理超过 ${Math.round(maxProcessingMs / 60000)} 分钟，未形成完成回执；请检查 Inventory API 开通/审核状态`,
    };
  }
  return { state: "processing", reason: status ? `Wayfair feed 状态为 ${status}` : "Wayfair feed 尚未返回完成状态" };
}

export function isInventoryDryRunAccepted(batches) {
  return Array.isArray(batches) && batches.length > 0 && batches.every((batch) => {
    const feed = batch?.feed;
    const receiptId = String(feed?.id || feed?.handle || "");
    const errors = Array.isArray(feed?.errors) ? feed.errors.filter(Boolean) : [];
    return (batch?.state === "processing" || batch?.state === "completed")
      && Boolean(receiptId)
      && Number.isFinite(Number(feed?.itemCount))
      && Number.isFinite(Number(feed?.completedCount))
      && Number.isFinite(Number(feed?.processingCount))
      && Number(feed?.errorCount) === 0
      && errors.length === 0;
  });
}

export function summarizeInventoryFeeds(batches) {
  const completed = batches.filter((item) => item.state === "completed").length;
  const failed = batches.filter((item) => item.state === "failed").length;
  return {
    status: !batches.length || failed ? "failed" : completed === batches.length ? "completed" : "processing",
    completed,
    failed,
    total: batches.length,
  };
}
