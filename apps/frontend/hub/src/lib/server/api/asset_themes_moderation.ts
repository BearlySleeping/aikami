// apps/frontend/hub/src/lib/server/api/asset_themes_moderation.ts
//
// C-530 AC-3 / AC-9 — the operator half of the theme surface: the moderation
// transition that promotes an approved version into the public catalog
// namespace, and the revocation marker that withdraws public distribution of an
// already-approved version.
//
// Split from `asset_themes.ts` along the trust boundary: the reserve/upload path
// is the member's, this one is the moderator's. They share only
// `asset_themes_shared.ts` (plus the C-513 helpers).
//
// 🔴 Revocation is deliberately *not* a moderation state. The three-state union
// is declared twice and both declarations are closed, and SQLite cannot alter a
// CHECK constraint in place — so a withdrawn version keeps `approved` and gains
// `revoked_at`. Public delivery and listing both refuse it, the audit trail
// survives, and an already-installed pack keeps working offline.

import { themePublishStaging, themeVersions } from '@aikami/backend-database';
import { r2AssetKey } from '@aikami/constants';
import {
  type ModerateThemeVersionRequest,
  ModerateThemeVersionRequestSchema,
  type RevokeThemeVersionRequest,
  RevokeThemeVersionRequestSchema,
} from '@aikami/schemas';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import {
  badRequest,
  forbidden,
  getSessionUserId,
  json,
  notFound,
  unauthorized,
} from './asset_community_shared.ts';
import type { AssetThemeEnv } from './asset_themes_env.ts';
import { toThemeSummary } from './asset_themes_shared.ts';

const isModerator = (env: AssetThemeEnv, accountId: string): boolean =>
  (env.moderationAccountIds ?? []).includes(accountId);

/** Reads one requested version, or the newest version when none was requested. */
const readNewestVersion = async (options: {
  readonly env: AssetThemeEnv;
  readonly themeId: string;
  readonly version?: string;
}): Promise<typeof themeVersions.$inferSelect | undefined> => {
  const db = drizzle(options.env.DB, { schema: { themeVersions } });
  const filter =
    options.version === undefined
      ? eq(themeVersions.slug, options.themeId)
      : and(eq(themeVersions.slug, options.themeId), eq(themeVersions.version, options.version));
  const rows = await db
    .select()
    .from(themeVersions)
    .where(filter)
    .orderBy(desc(themeVersions.createdAt), desc(themeVersions.id))
    .limit(1);
  return rows[0];
};

/**
 * POST /api/assets/themes/:slug/moderation — operator transition.
 *
 * `approved` copies the private intake object into `CATALOG_BUCKET` at the
 * content-addressed key and records `promotedAt`; the copy is idempotent and
 * promotion happens exactly once. `rejected` leaves the bytes private and
 * records the operator's reason.
 */
export const handleModerateThemeVersion = async (
  request: Request,
  env: AssetThemeEnv,
  themeId: string,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  if (!isModerator(env, accountId)) {
    return forbidden('not-moderator');
  }

  const body = rawBody ?? {};
  if (!Value.Check(ModerateThemeVersionRequestSchema, body)) {
    return badRequest('invalid-argument');
  }
  const { decision, note, version } = body as ModerateThemeVersionRequest;

  const row = await readNewestVersion({ env, themeId, version });
  if (!row) {
    return notFound();
  }
  const db = drizzle(env.DB, { schema: { themeVersions } });
  const now = new Date();

  if (decision === 'rejected') {
    if (row.promotedAt !== null || row.r2Key !== null) {
      return json({ error: 'already-promoted' }, 409);
    }
    await db
      .update(themeVersions)
      .set({
        moderationState: 'rejected',
        moderationNote: note ?? null,
        moderatedByAccountId: accountId,
        moderatedAt: now,
        updatedAt: now,
      })
      .where(eq(themeVersions.id, row.id));
    logger.info('asset:theme rejected', { themeId, version: row.version });
    return json({ themeId, version: row.version, moderationState: 'rejected' }, 200);
  }

  // Already promoted ⇒ idempotent no-op. Never a second copy.
  if (row.promotedAt !== null && row.r2Key !== null) {
    return json(
      {
        themeId,
        version: row.version,
        moderationState: 'approved',
        promotedAt: row.promotedAt.toISOString(),
        revoked: row.revokedAt !== null,
      },
      200,
    );
  }

  const stagingRows = await db
    .select({ stagingKey: themePublishStaging.stagingKey })
    .from(themePublishStaging)
    .where(
      and(
        eq(themePublishStaging.ownerAccountId, row.ownerAccountId),
        eq(themePublishStaging.slug, row.slug),
        eq(themePublishStaging.version, row.version),
        inArray(themePublishStaging.state, ['uploaded', 'committed']),
      ),
    )
    .limit(1);
  const stagingKey = stagingRows[0]?.stagingKey;
  if (!stagingKey) {
    return json({ error: 'commit-failed', detail: 'staging object not found' }, 409);
  }

  const object = await env.UPLOADS_BUCKET.get(stagingKey);
  if (!object) {
    return json({ error: 'commit-failed', detail: 'staging bytes missing' }, 409);
  }

  const r2Key = r2AssetKey({ hash: row.sha256, ext: row.ext });
  const bytes = await object.arrayBuffer();
  try {
    await env.CATALOG_BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: 'application/zip' },
    });
  } catch (error) {
    logger.error('asset:theme promotion failed', { themeId, error });
    return json({ error: 'upload-failed' }, 502);
  }

  // CAS: promote exactly once. A concurrent moderator that won the race makes
  // this a no-op and the row is re-read below.
  await db
    .update(themeVersions)
    .set({
      r2Key,
      moderationState: 'approved',
      moderatedByAccountId: accountId,
      moderatedAt: now,
      promotedAt: now,
      updatedAt: now,
    })
    .where(and(eq(themeVersions.id, row.id), sql`${themeVersions.promotedAt} IS NULL`));

  const committedRows = await db
    .select({
      id: themeVersions.id,
      moderationState: themeVersions.moderationState,
      promotedAt: themeVersions.promotedAt,
      r2Key: themeVersions.r2Key,
    })
    .from(themeVersions)
    .where(eq(themeVersions.id, row.id))
    .limit(1);
  const committed = committedRows[0];
  if (
    committed?.moderationState !== 'approved' ||
    committed.promotedAt === null ||
    committed.r2Key === null
  ) {
    const references = await db
      .select({ id: themeVersions.id })
      .from(themeVersions)
      .where(eq(themeVersions.r2Key, r2Key))
      .limit(1);
    if (references.length === 0) {
      await env.CATALOG_BUCKET.delete(r2Key).catch(() => undefined);
    }
    return committed ? json({ error: 'promotion-conflict' }, 409) : notFound();
  }

  logger.info('asset:theme promoted', {
    themeId,
    version: row.version,
    packageBytes: row.packageBytes,
    sha256: row.sha256,
    moderationState: 'approved',
  });

  return json(
    {
      themeId,
      version: row.version,
      moderationState: 'approved',
      promotedAt: committed.promotedAt.toISOString(),
    },
    200,
  );
};

/**
 * POST /api/assets/themes/:slug/revocation — withdraw (or restore) public
 * distribution of an approved version.
 *
 * Restoring clears `revoked_at` but never re-copies bytes: the promoted object
 * is content-addressed and was never deleted, so an un-revoke is a metadata
 * transition only.
 */
export const handleRevokeThemeVersion = async (
  request: Request,
  env: AssetThemeEnv,
  themeId: string,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  if (!isModerator(env, accountId)) {
    return forbidden('not-moderator');
  }

  const body = rawBody ?? {};
  if (!Value.Check(RevokeThemeVersionRequestSchema, body)) {
    return badRequest('invalid-argument');
  }
  const { revoked, note, version } = body as RevokeThemeVersionRequest;

  const row = await readNewestVersion({ env, themeId, version });
  if (!row) {
    return notFound();
  }
  if (row.moderationState !== 'approved') {
    // Only an approved version has public distribution to withdraw.
    return json(
      { error: 'already-moderated', detail: 'Only an approved version can be revoked.' },
      409,
    );
  }

  const db = drizzle(env.DB, { schema: { themeVersions } });
  const now = new Date();
  await db
    .update(themeVersions)
    .set({
      revokedAt: revoked ? now : null,
      moderationNote: note ?? row.moderationNote,
      moderatedByAccountId: accountId,
      moderatedAt: now,
      updatedAt: now,
    })
    .where(eq(themeVersions.id, row.id));

  logger.info('asset:theme revocation changed', { themeId, version: row.version, revoked });

  const updated = await readNewestVersion({ env, themeId, version: row.version });
  return json(
    updated === undefined
      ? { themeId, version: row.version, revoked }
      : toThemeSummary({ row: updated, isOwner: false, env }),
    200,
  );
};
