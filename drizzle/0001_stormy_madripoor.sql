CREATE TABLE `ad_decision_runs` (
	`run_key` text PRIMARY KEY NOT NULL,
	`decision_start` text NOT NULL,
	`decision_end` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ad_report_days` (
	`report_type` text NOT NULL,
	`report_date` text NOT NULL,
	`refreshed_at` text NOT NULL,
	PRIMARY KEY(`report_type`, `report_date`)
);
--> statement-breakpoint
CREATE INDEX `ad_report_days_date_idx` ON `ad_report_days` (`report_date`);--> statement-breakpoint
CREATE TABLE `ad_report_rows` (
	`report_type` text NOT NULL,
	`report_date` text NOT NULL,
	`entity_key` text NOT NULL,
	`payload` text NOT NULL,
	`refreshed_at` text NOT NULL,
	PRIMARY KEY(`report_type`, `report_date`, `entity_key`)
);
--> statement-breakpoint
CREATE INDEX `ad_report_rows_date_idx` ON `ad_report_rows` (`report_date`);