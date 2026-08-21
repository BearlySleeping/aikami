PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`owner_account_id` text NOT NULL,
	`visibility` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "packs_slug_url_safe" CHECK("__new_packs"."slug" NOT GLOB '*[^a-z0-9-]*' AND length("__new_packs"."slug") > 0),
	CONSTRAINT "packs_visibility_valid" CHECK("__new_packs"."visibility" IN ('draft', 'public', 'unlisted', 'removed'))
);
--> statement-breakpoint
INSERT INTO `__new_packs`("id", "slug", "owner_account_id", "visibility", "created_at", "updated_at") SELECT "id", "slug", "owner_account_id", "visibility", "created_at", "updated_at" FROM `packs`;--> statement-breakpoint
DROP TABLE `packs`;--> statement-breakpoint
ALTER TABLE `__new_packs` RENAME TO `packs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `packs_slug_unique` ON `packs` (`slug`);--> statement-breakpoint
CREATE INDEX `packs_owner_account_id_idx` ON `packs` (`owner_account_id`);