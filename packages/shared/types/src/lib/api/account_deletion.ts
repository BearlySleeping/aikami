// packages/shared/types/src/lib/api/account_deletion.ts
//
// C-464: Response shapes for the account deletion endpoint.

/**
 * Response shape of DELETE /api/account.
 * Reports the counts of objects removed and packs transferred.
 */
export type AccountDeletionResult = {
	/** Objects removed from SAVES_BUCKET. */
	readonly blobsDeleted: number;
	/** Backup metadata rows removed. */
	readonly backupsDeleted: number;
	/** Packs transferred to the tombstone owner. */
	readonly packsTransferred: number;
};
