function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function rowToRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    operationId: row.operationId,
    linkedPreflightOperationId: row.linkedPreflightOperationId || "",
    mode: row.mode,
    payloadHash: row.payloadHash,
    payload: parseJson(row.payloadJson, {}),
    status: row.status,
    requestId: row.requestId || "",
    batchId: row.batchId || "",
    result: parseJson(row.resultJson, {}),
    lastError: row.lastError || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureProductAdditionRunsTable(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS product_addition_runs (
      id TEXT PRIMARY KEY NOT NULL,
      operation_id TEXT NOT NULL UNIQUE,
      linked_preflight_operation_id TEXT,
      mode TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      request_id TEXT,
      batch_id TEXT,
      result_json TEXT NOT NULL DEFAULT '{}',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS product_addition_runs_updated_idx ON product_addition_runs(updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS product_addition_runs_hash_idx ON product_addition_runs(payload_hash, mode)"),
  ]);
}

export async function createProductAdditionRun(db, input) {
  await ensureProductAdditionRunsTable(db);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO product_addition_runs(
    id,operation_id,linked_preflight_operation_id,mode,payload_hash,payload_json,status,
    request_id,batch_id,result_json,last_error,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    input.id,
    input.operationId,
    input.linkedPreflightOperationId || null,
    input.mode,
    input.payloadHash,
    JSON.stringify(input.payload),
    input.status,
    input.requestId || null,
    input.batchId || null,
    JSON.stringify(input.result || {}),
    input.lastError || null,
    now,
    now,
  ).run();
  return getProductAdditionRun(db, input.id);
}

export async function updateProductAdditionRun(db, id, patch) {
  await ensureProductAdditionRunsTable(db);
  const current = await getProductAdditionRun(db, id);
  if (!current) throw new Error("Product Addition 运行记录不存在");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.prepare(`UPDATE product_addition_runs SET
    linked_preflight_operation_id=?,status=?,request_id=?,batch_id=?,result_json=?,last_error=?,updated_at=?
    WHERE id=?`).bind(
    next.linkedPreflightOperationId || null,
    next.status,
    next.requestId || null,
    next.batchId || null,
    JSON.stringify(next.result || {}),
    next.lastError || null,
    next.updatedAt,
    id,
  ).run();
  return getProductAdditionRun(db, id);
}

const SELECT_RUN = `SELECT
  id,operation_id AS "operationId",linked_preflight_operation_id AS "linkedPreflightOperationId",
  mode,payload_hash AS "payloadHash",payload_json AS "payloadJson",status,
  request_id AS "requestId",batch_id AS "batchId",result_json AS "resultJson",
  last_error AS "lastError",created_at AS "createdAt",updated_at AS "updatedAt"
  FROM product_addition_runs`;

export async function getProductAdditionRun(db, id) {
  await ensureProductAdditionRunsTable(db);
  return rowToRun(await db.prepare(`${SELECT_RUN} WHERE id=?`).bind(id).first());
}

export async function listProductAdditionRuns(db, limit = 30) {
  await ensureProductAdditionRunsTable(db);
  const result = await db.prepare(`${SELECT_RUN} ORDER BY updated_at DESC LIMIT ?`)
    .bind(Math.max(1, Math.min(Number(limit) || 30, 100)))
    .all();
  return (result.results || []).map(rowToRun);
}
