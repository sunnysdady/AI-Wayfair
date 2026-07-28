const TOKEN = /^[A-Za-z0-9._-]{1,120}$/;
import { validateOperationInput } from "./operation-ledger.mjs";

function text(value, name, maxLength, required = true) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw new Error(`${name}不能为空`);
  if (normalized.length > maxLength) throw new Error(`${name}不能超过 ${maxLength} 个字符`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name}包含无效控制字符`);
  return normalized;
}

export function manualCompletionPayload(taskKey, tasks = []) {
  const parts = String(taskKey ?? "").split("::");
  if (parts.length !== 2 || !TOKEN.test(parts[0]) || !TOKEN.test(parts[1])) return null;
  const [parentSku, taskId] = parts;
  const task = tasks.find((candidate) => (
    candidate?.id === taskId
    && Array.isArray(candidate.parentSkus)
    && candidate.parentSkus.includes(parentSku)
  ));
  if (!task) return null;
  return {
    taskKey: `${parentSku}::${taskId}`,
    parentSku,
    taskId,
    campaignId: String(task.campaignId ?? ""),
    adGroup: String(task.adGroup ?? ""),
    title: String(task.title ?? ""),
    status: "PENDING_ACCEPTANCE",
    owner: "待分派",
    executionResult: "旧版浏览器记录：仅确认曾勾选，等待补充平台证据",
    evidence: "legacy-browser-completion",
    acceptanceCriteria: "补充平台实际结果并由负责人验收",
  };
}

export function validateManualCompletion(input = {}) {
  const taskKey = text(input.taskKey, "任务键", 242);
  const parentSku = text(input.parentSku, "父体 SKU", 120);
  const taskId = text(input.taskId, "任务 ID", 120);
  if (!TOKEN.test(parentSku) || !TOKEN.test(taskId) || taskKey !== `${parentSku}::${taskId}`) {
    throw new Error("任务键必须由父体 SKU 与任务 ID 组成");
  }
  const legacyStatus = typeof input.completed === "boolean" ? (input.completed ? "PENDING_ACCEPTANCE" : "OPEN") : "";
  const status = text(input.status || legacyStatus || "OPEN", "任务状态", 40);
  if (!["OPEN", "IN_PROGRESS", "PENDING_ACCEPTANCE", "VERIFIED", "REOPENED", "FAILED"].includes(status)) {
    throw new Error("任务状态无效");
  }
  const normalized = {
    operationId: `manual:${taskKey}`,
    taskKey,
    parentSku,
    taskId,
    campaignId: text(input.campaignId, "Campaign ID", 120, false),
    adGroup: text(input.adGroup, "广告组", 240, false),
    title: text(input.title, "标题", 240, false),
    status,
    owner: text(input.owner || "待分派", "负责人", 120),
    executionResult: text(input.executionResult, "执行结果", 2_000, false),
    evidence: text(input.evidence, "执行证据", 2_000, false),
    acceptanceCriteria: text(input.acceptanceCriteria || input.title || "核对 Wayfair 平台实际结果", "验收标准", 2_000),
    acceptedBy: text(input.acceptedBy, "验收人", 120, false),
    reviewDueAt: text(input.reviewDueAt, "复盘日期", 80, false),
  };
  const operationStatus = {
    OPEN: "DISCOVERED",
    IN_PROGRESS: "EXECUTING",
    PENDING_ACCEPTANCE: "PENDING_ACCEPTANCE",
    VERIFIED: "VERIFIED",
    REOPENED: "REOPENED",
    FAILED: "FAILED",
  }[status];
  validateOperationInput({
    operationId: normalized.operationId,
    sourceType: "MANUAL_AD",
    sourceId: taskKey,
    objectType: "PARENT_SKU",
    objectId: parentSku,
    title: normalized.title || taskId,
    owner: normalized.owner,
    status: operationStatus,
    proposedAction: normalized.title || taskId,
    beforeState: { campaignId: normalized.campaignId, adGroup: normalized.adGroup },
    intendedAfterState: { acceptanceCriteria: normalized.acceptanceCriteria },
    executionResult: normalized.executionResult,
    evidence: normalized.evidence,
    acceptanceCriteria: normalized.acceptanceCriteria,
    acceptedBy: normalized.acceptedBy,
    reviewDueAt: normalized.reviewDueAt,
  });
  return normalized;
}
