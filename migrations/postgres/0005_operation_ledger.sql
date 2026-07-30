CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  title TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '待分派',
  status TEXT NOT NULL DEFAULT 'DISCOVERED',
  proposed_action TEXT NOT NULL,
  before_state TEXT NOT NULL DEFAULT '{}',
  intended_after_state TEXT NOT NULL DEFAULT '{}',
  execution_result TEXT,
  terminal_receipt TEXT,
  evidence TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria TEXT,
  accepted_by TEXT,
  review_due_at TIMESTAMPTZ,
  review_verdict TEXT,
  rollback_link TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS operations_status_idx ON operations(status, updated_at);
CREATE INDEX IF NOT EXISTS operations_object_idx ON operations(object_type, object_id);

CREATE TABLE IF NOT EXISTS operation_events (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_events_operation_idx ON operation_events(operation_id, created_at);

ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS operation_id TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT '待分派';
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS execution_result TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS evidence TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS accepted_by TEXT;
ALTER TABLE ad_manual_completions ADD COLUMN IF NOT EXISTS review_due_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ad_zombie_resolutions (
  resolution_key TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  listing TEXT NOT NULL,
  action_type TEXT NOT NULL,
  method TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '待分派',
  status TEXT NOT NULL DEFAULT 'DISCOVERED',
  execution_result TEXT,
  evidence TEXT,
  acceptance_criteria TEXT NOT NULL,
  accepted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

UPDATE ad_manual_completions
SET status='PENDING_ACCEPTANCE',
    operation_id='manual:' || task_key,
    owner=COALESCE(NULLIF(owner,''),'待分派'),
    execution_result=COALESCE(NULLIF(execution_result,''),'旧版记录仅确认曾勾选，等待补充平台实际结果'),
    evidence=COALESCE(NULLIF(evidence,''),'legacy-server-completion'),
    acceptance_criteria=COALESCE(NULLIF(acceptance_criteria,''),'补充平台证据并由负责人验收')
WHERE status='COMPLETED';

UPDATE ad_manual_completions
SET operation_id=COALESCE(operation_id,'manual:' || task_key)
WHERE operation_id IS NULL;

INSERT INTO operations(
  id,source_type,source_id,object_type,object_id,title,owner,status,proposed_action,
  before_state,intended_after_state,execution_result,evidence,acceptance_criteria,
  accepted_by,review_due_at,created_at,updated_at,closed_at
)
SELECT
  'manual:' || task_key,'MANUAL_AD',task_key,'PARENT_SKU',parent_sku,
  COALESCE(NULLIF(title,''),task_id),COALESCE(NULLIF(owner,''),'待分派'),
  CASE status
    WHEN 'VERIFIED' THEN 'VERIFIED'
    WHEN 'PENDING_ACCEPTANCE' THEN 'PENDING_ACCEPTANCE'
    WHEN 'IN_PROGRESS' THEN 'EXECUTING'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'REOPENED' THEN 'REOPENED'
    ELSE 'DISCOVERED'
  END,
  COALESCE(NULLIF(title,''),task_id),
  json_build_object('campaignId',campaign_id,'adGroup',ad_group)::TEXT,
  json_build_object('acceptanceCriteria',COALESCE(acceptance_criteria,''))::TEXT,
  execution_result,
  CASE WHEN evidence IS NULL OR evidence='' THEN '[]' ELSE json_build_array(json_build_object('type','NOTE','value',evidence))::TEXT END,
  acceptance_criteria,accepted_by,review_due_at,updated_at,updated_at,NULL
FROM ad_manual_completions
ON CONFLICT(id) DO NOTHING;

INSERT INTO operations(
  id,source_type,source_id,object_type,object_id,title,owner,status,proposed_action,
  before_state,intended_after_state,execution_result,terminal_receipt,evidence,
  acceptance_criteria,accepted_by,review_due_at,review_verdict,rollback_link,
  created_at,updated_at,closed_at
)
SELECT
  'ad:' || q.id,'AD_ACTION_QUEUE',q.run_key,'CAMPAIGN_LISTING',
  q.campaign_id || ':' || q.listing,q.listing || ' · ' || q.action_type,
  '广告运营',
  CASE
    WHEN r.verdict IS NOT NULL AND r.verdict<>'PENDING' THEN 'CLOSED'
    WHEN r.verdict='PENDING' THEN 'PENDING_REVIEW'
    WHEN q.status='EXECUTED' THEN 'PENDING_ACCEPTANCE'
    WHEN q.status='EXECUTING' THEN 'EXECUTING'
    WHEN q.status='VALIDATED' THEN 'PREFLIGHTED'
    WHEN q.status='FAILED' THEN 'FAILED'
    ELSE 'PENDING_APPROVAL'
  END,
  q.action_type,q.before_payload,q.proposed_payload,
  CASE
    WHEN r.verdict IS NOT NULL THEN COALESCE(r.payload,'成熟复盘已生成')
    WHEN q.status='EXECUTED' THEN '历史 Wayfair API 动作已执行，等待验收或成熟复盘'
    WHEN q.status='FAILED' THEN '历史广告动作执行失败'
    ELSE NULL
  END,
  CASE WHEN q.status='EXECUTED' THEN q.id ELSE NULL END,
  CASE
    WHEN r.verdict IS NOT NULL THEN json_build_array(json_build_object('type','MATURE_REVIEW','value',r.payload))::TEXT
    WHEN q.status='EXECUTED' THEN json_build_array(json_build_object('type','LEGACY_EVENT','value',q.id))::TEXT
    ELSE '[]'
  END,
  CASE WHEN q.status='EXECUTED' OR r.verdict IS NOT NULL THEN 'Wayfair API 返回终态，并在成熟归因窗口完成效果复盘' ELSE NULL END,
  CASE WHEN r.verdict IS NOT NULL THEN '广告成熟复盘' ELSE NULL END,
  CASE WHEN q.status='EXECUTED' THEN q.updated_at::TIMESTAMPTZ + INTERVAL '7 days' ELSE NULL END,
  CASE WHEN r.verdict IS NOT NULL AND r.verdict<>'PENDING' THEN r.verdict ELSE NULL END,
  '/ads/review?action=' || q.id,
  q.created_at::TIMESTAMPTZ,q.updated_at::TIMESTAMPTZ,
  CASE WHEN r.verdict IS NOT NULL AND r.verdict<>'PENDING' THEN r.evaluated_at::TIMESTAMPTZ ELSE NULL END
FROM ad_action_queue q
LEFT JOIN ad_weekly_reviews r ON r.action_id=q.id
ON CONFLICT(id) DO NOTHING;

INSERT INTO operation_events(id,operation_id,event_type,from_status,to_status,payload,created_at)
SELECT
  'backfill:' || id,id,'BACKFILLED',NULL,status,
  json_build_object('source','0005_operation_ledger')::TEXT,updated_at
FROM operations
ON CONFLICT(id) DO NOTHING;
