-- The assistant reads the existing normalized snapshots instead of maintaining
-- a second copy of operational data. This audit table records only query text,
-- result count and time, so retrieval remains traceable without duplicating data.
CREATE TABLE IF NOT EXISTS assistant_query_audit (
  id TEXT PRIMARY KEY,
  query_text TEXT NOT NULL CHECK (char_length(query_text) BETWEEN 2 AND 120),
  result_count INTEGER NOT NULL CHECK (result_count >= 0),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_query_audit_created_idx
  ON assistant_query_audit(created_at DESC);

-- Support the bounded, newest-snapshot lookups used by the assistant.
CREATE INDEX IF NOT EXISTS inventory_snapshots_created_idx
  ON inventory_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS report_uploads_created_idx
  ON report_uploads(created_at DESC);
CREATE INDEX IF NOT EXISTS ad_action_queue_listing_status_updated_idx
  ON ad_action_queue(listing, status, updated_at DESC);
