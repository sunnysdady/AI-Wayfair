import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const SETTINGS_KEYS = [
  "WAYFAIR_AD_CLIENT_ID",
  "WAYFAIR_AD_CLIENT_SECRET",
  "WAYFAIR_OPS_CLIENT_ID",
  "WAYFAIR_OPS_CLIENT_SECRET",
  "WAYFAIR_CATALOG_CLIENT_ID",
  "WAYFAIR_CATALOG_CLIENT_SECRET",
  "WAYFAIR_CATALOG_SUPPLIER_ID",
  "WAYFAIR_DEPLOYMENT_ENV",
  "WAYFAIR_EXPECTED_SUPPLIER_IDS",
  "ALLOW_WAYFAIR_AD_LIVE_CHANGES",
  "ALLOW_WAYFAIR_LIVE_PUSH",
  "OUTLOOK_INGEST_TOKEN",
] as const;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function authorized(request: Request, expected: string | undefined) {
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

function quotedIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function tableNames(db: D1Database) {
  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).all<{ name: string }>();
  return (result.results || []).map((row) => row.name);
}

export async function GET(request: Request) {
  try {
    const env = await getRuntimeBindings();
    if (!authorized(request, env.MIGRATION_EXPORT_TOKEN)) {
      return json({ error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") || "manifest";

    if (kind === "settings") {
      return json({
        settings: Object.fromEntries(
          SETTINGS_KEYS.flatMap((key) => env[key] === undefined ? [] : [[key, env[key]]]),
        ),
      });
    }

    if (kind === "manifest") {
      const names = await tableNames(env.DB);
      const tables = [];
      for (const name of names) {
        const row = await env.DB.prepare(
          `SELECT COUNT(*) AS count FROM ${quotedIdentifier(name)}`,
        ).first<{ count: number }>();
        tables.push({ name, count: Number(row?.count || 0) });
      }
      return json({ tables });
    }

    if (kind === "table") {
      const name = url.searchParams.get("name") || "";
      const names = await tableNames(env.DB);
      if (!names.includes(name)) return json({ error: "unknown table" }, 404);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 1000);
      const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
      const result = await env.DB.prepare(
        `SELECT * FROM ${quotedIdentifier(name)} LIMIT ? OFFSET ?`,
      ).bind(limit, offset).all();
      return json({ name, offset, limit, rows: result.results || [] });
    }

    if (kind === "objects") {
      const cursor = url.searchParams.get("cursor") || undefined;
      const listed = await env.FILES.list({ limit: 1000, cursor });
      return json({
        objects: listed.objects.map((item) => ({
          key: item.key,
          size: item.size,
          etag: item.etag,
          uploaded: item.uploaded,
        })),
        truncated: listed.truncated,
        cursor: listed.truncated ? listed.cursor : null,
      });
    }

    if (kind === "object") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "missing object key" }, 400);
      const object = await env.FILES.get(key);
      if (!object) return json({ error: "object not found" }, 404);
      const headers = new Headers({
        "cache-control": "no-store",
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        "x-content-type-options": "nosniff",
      });
      if (object.httpEtag) headers.set("etag", object.httpEtag);
      return new Response(object.body, { headers });
    }

    return json({ error: "unknown export kind" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "migration export failed" }, 500);
  }
}
