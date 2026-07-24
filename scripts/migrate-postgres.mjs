import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migrationsDir = resolve(root, "migrations/postgres");
const files = (await readdir(migrationsDir))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort();
const pool = new pg.Pool({ connectionString, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [941_731_889]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const applied = new Set(
    (await client.query("SELECT name FROM schema_migrations")).rows.map((row) => row.name),
  );
  for (const name of files) {
    if (applied.has(name)) continue;
    await client.query(await readFile(resolve(migrationsDir, name), "utf8"));
    await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    process.stdout.write(`applied ${name}\n`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
