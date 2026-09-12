-- Preserve every immutable community-map revision and support bounded newest-first listing.

CREATE TABLE `community_maps_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`owner_account_id` text NOT NULL,
	`title` text NOT NULL,
	`revision` integer NOT NULL,
	`document_hash` text NOT NULL,
	`r2_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`document` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `community_maps_slug_url_safe` CHECK(`slug` NOT GLOB '*[^a-z0-9-]*' AND length(`slug`) > 0),
	CONSTRAINT `community_maps_revision_positive` CHECK(`revision` >= 1),
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `community_maps_revisions` SELECT * FROM `community_maps`;
--> statement-breakpoint
DROP TABLE `community_maps`;
--> statement-breakpoint
ALTER TABLE `community_maps_revisions` RENAME TO `community_maps`;
--> statement-breakpoint
CREATE UNIQUE INDEX `community_maps_slug_revision_unique` ON `community_maps` (`slug`, `revision`);
--> statement-breakpoint
CREATE INDEX `community_maps_owner_account_id_idx` ON `community_maps` (`owner_account_id`);
--> statement-breakpoint
CREATE INDEX `community_maps_updated_at_idx` ON `community_maps` (`updated_at`, `id`);
