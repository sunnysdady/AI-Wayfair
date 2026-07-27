CREATE TABLE IF NOT EXISTS orders (
  po_number TEXT PRIMARY KEY,
  po_date TIMESTAMPTZ NOT NULL,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  units INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_po_date_idx ON orders(po_date);

CREATE TABLE IF NOT EXISTS order_items (
  po_number TEXT NOT NULL,
  line_key TEXT NOT NULL,
  part_number TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (po_number, line_key)
);
CREATE INDEX IF NOT EXISTS order_items_part_number_idx ON order_items(part_number);

CREATE TABLE IF NOT EXISTS sku_costs (
  part_number TEXT PRIMARY KEY,
  unit_cost_cents INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_locks (
  key TEXT PRIMARY KEY,
  acquired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_report_days (
  report_type TEXT NOT NULL,
  report_date TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (report_type, report_date)
);
CREATE INDEX IF NOT EXISTS ad_report_days_date_idx ON ad_report_days(report_date);

CREATE TABLE IF NOT EXISTS ad_report_rows (
  report_type TEXT NOT NULL,
  report_date TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (report_type, report_date, entity_key)
);
CREATE INDEX IF NOT EXISTS ad_report_rows_date_idx ON ad_report_rows(report_date);

CREATE TABLE IF NOT EXISTS ad_decision_runs (
  run_key TEXT PRIMARY KEY,
  decision_start TEXT NOT NULL,
  decision_end TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_action_queue (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL,
  listing TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  before_payload TEXT NOT NULL,
  proposed_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_action_queue_run_idx ON ad_action_queue(run_key);

CREATE TABLE IF NOT EXISTS ad_action_events (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_action_events_action_idx ON ad_action_events(action_id);

CREATE TABLE IF NOT EXISTS ad_execution_locks (
  run_key TEXT PRIMARY KEY,
  acquired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_weekly_reviews (
  action_id TEXT PRIMARY KEY,
  source_run_key TEXT NOT NULL,
  evaluation_run_key TEXT NOT NULL,
  listing TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  payload TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_weekly_reviews_listing_idx ON ad_weekly_reviews(listing);

CREATE TABLE IF NOT EXISTS ad_manual_completions (
  task_key TEXT PRIMARY KEY,
  parent_sku TEXT NOT NULL,
  task_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL DEFAULT '',
  ad_group TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS outlook_daily_briefs (
  brief_date TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_snapshot_rows (
  snapshot_id TEXT NOT NULL,
  part_number TEXT NOT NULL,
  supplier_id INTEGER NOT NULL,
  quantity_on_hand INTEGER NOT NULL,
  quantity_on_order INTEGER NOT NULL,
  warehouse TEXT NOT NULL,
  source_sku TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, part_number, supplier_id)
);
CREATE INDEX IF NOT EXISTS inventory_snapshot_rows_part_idx ON inventory_snapshot_rows(part_number);

CREATE TABLE IF NOT EXISTS inventory_push_runs (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  status TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  batch_count INTEGER NOT NULL,
  completed_batches INTEGER NOT NULL DEFAULT 0,
  failed_batches INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_push_runs_snapshot_idx ON inventory_push_runs(snapshot_id);

CREATE TABLE IF NOT EXISTS inventory_push_batches (
  push_id TEXT NOT NULL,
  batch_index INTEGER NOT NULL,
  feed_id TEXT,
  handle TEXT,
  status TEXT NOT NULL,
  state TEXT NOT NULL,
  expected_item_count INTEGER NOT NULL,
  item_count INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER,
  processing_count INTEGER,
  errors TEXT NOT NULL DEFAULT '[]',
  submitted_at TEXT,
  completed_at TEXT,
  reason TEXT,
  PRIMARY KEY (push_id, batch_index)
);
CREATE INDEX IF NOT EXISTS inventory_push_batches_push_idx ON inventory_push_batches(push_id);

CREATE TABLE IF NOT EXISTS report_uploads (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_type TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
