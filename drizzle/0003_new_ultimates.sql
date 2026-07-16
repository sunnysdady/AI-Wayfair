CREATE TABLE `inventory_snapshot_rows` (
	`snapshot_id` text NOT NULL,
	`part_number` text NOT NULL,
	`supplier_id` integer NOT NULL,
	`quantity_on_hand` integer NOT NULL,
	`quantity_on_order` integer NOT NULL,
	`warehouse` text NOT NULL,
	`source_sku` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `part_number`, `supplier_id`)
);
--> statement-breakpoint
CREATE INDEX `inventory_snapshot_rows_part_idx` ON `inventory_snapshot_rows` (`part_number`);--> statement-breakpoint
CREATE TABLE `inventory_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_file` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
