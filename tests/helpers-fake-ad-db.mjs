/** Minimal in-memory stand-in for the D1-style adapter, covering only the ad_report_* statements. */
export function createFakeAdDb({ extra = {}, failInsertAt = null } = {}) {
  const rows = []; // {type,date,key,payload,refreshed}
  const days = new Map(); // `${type}|${date}` -> refreshed
  const log = [];
  const state = new Map(); // sync_state key -> {value, updated}
  const batches = []; // statement count per db.batch call
  let inserts = 0;
  const run = (sql, args) => {
    log.push(sql);
    if (/^CREATE/i.test(sql)) return { results: [] };
    if (/^DELETE FROM ad_report_rows/i.test(sql)) {
      const [type, date] = args;
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].type === type && rows[i].date === date) rows.splice(i, 1);
      return { results: [] };
    }
    if (/^INSERT INTO ad_report_days/i.test(sql)) { days.set(`${args[0]}|${args[1]}`, args[2]); return { results: [] }; }
    if (/^INSERT INTO ad_report_rows/i.test(sql)) {
      const [type, date, key, payload, refreshed] = args;
      inserts += 1;
      if (failInsertAt !== null && inserts === failInsertAt) throw new Error("simulated insert failure");
      if (rows.some((row) => row.type === type && row.date === date && row.key === key)) throw new Error("duplicate key");
      rows.push({ type, date, key, payload, refreshed });
      return { results: [] };
    }
    if (/^SELECT report_date, payload FROM ad_report_rows/i.test(sql)) {
      const [type, start, end] = args;
      return { results: rows.filter((row) => row.type === type && row.date >= start && row.date <= end).sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)).map((row) => ({ report_date: row.date, payload: row.payload })) };
    }
    if (/^SELECT payload FROM ad_report_rows/i.test(sql)) {
      const [start, end] = args;
      return { results: rows.filter((row) => row.type === "LISTING_REPORT" && row.date >= start && row.date <= end).map((row) => ({ payload: row.payload })) };
    }
    if (/^SELECT report_date, refreshed_at FROM ad_report_days/i.test(sql)) {
      const [type, start, end] = args;
      return { results: [...days].filter(([key]) => key.startsWith(`${type}|`)).map(([key, refreshed]) => ({ report_date: key.split("|")[1], refreshed_at: refreshed })).filter((row) => row.report_date >= start && row.report_date <= end) };
    }
    if (/^INSERT INTO sync_state/i.test(sql)) { state.set(args[0], { value: args[1], updated: args[2] }); return { results: [] }; }
    if (/^SELECT value FROM sync_state/i.test(sql)) { const hit = state.get(args[0]); return { results: hit ? [{ value: hit.value }] : [] }; }
    if (/^DELETE FROM sync_state/i.test(sql)) { state.delete(args[0]); return { results: [] }; }
    for (const [pattern, handler] of Object.entries(extra)) if (new RegExp(pattern, "i").test(sql)) return handler(args, sql);
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
  };
  const prepare = (sql) => ({
    bind: (...args) => ({
      sql, args,
      run: async () => run(sql, args),
      all: async () => run(sql, args),
      first: async () => { const result = run(sql, args); return result.first ?? (result.results || [])[0] ?? null; },
    }),
    run: async () => run(sql, []),
    all: async () => run(sql, []),
    first: async () => { const result = run(sql, []); return result.first ?? (result.results || [])[0] ?? null; },
  });
  return {
    prepare,
    // Like the real adapter: one BEGIN…COMMIT, rolled back as a whole on error.
    batch: async (statements) => {
      batches.push(statements.length);
      const snapshot = { rows: rows.map((row) => ({ ...row })), days: new Map(days) };
      try {
        for (const statement of statements) await statement.run();
      } catch (error) {
        rows.length = 0; rows.push(...snapshot.rows);
        days.clear(); for (const [key, value] of snapshot.days) days.set(key, value);
        throw error;
      }
    },
    rows, days, log, state, batches,
  };
}
