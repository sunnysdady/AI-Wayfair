import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { validateProductManagementSnapshot } from "@/lib/product-management-snapshot.mjs";

export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string | undefined) {
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function ensureAuditTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS product_management_sync_runs (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    received_at TEXT NOT NULL,
    extracted_at TEXT,
    store_id TEXT,
    row_count INTEGER NOT NULL DEFAULT 0,
    unique_part_count INTEGER NOT NULL DEFAULT 0,
    payload TEXT,
    error TEXT
  )`).run();
}

export async function POST(request: Request) {
  const env = await getRuntimeBindings();
  if (!authorized(request, env.CRON_SECRET)) {
    return Response.json({ error: "Product Management 同步授权无效" }, { status: 401 });
  }
  const receivedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  try {
    const payload = await request.json() as unknown;
    const input = payload && typeof payload === "object" && !Array.isArray(payload)
      && "snapshot" in payload
      ? (payload as { snapshot: unknown }).snapshot
      : payload;
    const { snapshot, audit } = validateProductManagementSnapshot(input);
    await ensureAuditTable(env.DB);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO product_management_sync_runs
        (id,source,status,received_at,extracted_at,store_id,row_count,unique_part_count,payload)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind(
        runId, "ziniao-cli", "succeeded", receivedAt, audit.extractedAt, audit.storeId,
        audit.rowCount, audit.uniquePartCount, JSON.stringify(snapshot),
      ),
      env.DB.prepare(`INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(
        "product-management:v1:latest",
        JSON.stringify(snapshot),
        receivedAt,
      ),
      env.DB.prepare(`INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(
        "product-management:v1:last-run",
        JSON.stringify({ status: "succeeded", runId, ...audit }),
        receivedAt,
      ),
    ]);
    return Response.json({ status: "succeeded", runId, receivedAt, audit }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product Management 快照校验失败";
    try {
      await ensureAuditTable(env.DB);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO product_management_sync_runs
          (id,source,status,received_at,error) VALUES(?,?,?,?,?)`).bind(
          runId, "ziniao-cli", "failed", receivedAt, message,
        ),
        env.DB.prepare(`INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(
          "product-management:v1:last-run",
          JSON.stringify({ status: "failed", runId, error: message }),
          receivedAt,
        ),
      ]);
    } catch {
      // Preserve the original validation/database failure without leaking internals.
    }
    return Response.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
