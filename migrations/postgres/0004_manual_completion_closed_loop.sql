ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT '运营负责人';
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS assignee TEXT NOT NULL DEFAULT '广告 Agent';
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS execution_channel TEXT NOT NULL DEFAULT 'Wayfair Partner Home';
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS execution_result TEXT NOT NULL DEFAULT '';
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS wayfair_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS receiver TEXT NOT NULL DEFAULT '';
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS review_date TEXT NOT NULL DEFAULT '';
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS closed_loop_status TEXT NOT NULL DEFAULT 'ASSIGNED';
