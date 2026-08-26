export type DailyOperatingReportInput = Record<string, unknown>;

export function dailyOperatingReportDue(input?: {
  now?: Date;
  existingReportDate?: string | null;
}): boolean;

export function buildDailyOperatingReport(
  input?: DailyOperatingReportInput,
): Record<string, unknown>;
