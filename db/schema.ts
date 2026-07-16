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
