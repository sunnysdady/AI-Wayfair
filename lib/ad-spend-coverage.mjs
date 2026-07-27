const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Advertising spend coverage is decided by the `ad_report_days` ledger, never by
 * how many `ad_report_rows` a window happens to hold. A synced day with no rows
 * is a real zero-spend day once that day has closed; a day that was only synced
 * while it was still running stays pending, because an empty intraday report is
 * indistinguishable from "Wayfair has not reported yet". Counting it as $0 would
 * understate ad cost and overstate contribution.
 */

function addDays(value, days) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function datesBetween(start, end) {
  const result = [];
  for (let value = start; value <= end; value = addDays(value, 1)) result.push(value);
  return result;
}

function shanghaiDate(timestamp) {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * @param {object} input
 * @param {string} input.start Inclusive Shanghai date (YYYY-MM-DD).
 * @param {string} input.end Inclusive Shanghai date (YYYY-MM-DD).
 * @param {{reportDate: string, refreshedAt?: string}[]} input.days `ad_report_days` ledger entries.
 * @param {{reportDate: string, spend: number}[]} input.rows Stored campaign rows.
 * @param {string} input.asOf Current Shanghai date; dates on or after it are still accruing.
 */
export function summarizeAdSpendCoverage({ start, end, days = [], rows = [], asOf }) {
  const ledger = new Map(days.map((day) => [day.reportDate, day.refreshedAt || null]));
  const spendByDate = new Map();
  for (const row of rows) {
    if (row.reportDate < start || row.reportDate > end) continue;
    const spend = Number(row.spend);
    spendByDate.set(row.reportDate, (spendByDate.get(row.reportDate) || 0) + (Number.isFinite(spend) ? spend : 0));
  }

  const expectedDays = datesBetween(start, end);
  let spend = 0;
  let knownDays = 0;
  let settledDays = 0;
  const pending = [];
  const missing = [];

  for (const date of expectedDays) {
    if (!ledger.has(date)) {
      missing.push(date);
      continue;
    }
    const hasRows = spendByDate.has(date);
    const dayClosed = date < asOf;
    const refreshedAfterClose = dayClosed && (shanghaiDate(ledger.get(date)) || "") > date;

    if (hasRows) {
      spend += spendByDate.get(date);
      knownDays += 1;
      if (dayClosed) settledDays += 1;
      continue;
    }
    if (refreshedAfterClose) {
      knownDays += 1;
      settledDays += 1;
      continue;
    }
    pending.push(date);
  }

  if (!knownDays) {
    return {
      spend: null,
      coverage: missing.length === expectedDays.length ? "NOT_SYNCED" : "PENDING",
      coveredDays: 0,
      expectedDays: expectedDays.length,
      pendingDays: pending,
      missingDays: missing,
    };
  }

  return {
    spend: Number(spend.toFixed(2)),
    coverage: settledDays === expectedDays.length ? "FULL" : "PARTIAL",
    coveredDays: knownDays,
    expectedDays: expectedDays.length,
    pendingDays: pending,
    missingDays: missing,
  };
}
