CREATE TABLE `order_items` (
	`po_number` text NOT NULL,
	`line_key` text NOT NULL,
	`part_number` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`unit_price_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`po_number`, `line_key`)
);
--> statement-breakpoint
CREATE INDEX `order_items_part_number_idx` ON `order_items` (`part_number`);--> statement-breakpoint
CREATE TABLE `orders` (
	`po_number` text PRIMARY KEY NOT NULL,
	`po_date` text NOT NULL,
	`revenue_cents` integer DEFAULT 0 NOT NULL,
	`units` integer DEFAULT 0 NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orders_po_date_idx` ON `orders` (`po_date`);--> statement-breakpoint
CREATE TABLE `sku_costs` (
	`part_number` text PRIMARY KEY NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
