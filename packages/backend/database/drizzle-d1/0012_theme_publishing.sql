-- packages/backend/database/drizzle-d1/0012_theme_publishing.sql
--
-- C-530 AC-9: the additive Hub theme-publishing tables.
--
-- This is drizzle-kit's own `generate` output for `theme_publish_staging` and
-- `theme_versions` (`schema.ts` is the single source of truth — no DDL was
-- written by hand). It is filed as migration 0012 because `drizzle-d1/meta/`
-- is gitignored: a fresh `drizzle-kit generate` cannot see the 0000-0011
-- snapshot and emits a whole-schema 0000 instead of the delta.
--
-- Additive only. No `community_assets`, `asset_publish_staging`,
-- `asset_publish_rate_limits`, `user`, `session` or `account` statement appears
-- here, so existing image/audio/map publish, browse and moderation behaviour is
-- untouched and no live table is rebuilt. In particular the closed three-state
-- `community_assets_moderation_state_valid` CHECK is NOT altered: a withdrawn
-- theme version is expressed as `theme_versions.revoked_at`, not as a fourth
-- moderation state (SQLite cannot alter a CHECK in place).
CREATE TABLE `theme_publish_staging` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`slug` text NOT NULL,
	`version` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text,
	`staging_key` text NOT NULL,
	`state` text DEFAULT 'reserved' NOT NULL,
	`provenance_json` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `theme_publish_staging_slug_url_safe` CHECK(`slug` NOT GLOB '*[^a-z0-9-]*' AND length(`slug`) > 0),
	CONSTRAINT `theme_publish_staging_version_semver` CHECK(`version` NOT GLOB '*[^0-9.]*' AND length(`version`) >= 5),
	CONSTRAINT `theme_publish_staging_state_valid` CHECK(`state` IN ('reserved', 'uploaded', 'committed', 'rolled_back', 'orphaned')),
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `theme_publish_staging_live_unique` ON `theme_publish_staging` (`owner_account_id`,`slug`,`version`) WHERE `state` <> 'rolled_back';
--> statement-breakpoint
CREATE INDEX `theme_publish_staging_owner_account_id_idx` ON `theme_publish_staging` (`owner_account_id`);
--> statement-breakpoint
CREATE INDEX `theme_publish_staging_staging_key_idx` ON `theme_publish_staging` (`staging_key`);
--> statement-breakpoint
CREATE INDEX `theme_publish_staging_state_updated_at_idx` ON `theme_publish_staging` (`state`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `theme_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`slug` text NOT NULL,
	`version` text NOT NULL,
	`name` text NOT NULL,
	`author_display_name` text NOT NULL,
	`license` text NOT NULL,
	`theme_api_range` text NOT NULL,
	`manifest_json` text NOT NULL,
	`variants_json` text NOT NULL,
	`variant_facts_json` text NOT NULL,
	`asset_count` integer NOT NULL,
	`package_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`r2_key` text,
	`ext` text DEFAULT '.zip' NOT NULL,
	`provenance_json` text NOT NULL,
	`moderation_state` text DEFAULT 'pending' NOT NULL,
	`moderation_note` text,
	`moderated_by_account_id` text,
	`moderated_at` integer,
	`promoted_at` integer,
	`revoked_at` integer,
	`has_hud_preset` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `theme_versions_slug_url_safe` CHECK(`slug` NOT GLOB '*[^a-z0-9-]*' AND length(`slug`) > 0),
	CONSTRAINT `theme_versions_version_semver` CHECK(`version` NOT GLOB '*[^0-9.]*' AND length(`version`) >= 5),
	CONSTRAINT `theme_versions_moderation_state_valid` CHECK(`moderation_state` IN ('pending', 'approved', 'rejected')),
	CONSTRAINT `theme_versions_revoked_requires_approval` CHECK(`revoked_at` IS NULL OR `moderation_state` = 'approved'),
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `theme_versions_slug_version_unique` ON `theme_versions` (`slug`,`version`);
--> statement-breakpoint
CREATE INDEX `theme_versions_owner_account_id_idx` ON `theme_versions` (`owner_account_id`);
--> statement-breakpoint
CREATE INDEX `theme_versions_browse_idx` ON `theme_versions` (`moderation_state`,`promoted_at`,`revoked_at`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `theme_versions_sha256_idx` ON `theme_versions` (`sha256`);
