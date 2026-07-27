const TOKEN = /^[A-Za-z0-9._-]{1,120}$/;

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
  return {
    taskKey,
    parentSku,
    taskId,
    campaignId: text(input.campaignId, "Campaign ID", 120, false),
    adGroup: text(input.adGroup, "广告组", 240, false),
    title: text(input.title, "标题", 240, false),
    status: input.completed ? "COMPLETED" : "OPEN",
  };
}
