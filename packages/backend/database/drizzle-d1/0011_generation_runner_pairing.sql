-- packages/backend/database/drizzle-d1/0011_generation_runner_pairing.sql
--
-- C-522 AC-7: the additive Hub-side pairing/dispatch/candidate tables.
--
-- Every statement below is drizzle-kit's own `generate` output for these five
-- tables (`schema.ts` is the single source of truth — no DDL was written by
-- hand). It is filed as migration 0011 because `drizzle-d1/meta/` is
-- gitignored: a fresh `drizzle-kit generate` cannot see the 0000-0010 snapshot
-- and emits a whole-schema 0000 instead of the delta. The DDL is unchanged.
--
-- Additive only: no `user` / `session` / `account` / `account_backups`
-- statement appears here, which is what lets AC-7 count identity and save rows
-- as identical before and after. Rolling back means disabling the Hub
-- generation routes; local jobs and accepted files are untouched.
CREATE TABLE `runner_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`label` text NOT NULL,
	`platform` text NOT NULL,
	`modalities_json` text NOT NULL,
	`resource_groups_json` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`artifact_upload_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "runner_devices_platform_valid" CHECK("runner_devices"."platform" IN ('linux', 'macos', 'windows', 'unknown'))
);

--> statement-breakpoint
CREATE TABLE `runner_pairing_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`device_id` text,
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
CREATE TABLE `generation_dispatches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`device_id` text NOT NULL,
	`job_id` text NOT NULL,
	`request_key` text NOT NULL,
	`effective_spec_hash` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`modality` text NOT NULL,
	`spec_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`lease_id` text,
	`lease_resource_group` text,
	`lease_owner` text,
	`lease_pid` integer,
	`lease_acquired_at` integer,
	`lease_expires_at` integer,
	`claimed_at` integer,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`candidate_id` text,
	`prepared_hash` text,
	`failure_json` text,
	`cancellation_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `runner_devices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "generation_dispatches_attempt_positive" CHECK("generation_dispatches"."attempt" >= 1),
	CONSTRAINT "generation_dispatches_modality_valid" CHECK("generation_dispatches"."modality" IN ('image', 'audio', 'video')),
	CONSTRAINT "generation_dispatches_status_valid" CHECK("generation_dispatches"."status" IN ('planned', 'queued', 'running', 'preparing', 'awaiting_review', 'succeeded', 'failed', 'interrupted', 'cancelled', 'reconciliation_required')),
	CONSTRAINT "generation_dispatches_candidate_count_non_negative" CHECK("generation_dispatches"."candidate_count" >= 0)
);

--> statement-breakpoint
CREATE TABLE `generation_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`job_id` text NOT NULL,
	`item_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`provider_profile_id` text NOT NULL,
	`effective_spec_hash` text NOT NULL,
	`attempt` integer NOT NULL,
	`seed` integer NOT NULL,
	`prepared_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provenance_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dispatch_id`) REFERENCES `generation_dispatches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "generation_candidates_attempt_positive" CHECK("generation_candidates"."attempt" >= 1),
	CONSTRAINT "generation_candidates_status_valid" CHECK("generation_candidates"."status" IN ('pending', 'accepted', 'rejected'))
);

--> statement-breakpoint
CREATE TABLE `runner_artifact_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`device_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`staging_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`uploaded_at` integer,
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dispatch_id`) REFERENCES `generation_dispatches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "runner_artifact_tickets_kind_valid" CHECK("runner_artifact_tickets"."kind" IN ('image', 'audio')),
	CONSTRAINT "runner_artifact_tickets_bytes_positive" CHECK("runner_artifact_tickets"."bytes" > 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `runner_devices_token_hash_unique` ON `runner_devices` (`token_hash`);

--> statement-breakpoint
CREATE INDEX `runner_devices_owner_account_id_idx` ON `runner_devices` (`owner_account_id`);

--> statement-breakpoint
CREATE INDEX `runner_pairing_codes_owner_account_id_idx` ON `runner_pairing_codes` (`owner_account_id`);

--> statement-breakpoint
CREATE INDEX `runner_pairing_codes_expires_at_idx` ON `runner_pairing_codes` (`expires_at`);

--> statement-breakpoint
CREATE UNIQUE INDEX `generation_dispatches_job_attempt_unique` ON `generation_dispatches` (`owner_account_id`,`job_id`,`attempt`);

--> statement-breakpoint
CREATE INDEX `generation_dispatches_claim_idx` ON `generation_dispatches` (`device_id`,`status`,`created_at`);

--> statement-breakpoint
CREATE INDEX `generation_dispatches_owner_updated_idx` ON `generation_dispatches` (`owner_account_id`,`updated_at`);

--> statement-breakpoint
CREATE UNIQUE INDEX `generation_dispatches_lease_id_unique` ON `generation_dispatches` (`lease_id`) WHERE "generation_dispatches"."lease_id" IS NOT NULL;

--> statement-breakpoint
CREATE UNIQUE INDEX `generation_candidates_owner_prepared_hash_unique` ON `generation_candidates` (`owner_account_id`,`prepared_hash`);

--> statement-breakpoint
CREATE INDEX `generation_candidates_dispatch_idx` ON `generation_candidates` (`dispatch_id`);

--> statement-breakpoint
CREATE INDEX `generation_candidates_owner_status_idx` ON `generation_candidates` (`owner_account_id`,`status`);

--> statement-breakpoint
CREATE INDEX `runner_artifact_tickets_owner_expires_idx` ON `runner_artifact_tickets` (`owner_account_id`,`expires_at`);

--> statement-breakpoint
CREATE INDEX `runner_artifact_tickets_dispatch_idx` ON `runner_artifact_tickets` (`dispatch_id`);

--> statement-breakpoint
CREATE INDEX `runner_artifact_tickets_sha256_idx` ON `runner_artifact_tickets` (`sha256`);
