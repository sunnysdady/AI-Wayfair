import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable("orders", {
  poNumber: text("po_number").primaryKey(),
  poDate: text("po_date").notNull(),
  revenueCents: integer("revenue_cents").notNull().default(0),
  units: integer("units").notNull().default(0),
  itemCount: integer("item_count").notNull().default(0),
  syncedAt: text("synced_at").notNull(),
}, (table) => [index("orders_po_date_idx").on(table.poDate)]);

export const orderItems = sqliteTable("order_items", {
  poNumber: text("po_number").notNull(),
  lineKey: text("line_key").notNull(),
  partNumber: text("part_number").notNull(),
  quantity: integer("quantity").notNull().default(0),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.poNumber, table.lineKey] }),
  index("order_items_part_number_idx").on(table.partNumber),
]);

export const skuCosts = sqliteTable("sku_costs", {
  partNumber: text("part_number").primaryKey(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  source: text("source").notNull().default("manual"),
  updatedAt: text("updated_at").notNull(),
});

export const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const adReportDays = sqliteTable("ad_report_days", {
  reportType: text("report_type").notNull(),
  reportDate: text("report_date").notNull(),
  refreshedAt: text("refreshed_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.reportType, table.reportDate] }),
  index("ad_report_days_date_idx").on(table.reportDate),
]);

export const adReportRows = sqliteTable("ad_report_rows", {
  reportType: text("report_type").notNull(),
  reportDate: text("report_date").notNull(),
  entityKey: text("entity_key").notNull(),
  payload: text("payload").notNull(),
  refreshedAt: text("refreshed_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.reportType, table.reportDate, table.entityKey] }),
  index("ad_report_rows_date_idx").on(table.reportDate),
]);

export const adDecisionRuns = sqliteTable("ad_decision_runs", {
  runKey: text("run_key").primaryKey(),
  decisionStart: text("decision_start").notNull(),
  decisionEnd: text("decision_end").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const adActionQueue = sqliteTable("ad_action_queue", {
  id: text("id").primaryKey(),
  runKey: text("run_key").notNull(),
  listing: text("listing").notNull(),
  campaignId: text("campaign_id").notNull(),
  actionType: text("action_type").notNull(),
  beforePayload: text("before_payload").notNull(),
  proposedPayload: text("proposed_payload").notNull(),
  status: text("status").notNull().default("PLANNED"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("ad_action_queue_run_idx").on(table.runKey)]);

export const adActionEvents = sqliteTable("ad_action_events", {
  id: text("id").primaryKey(),
  actionId: text("action_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("ad_action_events_action_idx").on(table.actionId)]);

export const adExecutionLocks = sqliteTable("ad_execution_locks", {
  runKey: text("run_key").primaryKey(),
  acquiredAt: text("acquired_at").notNull(),
});

export const adWeeklyReviews = sqliteTable("ad_weekly_reviews", {
  actionId: text("action_id").primaryKey(),
  sourceRunKey: text("source_run_key").notNull(),
  evaluationRunKey: text("evaluation_run_key").notNull(),
  listing: text("listing").notNull(),
  campaignId: text("campaign_id").notNull(),
  verdict: text("verdict").notNull(),
  payload: text("payload").notNull(),
  evaluatedAt: text("evaluated_at").notNull(),
}, (table) => [index("ad_weekly_reviews_listing_idx").on(table.listing)]);

export const outlookDailyBriefs = sqliteTable("outlook_daily_briefs", {
  briefDate: text("brief_date").primaryKey(),
  payload: text("payload").notNull(),
  syncedAt: text("synced_at").notNull(),
});

export const inventorySnapshots = sqliteTable("inventory_snapshots", {
  id: text("id").primaryKey(),
  sourceFile: text("source_file").notNull(),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull(),
});

export const inventorySnapshotRows = sqliteTable("inventory_snapshot_rows", {
  snapshotId: text("snapshot_id").notNull(),
  partNumber: text("part_number").notNull(),
  supplierId: integer("supplier_id").notNull(),
  quantityOnHand: integer("quantity_on_hand").notNull(),
  quantityOnOrder: integer("quantity_on_order").notNull(),
  warehouse: text("warehouse").notNull(),
  sourceSku: text("source_sku").notNull(),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.partNumber, table.supplierId] }),
  index("inventory_snapshot_rows_part_idx").on(table.partNumber),
]);

export const reportUploads = sqliteTable("report_uploads", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  contentType: text("content_type").notNull(),
  objectKey: text("object_key").notNull(),
  createdAt: text("created_at").notNull(),
});
