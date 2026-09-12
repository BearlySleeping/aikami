-- C-508: Map Studio Phase 3 — per-user drafts + community map publishing.
--
-- Two new tables back the hub-served community namespace:
--   * map_drafts    — a creator's private, owner-scoped scene document.
--   * community_maps — published community maps, immutable per revision.
--
-- The curated catalog stays a CI-owned static R2 index; these rows only cover
-- the user-authored namespace. `owner_account_id` references Better Auth's
-- `user.id` (not the retired `accounts.id`).
--
-- Hand-written: drizzle-kit cannot generate against the stale local `meta/`
-- snapshots (gitignored), matching 0005/0006.

CREATE TABLE `map_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`name` text NOT NULL,
	`document` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `map_drafts_owner_account_id_idx` ON `map_drafts` (`owner_account_id`);--> statement-breakpoint
CREATE TABLE `community_maps` (
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
CREATE UNIQUE INDEX `community_maps_slug_unique` ON `community_maps` (`slug`);--> statement-breakpoint
CREATE INDEX `community_maps_owner_account_id_idx` ON `community_maps` (`owner_account_id`);
