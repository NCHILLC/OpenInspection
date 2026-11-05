CREATE TABLE `isn_order_type_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`isn_order_type_id` text NOT NULL,
	`template_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_isn_order_type_templates_tenant_type` ON `isn_order_type_templates` (`tenant_id`,`isn_order_type_id`);