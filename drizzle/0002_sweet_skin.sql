CREATE TABLE `ad_action_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`run_key` text NOT NULL,
	`listing` text NOT NULL,
	`campaign_id` text NOT NULL,
	`action_type` text NOT NULL,
	`before_payload` text NOT NULL,
	`proposed_payload` text NOT NULL,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ad_action_queue_run_idx` ON `ad_action_queue` (`run_key`);