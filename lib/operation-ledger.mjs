export const OPERATION_STATUSES = [
  "DISCOVERED",
  "ASSIGNED",
  "PENDING_APPROVAL",
  "PREFLIGHTED",
  "EXECUTING",
  "PENDING_ACCEPTANCE",
  "VERIFIED",
  "PENDING_REVIEW",
  "CLOSED",
  "FAILED",
  "ROLLED_BACK",
  "REOPENED",
];

const STATUS_SET = new Set(OPERATION_STATUSES);
const TRANSITIONS = {
  DISCOVERED: new Set(["ASSIGNED", "PENDING_APPROVAL", "FAILED"]),
  ASSIGNED: new Set(["PENDING_APPROVAL", "PREFLIGHTED", "EXECUTING", "FAILED"]),
  PENDING_APPROVAL: new Set(["PREFLIGHTED", "FAILED", "REOPENED"]),
  PREFLIGHTED: new Set(["EXECUTING", "FAILED"]),
  EXECUTING: new Set(["PENDING_ACCEPTANCE", "FAILED"]),
  PENDING_ACCEPTANCE: new Set(["VERIFIED", "FAILED", "REOPENED"]),
  VERIFIED: new Set(["PENDING_REVIEW", "CLOSED", "REOPENED", "ROLLED_BACK"]),
  PENDING_REVIEW: new Set(["CLOSED", "REOPENED", "ROLLED_BACK"]),
  CLOSED: new Set(["REOPENED", "ROLLED_BACK"]),
  FAILED: new Set(["REOPENED", "ROLLED_BACK"]),
  ROLLED_BACK: new Set(["REOPENED", "CLOSED"]),
  REOPENED: new Set(["ASSIGNED", "PENDING_APPROVAL", "PREFLIGHTED", "EXECUTING", "FAILED"]),
};

function text(value, name, maxLength, required = true) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw new Error(`${name}不能为空`);
  if (normalized.length > maxLength) throw new Error(`${name}不能超过 ${maxLength} 个字符`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name}包含无效控制字符`);
  return normalized;
}

function object(value, name) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}必须是对象`);
  return value;
}

function evidence(value) {
  if (value == null || value === "") return [];
  const items = typeof value === "string" ? [{ type: "NOTE", value }] : value;
  if (!Array.isArray(items)) throw new Error("执行证据必须是数组");
  return items.map((item) => ({
    type: text(item?.type || "NOTE", "证据类型", 40),
    value: text(item?.value, "执行证据", 2_000),
  }));
}

export function assertOperationTransition(from, to) {
  if (from === to) return true;
  if (!STATUS_SET.has(from) || !STATUS_SET.has(to) || !TRANSITIONS[from]?.has(to)) {
    throw new Error(`不允许从 ${from} 直接变更为 ${to}`);
  }
  return true;
}

export function validateOperationInput(input = {}) {
  const status = text(input.status || "DISCOVERED", "任务状态", 40);
  if (!STATUS_SET.has(status)) throw new Error("任务状态无效");
  const normalized = {
    operationId: text(input.operationId, "操作 ID", 242),
    sourceType: text(input.sourceType, "来源类型", 80),
    sourceId: text(input.sourceId, "来源 ID", 242),
    objectType: text(input.objectType, "对象类型", 80),
    objectId: text(input.objectId, "对象 ID", 242),
    title: text(input.title, "标题", 240),
    owner: text(input.owner || "待分派", "负责人", 120),
    status,
    proposedAction: text(input.proposedAction, "建议动作", 2_000),
    beforeState: object(input.beforeState, "执行前状态"),
    intendedAfterState: object(input.intendedAfterState, "目标状态"),
    executionResult: text(input.executionResult, "执行结果", 4_000, false),
    terminalReceipt: text(input.terminalReceipt, "终态回执", 2_000, false),
    evidence: evidence(input.evidence),
    acceptanceCriteria: text(input.acceptanceCriteria, "验收标准", 2_000, false),
    acceptedBy: text(input.acceptedBy, "验收人", 120, false),
    reviewDueAt: text(input.reviewDueAt, "复盘日期", 80, false),
    reviewVerdict: text(input.reviewVerdict, "复盘结论", 80, false),
    rollbackLink: text(input.rollbackLink, "回滚或重开链接", 1_000, false),
  };
  if (["PENDING_ACCEPTANCE", "VERIFIED", "PENDING_REVIEW", "CLOSED"].includes(status)) {
    if (!normalized.executionResult) throw new Error("执行结果不能为空");
    if (!normalized.evidence.length) throw new Error("执行证据不能为空");
    if (!normalized.acceptanceCriteria) throw new Error("验收标准不能为空");
  }
  if (["VERIFIED", "PENDING_REVIEW", "CLOSED"].includes(status) && !normalized.acceptedBy) {
    throw new Error("验收人不能为空");
  }
  if (status === "CLOSED" && !normalized.reviewVerdict) {
    throw new Error("关闭任务前必须填写复盘结论");
  }
  return normalized;
}

export async function ensureOperationTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      title TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '待分派',
      status TEXT NOT NULL DEFAULT 'DISCOVERED',
      proposed_action TEXT NOT NULL,
      before_state TEXT NOT NULL DEFAULT '{}',
      intended_after_state TEXT NOT NULL DEFAULT '{}',
      execution_result TEXT,
      terminal_receipt TEXT,
      evidence TEXT NOT NULL DEFAULT '[]',
      acceptance_criteria TEXT,
      accepted_by TEXT,
      review_due_at TEXT,
      review_verdict TEXT,
      rollback_link TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS operations_status_idx ON operations(status, updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS operations_object_idx ON operations(object_type, object_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS operation_events (
      id TEXT PRIMARY KEY NOT NULL,
      operation_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS operation_events_operation_idx ON operation_events(operation_id, created_at)"),
  ]);
}

export async function upsertOperation(db, input, eventType = "UPDATED") {
  await ensureOperationTables(db);
  const record = validateOperationInput(input);
  const existing = await db.prepare("SELECT status,created_at FROM operations WHERE id=?")
    .bind(record.operationId)
    .first();
  if (existing?.status) assertOperationTransition(existing.status, record.status);
  const now = new Date().toISOString();
  const closedAt = record.status === "CLOSED" ? now : null;
  await db.batch([
    db.prepare(`INSERT INTO operations(
      id,source_type,source_id,object_type,object_id,title,owner,status,proposed_action,
      before_state,intended_after_state,execution_result,terminal_receipt,evidence,
      acceptance_criteria,accepted_by,review_due_at,review_verdict,rollback_link,
      created_at,updated_at,closed_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      source_type=excluded.source_type,source_id=excluded.source_id,
      object_type=excluded.object_type,object_id=excluded.object_id,title=excluded.title,
      owner=excluded.owner,status=excluded.status,proposed_action=excluded.proposed_action,
      before_state=excluded.before_state,intended_after_state=excluded.intended_after_state,
      execution_result=excluded.execution_result,terminal_receipt=excluded.terminal_receipt,
      evidence=excluded.evidence,acceptance_criteria=excluded.acceptance_criteria,
      accepted_by=excluded.accepted_by,review_due_at=excluded.review_due_at,
      review_verdict=excluded.review_verdict,rollback_link=excluded.rollback_link,
      updated_at=excluded.updated_at,closed_at=excluded.closed_at`)
      .bind(
        record.operationId, record.sourceType, record.sourceId, record.objectType,
        record.objectId, record.title, record.owner, record.status,
        record.proposedAction, JSON.stringify(record.beforeState),
        JSON.stringify(record.intendedAfterState), record.executionResult || null,
        record.terminalReceipt || null, JSON.stringify(record.evidence),
        record.acceptanceCriteria || null, record.acceptedBy || null,
        record.reviewDueAt || null, record.reviewVerdict || null,
        record.rollbackLink || null, existing?.created_at || now, now, closedAt,
      ),
    db.prepare("INSERT INTO operation_events(id,operation_id,event_type,from_status,to_status,payload,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(
        crypto.randomUUID(), record.operationId, eventType,
        existing?.status || null, record.status, JSON.stringify(record), now,
      ),
  ]);
  return { ...record, createdAt: existing?.created_at || now, updatedAt: now, closedAt };
}

export async function listOperations(db, { status = "", objectId = "", limit = 200 } = {}) {
  await ensureOperationTables(db);
  const clauses = [];
  const values = [];
  if (status) {
    clauses.push("status=?");
    values.push(status);
  }
  if (objectId) {
    clauses.push("object_id=?");
    values.push(objectId);
  }
  values.push(Math.max(1, Math.min(Number(limit) || 200, 500)));
  const result = await db.prepare(`SELECT
    id AS "operationId",source_type AS "sourceType",source_id AS "sourceId",
    object_type AS "objectType",object_id AS "objectId",title,owner,status,
    proposed_action AS "proposedAction",before_state AS "beforeState",
    intended_after_state AS "intendedAfterState",execution_result AS "executionResult",
    terminal_receipt AS "terminalReceipt",evidence,acceptance_criteria AS "acceptanceCriteria",
    accepted_by AS "acceptedBy",review_due_at AS "reviewDueAt",
    review_verdict AS "reviewVerdict",rollback_link AS "rollbackLink",
    created_at AS "createdAt",updated_at AS "updatedAt",closed_at AS "closedAt"
    FROM operations ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY updated_at DESC LIMIT ?`).bind(...values).all();
  return (result.results || []).map((row) => ({
    ...row,
    beforeState: JSON.parse(row.beforeState || "{}"),
    intendedAfterState: JSON.parse(row.intendedAfterState || "{}"),
    evidence: JSON.parse(row.evidence || "[]"),
  }));
}
