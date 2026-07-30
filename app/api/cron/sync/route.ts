import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { runLayeredSync } from "@/lib/server-sync.mjs";
import { syncOutlookDaily } from "@/lib/outlook-daily-sync.mjs";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string | undefined) {
  return Boolean(secret)
    && request.headers.get("authorization") === `Bearer ${secret}`;
}

function manuallyAuthorized(request: Request, env: Env) {
  if (!env.APP_ACCESS_USER || !env.APP_ACCESS_PASSWORD) return false;
  return request.headers.get("authorization") === `Basic ${Buffer.from(
    `${env.APP_ACCESS_USER}:${env.APP_ACCESS_PASSWORD}`,
  ).toString("base64")}`;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

function syncOrigin(request: Request, configured: string | undefined) {
  const candidate = configured || new URL(request.url).origin;
  const url = new URL(candidate);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_ORIGIN 必须使用 HTTPS");
  }
  return url.origin;
}

function internalHeaders(env: Env) {
  const headers = new Headers({ "x-wayfair-internal-sync": "1" });
  if (env.APP_ACCESS_USER && env.APP_ACCESS_PASSWORD) {
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`${env.APP_ACCESS_USER}:${env.APP_ACCESS_PASSWORD}`).toString("base64")}`,
    );
  }
  return headers;
}

async function ensureSyncTables(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS sync_locks (key TEXT PRIMARY KEY NOT NULL, acquired_at TEXT NOT NULL)",
  ).run();
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
}

async function runSync(request: Request, env: Env, manualFull = false) {
  const db = env.DB;
  await ensureSyncTables(db);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM sync_locks WHERE acquired_at<?")
    .bind(staleBefore)
    .run();
  const lock = await db.prepare(
    "INSERT INTO sync_locks(key,acquired_at) VALUES(?,?) ON CONFLICT(key) DO NOTHING RETURNING key",
  ).bind("layered-sync", now.toISOString()).first<{ key: string }>();
  if (!lock) {
    return Response.json(
      { error: "已有同步任务正在运行" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const origin = syncOrigin(request, env.APP_ORIGIN);
    const outlookConfigured = Boolean(
      env.MICROSOFT_CLIENT_ID
      && env.MICROSOFT_CLIENT_SECRET,
    );
    const result = await runLayeredSync({
      scheduledTime: now.getTime(),
      request: (target: URL | Request) => {
        const upstream = target instanceof Request ? new URL(target.url) : new URL(target);
        return fetch(`${origin}${upstream.pathname}${upstream.search}`, {
          method: target instanceof Request ? target.method : "GET",
          headers: internalHeaders(env),
          cache: "no-store",
        });
      },
      syncOutlook: outlookConfigured
        ? () => syncOutlookDaily({ env, db, now })
        : undefined,
      mode: manualFull ? "manual-full" : undefined,
      catalogPageBudget: boundedInteger(
        manualFull
          ? env.CATALOG_MANUAL_SYNC_PAGE_BUDGET
          : env.CATALOG_SYNC_PAGE_BUDGET,
        manualFull ? 100 : 10,
        manualFull ? 500 : 100,
      ),
      catalogPageDelayMs: boundedInteger(
        env.CATALOG_SYNC_PAGE_DELAY_MS,
        250,
        10_000,
      ),
      loadCatalogCheckpoint: async () => {
        const row = await db.prepare(
          "SELECT value FROM sync_state WHERE key=?",
        ).bind("server:catalog:crawl").first<{ value: string }>();
        if (!row?.value) return null;
        try {
          return JSON.parse(row.value);
        } catch {
          return null;
        }
      },
      saveCatalogCheckpoint: async (checkpoint: unknown) => {
        const updatedAt = new Date().toISOString();
        await db.prepare(
          "INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        ).bind(
          "server:catalog:crawl",
          JSON.stringify(checkpoint),
          updatedAt,
        ).run();
      },
      record: async (entry: unknown) => {
        const updatedAt = new Date().toISOString();
        await db.prepare(
          "INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        ).bind(
          "server:layered-sync:last-run",
          JSON.stringify(entry),
          updatedAt,
        ).run();
      },
    });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "分层同步失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    await db.prepare("DELETE FROM sync_locks WHERE key=?")
      .bind("layered-sync")
      .run();
  }
}

export async function GET(request: Request) {
  const env = await getRuntimeBindings();
  if (!authorized(request, env.CRON_SECRET)) {
    return Response.json({ error: "定时同步授权无效" }, { status: 401 });
  }
  return runSync(request, env);
}

export async function POST(request: Request) {
  const env = await getRuntimeBindings();
  if (!sameOrigin(request)) {
    return Response.json({ error: "全站点同步请求来源无效" }, { status: 403 });
  }
  if (!manuallyAuthorized(request, env)) {
    return Response.json({ error: "全站点同步需要已登录的运营账号" }, { status: 401 });
  }
  return runSync(request, env, true);
}
