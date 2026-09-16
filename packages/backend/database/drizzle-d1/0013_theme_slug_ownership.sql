-- packages/backend/database/drizzle-d1/0013_theme_slug_ownership.sql
--
-- Globally claims each theme slug before another immutable version can be
-- reserved. Existing committed versions win first; live staging rows backfill
-- slugs that have not reached the committed table yet.
CREATE TABLE `theme_slugs` (
	`slug` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `theme_slugs_slug_url_safe` CHECK(`slug` NOT GLOB '*[^a-z0-9-]*' AND length(`slug`) > 0),
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `theme_slugs_owner_account_id_idx` ON `theme_slugs` (`owner_account_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `theme_slugs` (`slug`, `owner_account_id`, `created_at`, `updated_at`)
SELECT `slug`, `owner_account_id`, MIN(`created_at`), MAX(`updated_at`)
FROM `theme_versions`
GROUP BY `slug`, `owner_account_id`
ORDER BY MIN(`created_at`), `owner_account_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `theme_slugs` (`slug`, `owner_account_id`, `created_at`, `updated_at`)
SELECT `slug`, `owner_account_id`, MIN(`created_at`), MAX(`updated_at`)
FROM `theme_publish_staging`
WHERE `state` <> 'rolled_back'
GROUP BY `slug`, `owner_account_id`
ORDER BY MIN(`created_at`), `owner_account_id`;
