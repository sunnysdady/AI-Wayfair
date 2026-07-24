function postgresPlaceholders(sql) {
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let output = "";

  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const char = sql[cursor];
    const next = sql[cursor + 1];

    if (char === "'" && !doubleQuoted) {
      output += char;
      if (singleQuoted && next === "'") {
        output += next;
        cursor += 1;
      } else {
        singleQuoted = !singleQuoted;
      }
      continue;
    }
    if (char === '"' && !singleQuoted) {
      output += char;
      if (doubleQuoted && next === '"') {
        output += next;
        cursor += 1;
      } else {
        doubleQuoted = !doubleQuoted;
      }
      continue;
    }
    if (char === "?" && !singleQuoted && !doubleQuoted) {
      index += 1;
      output += `$${index}`;
      continue;
    }
    output += char;
  }

  return output;
}

function quoteCamelCaseAliases(sql) {
  return sql.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*)\b/g, 'AS "$1"');
}

export function toPostgresSql(sql) {
  return quoteCamelCaseAliases(postgresPlaceholders(sql));
}

class PostgresD1Statement {
  constructor(executor, sql, values = []) {
    this.executor = executor;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new PostgresD1Statement(this.executor, this.sql, values);
  }

  async first(column) {
    const result = await this.executor.query(toPostgresSql(this.sql), this.values);
    const row = result.rows[0] ?? null;
    if (row === null || column === undefined) return row;
    return row[column] ?? null;
  }

  async all() {
    const result = await this.executor.query(toPostgresSql(this.sql), this.values);
    return { results: result.rows, success: true };
  }

  async run() {
    const result = await this.executor.query(toPostgresSql(this.sql), this.values);
    return {
      success: true,
      meta: {
        changes: result.rowCount ?? 0,
        changed_db: Boolean(result.rowCount),
        duration: 0,
        last_row_id: null,
        rows_read: result.rows?.length ?? 0,
        rows_written: result.rowCount ?? 0,
        size_after: 0,
      },
      results: result.rows ?? [],
    };
  }
}

export function createPostgresD1Database({ pool }) {
  if (!pool || typeof pool.query !== "function" && typeof pool.connect !== "function") {
    throw new Error("PostgreSQL connection pool is required");
  }

  return {
    prepare(sql) {
      return new PostgresD1Statement(pool, sql);
    },

    async batch(statements) {
      if (!Array.isArray(statements)) throw new Error("batch expects statements");
      const client = await pool.connect();
      const results = [];
      try {
        await client.query("BEGIN");
        for (const statement of statements) {
          const result = await client.query(
            toPostgresSql(statement.sql),
            statement.values,
          );
          results.push({
            success: true,
            results: result.rows ?? [],
            meta: {
              changes: result.rowCount ?? 0,
              rows_read: result.rows?.length ?? 0,
              rows_written: result.rowCount ?? 0,
            },
          });
        }
        await client.query("COMMIT");
        return results;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

const pools = new Map();

export async function createPostgresDatabaseFromEnv(env = process.env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  let pool = pools.get(connectionString);
  if (!pool) {
    const { Pool } = await import("pg");
    pool = new Pool({
      connectionString,
      max: Math.max(1, Math.min(Number(env.DATABASE_POOL_MAX || 5), 20)),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    if (env.VERCEL) {
      const { attachDatabasePool } = await import("@vercel/functions");
      attachDatabasePool(pool);
    }
    pools.set(connectionString, pool);
  }
  return createPostgresD1Database({ pool });
}
