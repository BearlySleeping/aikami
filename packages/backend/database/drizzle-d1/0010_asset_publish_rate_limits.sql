-- C-513: persistent, cross-isolate community-publish quota reservations.

CREATE TABLE `asset_publish_rate_limits` (
	`owner_account_id` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`hits` integer NOT NULL,
	PRIMARY KEY(`owner_account_id`, `window_started_at`),
	FOREIGN KEY (`owner_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
