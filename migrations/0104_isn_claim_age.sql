ALTER TABLE `isn_orders` ADD `claim_started_at` integer;
UPDATE isn_orders SET claim_started_at = fetched_at WHERE inspection_id LIKE 'pending:%';
