-- C-513: community asset publishing.
--
-- Additive only: `asset_publish_staging` (the reserve/upload/commit recovery
-- point, CASCADE on account deletion) and `community_assets` (immutable,
-- content-addressed, moderated revisions, RESTRICT on account deletion).
-- No existing table or row changes.

CREATE TABLE `asset_publish_staging` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`slug` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`tag` text NOT NULL,
	`ext` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text,
	`staging_key` text NOT NULL,
	`state` text DEFAULT 'reserved' NOT NULL,
	`provenance_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `asset_publish_staging_slug_url_safe` CHECK(`slug` NOT GLOB '*[^a-z0-9-]*' AND length(`slug`) > 0),
	CONSTRAINT `asset_publish_staging_revision_positive` CHECK(`revision` >= 1),
	CONSTRAINT `asset_publish_staging_state_valid` CHECK(`state` IN ('reserved', 'uploaded', 'committed', 'rolled_back', 'orphaned')),
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_publish_staging_live_unique` ON `asset_publish_staging` (`owner_account_id`,`slug`,`revision`) WHERE `state` <> 'rolled_back';
--> statement-breakpoint
CREATE INDEX `asset_publish_staging_owner_account_id_idx` ON `asset_publish_staging` (`owner_account_id`);
--> statement-breakpoint
CREATE INDEX `asset_publish_staging_staging_key_idx` ON `asset_publish_staging` (`staging_key`);
--> statement-breakpoint
CREATE INDEX `asset_publish_staging_state_updated_at_idx` ON `asset_publish_staging` (`state`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `community_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`slug` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`tag` text NOT NULL,
	`sha256` text NOT NULL,
	`r2_key` text,
	`size_bytes` integer NOT NULL,
	`ext` text NOT NULL,
	`provenance_json` text NOT NULL,
	`license` text,
	`moderation_state` text DEFAULT 'pending' NOT NULL,
	`moderation_note` text,
	`moderated_by_account_id` text,
	`moderated_at` integer,
	`promoted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `community_assets_slug_url_safe` CHECK(`slug` NOT GLOB '*[^a-z0-9-]*' AND length(`slug`) > 0),
	CONSTRAINT `community_assets_revision_positive` CHECK(`revision` >= 1),
	CONSTRAINT `community_assets_moderation_state_valid` CHECK(`moderation_state` IN ('pending', 'approved', 'rejected')),
	CONSTRAINT `community_assets_ext_lowercase` CHECK(`ext` LIKE '.%' AND `ext` = lower(`ext`)),
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_assets_slug_revision_unique` ON `community_assets` (`slug`,`revision`);
--> statement-breakpoint
CREATE INDEX `community_assets_owner_account_id_idx` ON `community_assets` (`owner_account_id`);
--> statement-breakpoint
CREATE INDEX `community_assets_updated_at_idx` ON `community_assets` (`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX `community_assets_browse_idx` ON `community_assets` (`moderation_state`,`promoted_at`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `community_assets_sha256_idx` ON `community_assets` (`sha256`);
