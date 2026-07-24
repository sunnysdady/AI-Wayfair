const COMPLETED_STATUSES = new Set(["COMPLETED", "COMPLETE", "SUCCESS", "SUCCEEDED"]);
const FAILED_STATUSES = new Set(["FAILED", "ERROR", "REJECTED", "CANCELLED", "CANCELED"]);

function asCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

export function classifyInventoryFeed(feed) {
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
  return { state: "processing", reason: status ? `Wayfair feed 状态为 ${status}` : "Wayfair feed 尚未返回完成状态" };
}

export function summarizeInventoryFeeds(batches) {
  const completed = batches.filter((item) => item.state === "completed").length;
  const failed = batches.filter((item) => item.state === "failed").length;
  return {
    status: failed ? "failed" : completed === batches.length ? "completed" : "processing",
    completed,
    failed,
    total: batches.length,
  };
}
