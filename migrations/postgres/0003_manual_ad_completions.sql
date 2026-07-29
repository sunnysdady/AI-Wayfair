CREATE TABLE IF NOT EXISTS ad_manual_completions (
  task_key TEXT PRIMARY KEY,
  parent_sku TEXT NOT NULL,
  task_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL DEFAULT '',
  ad_group TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '运营负责人',
  assignee TEXT NOT NULL DEFAULT '广告 Agent',
  execution_channel TEXT NOT NULL DEFAULT 'Wayfair Partner Home',
  execution_result TEXT NOT NULL DEFAULT '',
  wayfair_evidence TEXT NOT NULL DEFAULT '',
  receiver TEXT NOT NULL DEFAULT '',
  review_date TEXT NOT NULL DEFAULT '',
  closed_loop_status TEXT NOT NULL DEFAULT 'ASSIGNED',
  status TEXT NOT NULL DEFAULT 'OPEN',
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_manual_completion_events (
  id TEXT PRIMARY KEY,
  task_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_manual_completion_events_task_idx ON ad_manual_completion_events(task_key);
