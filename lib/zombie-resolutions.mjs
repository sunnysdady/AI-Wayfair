import { validateOperationInput } from "./operation-ledger.mjs";

const STATUS = new Set(["DISCOVERED", "ASSIGNED", "EXECUTING", "PENDING_ACCEPTANCE", "VERIFIED", "FAILED", "REOPENED"]);

function text(value, name, maxLength, required = true) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw new Error(`${name}不能为空`);
  if (normalized.length > maxLength) throw new Error(`${name}不能超过 ${maxLength} 个字符`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name}包含无效控制字符`);
  return normalized;
}

export function validateZombieResolution(input = {}) {
  const status = text(input.status || "DISCOVERED", "状态", 40);
  if (!STATUS.has(status)) throw new Error("Zombie 处置状态无效");
  const resolutionKey = text(input.resolutionKey, "处置键", 362);
  const campaignId = text(input.campaignId, "Campaign ID", 120);
  const listing = text(input.listing, "Listing", 120);
  const actionType = text(input.actionType, "动作类型", 120);
  if (resolutionKey !== `${campaignId}:${listing}:${actionType}`) throw new Error("处置键与 Campaign / Listing 不一致");
  const record = {
    resolutionKey,
    operationId: `zombie:${resolutionKey}`,
    campaignId,
    listing,
    actionType,
    method: text(input.method, "处理方式", 500),
    owner: text(input.owner || "待分派", "负责人", 120),
    status,
    executionResult: text(input.executionResult, "执行结果", 2_000, false),
    evidence: text(input.evidence, "执行证据", 2_000, false),
    acceptanceCriteria: text(input.acceptanceCriteria || `${input.method || "处置动作"}已在 Wayfair 平台生效`, "验收标准", 2_000),
    acceptedBy: text(input.acceptedBy, "验收人", 120, false),
  };
  validateOperationInput({
    operationId: record.operationId,
    sourceType: "ZOMBIE_DIAGNOSIS",
    sourceId: resolutionKey,
    objectType: "CAMPAIGN_LISTING",
    objectId: `${campaignId}:${listing}`,
    title: `${listing} · ${record.method}`,
    owner: record.owner,
    status: record.status,
    proposedAction: record.method,
    beforeState: { campaignId, listing, actionType },
    intendedAfterState: { method: record.method },
    executionResult: record.executionResult,
    evidence: record.evidence,
    acceptanceCriteria: record.acceptanceCriteria,
    acceptedBy: record.acceptedBy,
  });
  return record;
}
