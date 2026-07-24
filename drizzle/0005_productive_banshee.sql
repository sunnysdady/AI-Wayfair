CREATE TABLE `ad_action_events` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ad_action_events_action_idx` ON `ad_action_events` (`action_id`);