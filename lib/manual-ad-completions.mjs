const TOKEN = /^[A-Za-z0-9._-]{1,120}$/;
const STATUS = new Set(["COMPLETED", "OPEN"]);

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
    completed: true,
    owner: "运营负责人",
    assignee: "广告 Agent",
    executionChannel: "Wayfair Partner Home",
    executionResult: "",
    receiver: "",
    reviewDate: "",
  };
}

export function validateManualCompletion(input = {}) {
  const taskKey = text(input.taskKey, "任务键", 242);
  const parentSku = text(input.parentSku, "父体 SKU", 120);
  const taskId = text(input.taskId, "任务 ID", 120);
  if (!TOKEN.test(parentSku) || !TOKEN.test(taskId) || taskKey !== `${parentSku}::${taskId}`) {
    throw new Error("任务键必须由父体 SKU 与任务 ID 组成");
  }
  if (typeof input.completed !== "boolean") throw new Error("完成状态必须是布尔值");
  const status = input.completed ? "COMPLETED" : "OPEN";
  if (!STATUS.has(status)) throw new Error("任务状态无效");
  return {
    taskKey,
    parentSku,
    taskId,
    campaignId: text(input.campaignId, "Campaign ID", 120, false),
    adGroup: text(input.adGroup, "广告组", 240, false),
    title: text(input.title, "标题", 240, false),
    owner: text(input.owner || "运营负责人", "负责人", 80),
    assignee: text(input.assignee || "广告 Agent", "执行人", 80),
    executionChannel: text(input.executionChannel || "Wayfair Partner Home", "执行渠道", 120),
    executionResult: text(input.executionResult || "", "执行结果", 500, false),
    wayfairEvidence: text(input.wayfairEvidence || "", "Wayfair 回传证据", 500, false),
    receiver: text(input.receiver || "", "验收人", 80, false),
    reviewDate: text(input.reviewDate || "", "成熟复盘日", 30, false),
    closedLoopStatus: status === "COMPLETED" ? "CLOSED_LOOP_RECORDED" : "ASSIGNED",
    status,
  };
}
