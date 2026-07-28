import { ensureOperationTables, upsertOperation } from "./operation-ledger.mjs";

function payload(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value || "{}"); } catch { return {}; }
  }
  return value && typeof value === "object" ? value : {};
}

function statusFor(eventType, eventPayload) {
  if (eventType === "PLANNED" || eventType === "APPROVED") return "PENDING_APPROVAL";
  if (eventType === "VALIDATED") return "PREFLIGHTED";
  if (eventType === "EXECUTING") return "EXECUTING";
  if (eventType === "EXECUTED") return "PENDING_ACCEPTANCE";
  if (eventType === "FAILED" || eventType === "REMOVED") return "FAILED";
  if (eventType === "REVIEWED") return eventPayload?.verdict && eventPayload.verdict !== "PENDING" ? "CLOSED" : "PENDING_REVIEW";
  return "DISCOVERED";
}

export function operationInputForAdAction(action = {}, eventType = "PLANNED", eventPayload = {}) {
  const before = payload(action.before_payload);
  const proposed = payload(action.proposed_payload);
  const status = statusFor(eventType, eventPayload);
  const receipt = payload(eventPayload);
  const executionResult = ["EXECUTED", "REVIEWED"].includes(eventType)
    ? eventType === "EXECUTED"
      ? `Wayfair Advertising API 已返回终态：Campaign ${receipt.campaignId || action.campaign_id}`
      : String(receipt.summary || `成熟复盘结论 ${receipt.verdict || "PENDING"}`)
    : eventType === "FAILED" || eventType === "REMOVED"
      ? String(receipt.error || receipt.reason || "动作未执行")
      : "";
  const hasExecutionEvidence = ["EXECUTED", "REVIEWED"].includes(eventType);
  return {
    operationId: `ad:${action.id}`,
    sourceType: "AD_ACTION_QUEUE",
    sourceId: String(action.run_key || ""),
    objectType: "CAMPAIGN_LISTING",
    objectId: `${action.campaign_id}:${action.listing}`,
    title: `${action.listing} · ${action.action_type}`,
    owner: "广告运营",
    status,
    proposedAction: String(action.action_type || "广告动作"),
    beforeState: before,
    intendedAfterState: proposed,
    executionResult,
    terminalReceipt: eventType === "EXECUTED" ? JSON.stringify(receipt) : "",
    evidence: hasExecutionEvidence ? [{ type: eventType === "REVIEWED" ? "MATURE_REVIEW" : "API_RECEIPT", value: JSON.stringify(receipt) }] : [],
    acceptanceCriteria: hasExecutionEvidence ? "Wayfair API 返回终态，并在成熟归因窗口完成效果复盘" : "",
    acceptedBy: eventType === "REVIEWED" ? "广告成熟复盘" : "",
    reviewDueAt: eventType === "EXECUTED" ? new Date(Date.now() + 7 * 86_400_000).toISOString() : "",
    reviewVerdict: eventType === "REVIEWED" && receipt.verdict !== "PENDING" ? String(receipt.verdict || "") : "",
    rollbackLink: `/ads/review?action=${encodeURIComponent(String(action.id || ""))}`,
  };
}

export async function syncAdActionOperation(db, action, eventType, eventPayload = {}) {
  await ensureOperationTables(db);
  const finalInput = operationInputForAdAction(action, eventType, eventPayload);
  let existing = await db.prepare("SELECT status FROM operations WHERE id=?").bind(finalInput.operationId).first();
  if (existing?.status === "FAILED" && finalInput.status === "PENDING_APPROVAL") {
    await upsertOperation(db, { ...finalInput, status: "REOPENED" }, "AD_ACTION_REOPENED");
    existing = { status: "REOPENED" };
  }
  if (eventType === "REVIEWED" && existing?.status === "PENDING_ACCEPTANCE") {
    await upsertOperation(db, { ...finalInput, status: "VERIFIED", reviewVerdict: "" }, "AD_API_RECEIPT_ACCEPTED");
    existing = { status: "VERIFIED" };
  }
  if (eventType === "REVIEWED" && finalInput.status === "CLOSED" && existing?.status === "VERIFIED") {
    await upsertOperation(db, { ...finalInput, status: "PENDING_REVIEW", reviewVerdict: "" }, "AD_MATURE_REVIEW_STARTED");
  }
  return upsertOperation(db, finalInput, `AD_${eventType}`);
}
