// Lingxing groups Wayfair YB / NA reporting by the store's local business day.
// IANA naming keeps the UTC boundary correct when North America enters or exits DST.
export const LINGXING_TIME_ZONE = "America/New_York";

function date(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError("Expected a valid date");
  return parsed;
}

function parts(value, options) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: LINGXING_TIME_ZONE,
      hourCycle: "h23",
      ...options,
    }).formatToParts(date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function assertBusinessDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new TypeError("Expected a YYYY-MM-DD business date");
  }
  return value.split("-").map(Number);
}

export function lingxingDate(value = new Date()) {
  const result = parts(value, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${result.year}-${result.month}-${result.day}`;
}

export function lingxingHour(value = new Date()) {
  return Number(parts(value, { hour: "2-digit" }).hour);
}

export function shiftLingxingDate(value, days) {
  const [year, month, day] = assertBusinessDate(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function lingxingDayStart(value) {
  const [year, month, day] = assertBusinessDate(value);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = target;

  // Reproject until the instant displays as the requested local midnight. This
  // handles the two dates per year whose offset changes after midnight.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = parts(new Date(candidate), {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const displayed = Date.UTC(
      Number(local.year), Number(local.month) - 1, Number(local.day),
      Number(local.hour), Number(local.minute), Number(local.second),
    );
    const adjustment = target - displayed;
    candidate += adjustment;
    if (adjustment === 0) return new Date(candidate).toISOString();
  }

  throw new Error(`Unable to resolve Lingxing midnight for ${value}`);
}

export function formatLingxingDateTime(value, locale = "zh-CN") {
  return date(value).toLocaleString(locale, { timeZone: LINGXING_TIME_ZONE });
}
