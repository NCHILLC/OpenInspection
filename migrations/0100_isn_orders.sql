CREATE TABLE `isn_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`isn_order_id` text NOT NULL,
	`inspection_id` text,
	`payload` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_isn_orders_tenant_order` ON `isn_orders` (`tenant_id`,`isn_order_id`);