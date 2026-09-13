// apps/frontend/hub/src/lib/server/api/asset_community_moderation.ts
//
// C-513 — the owner-private and operator halves of the community-asset surface:
// owner-only delivery of pending bytes, the owner delist, and the moderation
// transition that promotes an approved revision into the public catalog
// namespace.
//
// Split from `asset_community.ts` along the trust boundary: the reserve/upload
// path is the member's, this one is the owner's and the moderator's. They share
// only `asset_community_shared.ts`.

import { assetPublishStaging, communityAssets } from '@aikami/backend-database';
import { r2AssetKey } from '@aikami/constants';
import { ModerateCommunityAssetRequestSchema } from '@aikami/schemas';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import {
  type AssetCommunityEnv,
  badRequest,
  forbidden,
  getSessionUserId,
  json,
  mimeForExtension,
  notFound,
  publicDeliveryUrl,
  unauthorized,
} from './asset_community_shared.ts';

/** GET /api/assets/community/:slug/raw — owner-only delivery of pending bytes. */
export const handleCommunityAssetRaw = async (
  request: Request,
  env: AssetCommunityEnv,
  slug: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  const db = drizzle(env.DB, { schema: { communityAssets } });
  const rows = await db
    .select()
    .from(communityAssets)
    .where(eq(communityAssets.slug, slug))
    .orderBy(desc(communityAssets.revision))
    .limit(1);
  const row = rows[0];
  // Another user's pending row must be indistinguishable from a missing one.
  if (!row || row.ownerAccountId !== accountId) {
    return notFound();
  }

  if (row.promotedAt !== null && row.r2Key !== null) {
    return new Response(null, {
      status: 302,
      headers: { location: publicDeliveryUrl(env, row.r2Key) },
    });
  }

  const stagingRows = await db
    .select({ stagingKey: assetPublishStaging.stagingKey })
    .from(assetPublishStaging)
    .where(
      and(
        eq(assetPublishStaging.ownerAccountId, accountId),
        eq(assetPublishStaging.slug, slug),
        eq(assetPublishStaging.revision, row.revision),
        ne(assetPublishStaging.state, 'rolled_back'),
      ),
    )
    .limit(1);
  const stagingKey = stagingRows[0]?.stagingKey;
  if (!stagingKey) {
    return notFound();
  }

  const object = await env.UPLOADS_BUCKET.get(stagingKey);
  if (!object) {
    return notFound();
  }
  const bytes = await object.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': mimeForExtension(row.ext),
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, no-store',
    },
  });
};

// ── Owner delete (delist) ────────────────────────────────────────────────

/**
 * DELETE /api/assets/community/:slug — owner delist.
 *
 * Removes visibility; it is not a universal erasure. A promoted object is
 * removed from the public bucket **only** when no other committed revision
 * (this owner's or another's) still references the same content address — the
 * hash *is* the identity, and a shared object must never be deleted out from
 * under another owner.
 */
export const handleDeleteCommunityAsset = async (
  request: Request,
  env: AssetCommunityEnv,
  slug: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  const db = drizzle(env.DB, { schema: { communityAssets } });

  const owned = await db
    .select()
    .from(communityAssets)
    .where(and(eq(communityAssets.slug, slug), eq(communityAssets.ownerAccountId, accountId)));
  if (owned.length === 0) {
    return notFound();
  }

  const hashes = [...new Set(owned.map((row) => row.sha256))];

  await db
    .delete(communityAssets)
    .where(and(eq(communityAssets.slug, slug), eq(communityAssets.ownerAccountId, accountId)));

  // Reference-aware object cleanup: never delete a blob another revision or
  // another owner still points at.
  for (const hash of hashes) {
    const remaining = await db
      .select({ id: communityAssets.id })
      .from(communityAssets)
      .where(eq(communityAssets.sha256, hash))
      .limit(1);
    if (remaining.length > 0) {
      continue;
    }
    const ext = owned.find((row) => row.sha256 === hash)?.ext;
    if (ext) {
      await env.CATALOG_BUCKET.delete(r2AssetKey({ hash, ext })).catch(() => undefined);
    }
    const orphanStaging = await db
      .select({ stagingKey: assetPublishStaging.stagingKey })
      .from(assetPublishStaging)
      .where(
        and(eq(assetPublishStaging.slug, slug), eq(assetPublishStaging.ownerAccountId, accountId)),
      );
    for (const row of orphanStaging) {
      await env.UPLOADS_BUCKET.delete(row.stagingKey).catch(() => undefined);
    }
  }

  await db
    .delete(assetPublishStaging)
    .where(
      and(
        eq(assetPublishStaging.slug, slug),
        eq(assetPublishStaging.ownerAccountId, accountId),
        eq(assetPublishStaging.state, 'rolled_back'),
      ),
    );

  logger.info('asset:community delisted', { slug, revisions: owned.length });
  return json({ deleted: slug, revisions: owned.length }, 200);
};

// ── Moderation + promotion ───────────────────────────────────────────────

/**
 * POST /api/assets/community/:slug/moderation — operator transition.
 *
 * `approved` copies the private intake object into `CATALOG_BUCKET` at the
 * content-addressed key and records `promotedAt`; the copy is idempotent and
 * promotion happens exactly once. `rejected` leaves the bytes private and
 * records the operator's reason.
 */
export const handleModerateCommunityAsset = async (
  request: Request,
  env: AssetCommunityEnv,
  slug: string,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  const moderators = env.moderationAccountIds ?? [];
  if (!moderators.includes(accountId)) {
    return forbidden('not-moderator');
  }

  const body = rawBody ?? {};
  if (!Value.Check(ModerateCommunityAssetRequestSchema, body)) {
    return badRequest('invalid-argument');
  }
  const { decision } = body as { decision: 'approved' | 'rejected'; note?: string };

  const db = drizzle(env.DB, { schema: { communityAssets } });
  const rows = await db
    .select()
    .from(communityAssets)
    .where(eq(communityAssets.slug, slug))
    .orderBy(desc(communityAssets.revision))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return notFound();
  }

  const now = new Date();

  if (decision === 'rejected') {
    await db
      .update(communityAssets)
      .set({
        moderationState: 'rejected',
        moderationNote: (body as { note?: string }).note ?? null,
        moderatedByAccountId: accountId,
        moderatedAt: now,
        updatedAt: now,
      })
      .where(eq(communityAssets.id, row.id));
    logger.info('asset:community rejected', { slug, revision: row.revision });
    return json({ slug, revision: row.revision, moderationState: 'rejected' }, 200);
  }

  // Already promoted ⇒ idempotent no-op (AC-3, AC-8). Never a second copy.
  if (row.promotedAt !== null && row.r2Key !== null) {
    return json(
      {
        slug,
        revision: row.revision,
        moderationState: 'approved',
        promotedAt: row.promotedAt.toISOString(),
        deliveryUrl: publicDeliveryUrl(env, row.r2Key),
      },
      200,
    );
  }

  const stagingRows = await db
    .select({ stagingKey: assetPublishStaging.stagingKey })
    .from(assetPublishStaging)
    .where(
      and(
        eq(assetPublishStaging.ownerAccountId, row.ownerAccountId),
        eq(assetPublishStaging.slug, row.slug),
        eq(assetPublishStaging.revision, row.revision),
        inArray(assetPublishStaging.state, ['uploaded', 'committed']),
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
      httpMetadata: { contentType: mimeForExtension(row.ext) },
    });
  } catch (error) {
    logger.error('asset:community promotion failed', { slug, error });
    return json({ error: 'upload-failed' }, 502);
  }

  // CAS: promote exactly once. A concurrent moderator that won the race makes
  // this a no-op and the row is re-read below.
  const promoted = await db
    .update(communityAssets)
    .set({
      r2Key,
      moderationState: 'approved',
      moderatedByAccountId: accountId,
      moderatedAt: now,
      promotedAt: now,
      updatedAt: now,
    })
    .where(and(eq(communityAssets.id, row.id), sql`${communityAssets.promotedAt} IS NULL`))
    .returning({ promotedAt: communityAssets.promotedAt });

  const promotedAt = promoted[0]?.promotedAt ?? now;

  logger.info('asset:community promoted', {
    slug,
    revision: row.revision,
    category: row.category,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    moderationState: 'approved',
  });

  return json(
    {
      slug,
      revision: row.revision,
      moderationState: 'approved',
      promotedAt: promotedAt.toISOString(),
      deliveryUrl: publicDeliveryUrl(env, r2Key),
    },
    200,
  );
};
