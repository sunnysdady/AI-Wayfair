CREATE TABLE IF NOT EXISTS daily_operating_reports (
  report_date TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  generation_mode TEXT NOT NULL DEFAULT 'SCHEDULED'
);

CREATE INDEX IF NOT EXISTS daily_operating_reports_generated_idx
  ON daily_operating_reports(generated_at DESC);
