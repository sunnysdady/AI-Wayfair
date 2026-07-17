CREATE TABLE `ad_weekly_reviews` (
	`action_id` text PRIMARY KEY NOT NULL,
	`source_run_key` text NOT NULL,
	`evaluation_run_key` text NOT NULL,
	`listing` text NOT NULL,
	`campaign_id` text NOT NULL,
	`verdict` text NOT NULL,
	`payload` text NOT NULL,
	`evaluated_at` text NOT NULL
);
CREATE INDEX `ad_weekly_reviews_listing_idx` ON `ad_weekly_reviews` (`listing`);
CREATE TABLE `outlook_daily_briefs` (
	`brief_date` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`synced_at` text NOT NULL
);
