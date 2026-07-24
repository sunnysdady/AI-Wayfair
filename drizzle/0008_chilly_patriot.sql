CREATE TABLE `inventory_push_batches` (
	`push_id` text NOT NULL,
	`batch_index` integer NOT NULL,
	`feed_id` text,
	`handle` text,
	`status` text NOT NULL,
	`state` text NOT NULL,
	`expected_item_count` integer NOT NULL,
	`item_count` integer,
	`error_count` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`submitted_at` text,
	`completed_at` text,
	`reason` text,
	PRIMARY KEY(`push_id`, `batch_index`)
);
--> statement-breakpoint
CREATE INDEX `inventory_push_batches_push_idx` ON `inventory_push_batches` (`push_id`);--> statement-breakpoint
CREATE TABLE `inventory_push_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`status` text NOT NULL,
	`item_count` integer NOT NULL,
	`batch_count` integer NOT NULL,
	`completed_batches` integer DEFAULT 0 NOT NULL,
	`failed_batches` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inventory_push_runs_snapshot_idx` ON `inventory_push_runs` (`snapshot_id`);
