PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deviceCode` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_deviceCode`("id", "device_code", "user_code", "user_id", "expires_at", "status", "last_polled_at", "polling_interval", "client_id", "scope", "created_at", "updated_at") SELECT "id", "device_code", "user_code", "user_id", "expires_at", "status", "last_polled_at", "polling_interval", "client_id", "scope", "created_at", "updated_at" FROM `deviceCode`;--> statement-breakpoint
DROP TABLE `deviceCode`;--> statement-breakpoint
ALTER TABLE `__new_deviceCode` RENAME TO `deviceCode`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_device_code_unique` ON `deviceCode` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_user_code_unique` ON `deviceCode` (`user_code`);--> statement-breakpoint
CREATE INDEX `device_code_user_id_idx` ON `deviceCode` (`user_id`);