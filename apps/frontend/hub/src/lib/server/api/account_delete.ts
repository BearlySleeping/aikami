// apps/frontend/hub/src/lib/server/api/account_delete.ts
//
// C-464 AC-3/4/5/6: Session-verified, idempotent account deletion.
//
// Erasure order: R2 first, D1 last. The account_backups rows are the only
// record of which R2 keys belong to a user — destroying the index before the
// blobs would orphan them permanently.
//
// The user id is derived from the session, never from the request body
// (AC-6). Deletion is idempotent (AC-5): deleting an already-deleted account
// succeeds. A crash part-way leaves a state the next call completes.
//
// Published packs are transferred to the tombstone owner rather than removed
// (AC-4), so other players who installed a pack are not punished.

import { accountBackups, packs, packVersions, users } from '@aikami/backend-database';
import { DELETED_OWNER_ACCOUNT_ID } from '@aikami/constants';
import type { AccountDeletionResult } from '@aikami/types';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { logger } from '$logger';

export type AccountDeleteEnv = {
	// biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
	DB: import('@cloudflare/workers-types').D1Database;
	// biome-ignore lint/style/useNamingConvention: Cloudflare R2 binding name
	SAVES_BUCKET: import('@cloudflare/workers-types').R2Bucket;
};

const unauthorized = (): Response =>
	new Response(JSON.stringify({ error: 'unauthorized' }), {
		status: 401,
		headers: { 'content-type': 'application/json' },
	});

/**
 * R2 object key prefix for a given user's saves.
 * Catches both server-written backups (account_backups.r2Key) and
 * client-written sync blobs (saves/{uid}/slot_{n}.json).
 */
const savesPrefixFor = (accountId: string): string => `saves/${accountId}/`;

/**
 * DELETE /api/account
 *
 * Session-verified. Deletes all R2 objects under `saves/{uid}/`, transfers
 * published packs to the tombstone owner, removes backup metadata rows, then
 * deletes the user row (which cascades to sessions, accounts, deviceCodes).
 *
 * Idempotent: deleting an already-deleted or non-existent account succeeds
 * with zero counts.
 */
export const handleDeleteAccount = async (
	accountId: string | undefined,
	env: AccountDeleteEnv,
): Promise<Response> => {
	if (!accountId) {
		return unauthorized();
	}

	const db = drizzle(env.DB, { schema: { accountBackups, packs, packVersions, users } });

	// ── Phase 1: Delete R2 blobs ──────────────────────────────────────────
	// List all objects under saves/{uid}/ and delete them. R2 list is
	// paginated — loop until the cursor is exhausted.
	let blobsDeleted = 0;
	let cursor: string | undefined;
	do {
		const listResult = await env.SAVES_BUCKET.list({
			prefix: savesPrefixFor(accountId),
			cursor,
			limit: 1000,
		});
		if (listResult.objects.length > 0) {
			const keys = listResult.objects.map((o) => o.key);
			await env.SAVES_BUCKET.delete(keys);
			blobsDeleted += keys.length;
		}
		cursor = listResult.truncated ? listResult.cursor : undefined;
	} while (cursor);

	// ── Phase 2: Transfer packs to tombstone owner ─────────────────────────
	// The packs FK is onDelete: 'restrict' — we must transfer before deleting
	// the user row, or the FK blocks the deletion.
	const packsToTransfer = await db
		.select({ id: packs.id })
		.from(packs)
		.where(and(eq(packs.ownerAccountId, accountId), eq(packs.visibility, 'public')));

	const packsToDelete = await db
		.select({ id: packs.id })
		.from(packs)
		.where(and(eq(packs.ownerAccountId, accountId), ne(packs.visibility, 'public')));

	if (packsToDelete.length > 0) {
		const packIds = packsToDelete.map((pack) => pack.id);
		await db.delete(packVersions).where(inArray(packVersions.packId, packIds));
		await db.delete(packs).where(inArray(packs.id, packIds));
	}

	const packsTransferred = packsToTransfer.length;
	if (packsTransferred > 0) {
		const packIds = packsToTransfer.map((p) => p.id);
		await db
			.update(packs)
			.set({ ownerAccountId: DELETED_OWNER_ACCOUNT_ID })
			.where(inArray(packs.id, packIds));
	}

	// ── Phase 3: Delete backup metadata rows ───────────────────────────────
	const backupsToDelete = await db
		.select({ id: accountBackups.id })
		.from(accountBackups)
		.where(eq(accountBackups.accountId, accountId));

	const backupsDeleted = backupsToDelete.length;
	if (backupsDeleted > 0) {
		const backupIds = backupsToDelete.map((b) => b.id);
		await db.delete(accountBackups).where(inArray(accountBackups.id, backupIds));
	}

	// ── Phase 4: Delete the user row ───────────────────────────────────────
	// This cascades to sessions, accounts, and deviceCodes.
	await db.delete(users).where(eq(users.id, accountId));

	const result: AccountDeletionResult = {
		blobsDeleted,
		backupsDeleted,
		packsTransferred,
	};

	// Structured log with counts only — no PII.
	logger.info(
		JSON.stringify({
			event: 'account:deleted',
			blobsDeleted,
			backupsDeleted,
			packsTransferred,
		}),
	);

	return new Response(JSON.stringify(result), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
};

/**
 * DELETE /api/account — Elysia route handler.
 * Derives the user id from the session, never from the request body (AC-6).
 */
export const handleAccountDeleteRequest = async (
	request: Request,
	env: AccountDeleteEnv,
): Promise<Response> => {
	const { getBetterAuth } = await import('./better_auth.ts');
	const auth = getBetterAuth();
	if (!auth) {
		return new Response(JSON.stringify({ error: 'auth_unconfigured' }), {
			status: 503,
			headers: { 'content-type': 'application/json' },
		});
	}

	const session = await auth.api.getSession({ headers: request.headers });
	const accountId = session?.user.id;
	return handleDeleteAccount(accountId, env);
};
