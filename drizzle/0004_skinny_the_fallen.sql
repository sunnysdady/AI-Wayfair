CREATE TABLE `report_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text NOT NULL
);
