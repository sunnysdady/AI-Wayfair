ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS operation_id TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT '待分派';
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS execution_result TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS evidence TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS accepted_by TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS review_due_at TEXT;
