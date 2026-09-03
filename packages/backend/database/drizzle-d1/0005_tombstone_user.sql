-- C-464: Insert the tombstone owner account for pack ownership transfer on deletion.
-- The tombstone user must exist before any account is deleted, or the FK on
-- packs.ownerAccountId (onDelete: 'restrict') blocks the deletion.
--
-- The tombstone user has no email, no credential row, and cannot sign in.
-- Published packs are transferred to this owner rather than destroyed, so
-- other players who installed a pack are not punished by one user's erasure.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
VALUES ('deleted-user', 'Deleted user', '', 0, 1728000000000, 1728000000000);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
