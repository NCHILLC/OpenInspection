CREATE TABLE `field_log_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`route` text,
	`status` integer,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `idx_field_log_events_inspection` ON `field_log_events` (`tenant_id`,`inspection_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_field_log_events_occurred_at` ON `field_log_events` (`occurred_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `is_field_log_enabled` integer DEFAULT false NOT NULL;
