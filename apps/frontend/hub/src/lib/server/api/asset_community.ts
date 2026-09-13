// apps/frontend/hub/src/lib/server/api/asset_community.ts
//
// C-513 — Community asset publishing.
//
// Reserve → upload to a *private* intake bucket → commit a pending row →
// promote into the shared content-addressed `assets/` namespace at moderation
// time.
//
// The publish pattern mirrors C-508's `map_studio.ts` (validate → session gate
// → reserve the immutable key in D1 → R2 write → rollback on failure), with
// one deliberate divergence: **bytes are not public on upload.** Map documents
// are public the moment they are published; asset bytes must stay private
// until a moderator approves them, because the catalog bucket publishes every
// key it holds. So the intake hop lands the object in `UPLOADS_BUCKET`
// (`aikami-uploads`, no public domain) and only an approval copies it into
// `CATALOG_BUCKET`.
//
// 🔴 Documented I-7 deviation (see the contract's Architecture Directives):
// asset bytes pass through a hub request handler for intake and promotion.
// C-426's `/storage/upload` already does this for player-owned objects, and a
// presigned-PUT design would require long-lived R2 API secrets in the Worker.
// Bytes never touch D1/Postgres, and reads never proxy bytes.

import { assetPublishStaging, communityAssets } from '@aikami/backend-database';
import { MAX_UPLOAD_SIZE } from '@aikami/constants';
import {
  COMMUNITY_ASSET_TITLE_MAX_LENGTH,
  type CommunityAssetProvenanceProjection,
  type CommunityAssetSummary,
  evaluateCommunityPublishGate,
  ReserveAssetRequestSchema,
  stagingObjectKey,
} from '@aikami/schemas';
import { stripImageMetadata } from '@aikami/utils';
import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import {
  type AssetCommunityEnv,
  badRequest,
  extensionAllowedForCategory,
  getSessionUserId,
  json,
  mimeForExtension,
  notFound,
  ownerDeliveryPath,
  parseProvenance,
  publicDeliveryUrl,
  rateLimited,
  sha256Hex,
  unauthorized,
  unprocessable,
  withinPublishRateLimit,
} from './asset_community_shared.ts';

// `AssetCommunityEnv` is re-exported: the route wiring and the env resolver
// import it from this module.
export type { AssetCommunityEnv } from './asset_community_shared.ts';

/** `My Great Asset!` → `my-great-asset`. Always non-empty. */
export const slugify = (value: string): string => {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'asset';
};

const slugSuffix = (): string => crypto.randomUUID().slice(0, 6);

// ── Reservation (step 1) ─────────────────────────────────────────────────

/**
 * POST /api/assets/community — reserve a community-asset publish.
 *
 * Validates metadata, category/ext/size and the scoped rights gate *before*
 * anything is written, then reserves `(slug, revision)` in
 * `asset_publish_staging` with `state: 'reserved'`.
 */
export const handleReserveCommunityAsset = async (
  request: Request,
  env: AssetCommunityEnv,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  if (!withinPublishRateLimit(accountId)) {
    logger.info('asset:community reserve rate-limited', { accountId });
    return rateLimited();
  }

  const body = rawBody ?? {};
  if (!Value.Check(ReserveAssetRequestSchema, body)) {
    return badRequest('invalid-argument');
  }
  const input = body as {
    category: string;
    tag: string;
    title: string;
    slug?: string;
    ext: string;
    sizeBytes: number;
    provenance: CommunityAssetProvenanceProjection;
    rights?: Parameters<typeof evaluateCommunityPublishGate>[0]['rights'];
  };

  const title = input.title.trim();
  if (title.length === 0 || title.length > COMMUNITY_ASSET_TITLE_MAX_LENGTH) {
    return badRequest('invalid-argument');
  }
  if (!extensionAllowedForCategory(input.category, input.ext)) {
    return unprocessable('invalid-argument', { detail: 'extension not allowed for category' });
  }
  if (input.sizeBytes > MAX_UPLOAD_SIZE) {
    return json({ error: 'asset_too_large', maxBytes: MAX_UPLOAD_SIZE }, 413);
  }

  // The licence/provenance gate runs at *reserve*: a refused publish must
  // never upload a byte.
  const gate = evaluateCommunityPublishGate({
    provenance: input.provenance,
    rights: input.rights,
  });
  if (!gate.ok) {
    logger.info('asset:community reserve refused by rights gate', {
      code: gate.code,
      missing: gate.missing,
      category: input.category,
    });
    return json({ error: gate.code, missing: gate.missing, message: gate.message }, 422);
  }

  const db = drizzle(env.DB, { schema: { assetPublishStaging, communityAssets } });

  let hasExplicitSlug = false;
  let requestedSlug = slugify(title);
  if (input.slug !== undefined) {
    hasExplicitSlug = true;
    requestedSlug = input.slug;
  }

  let slug = requestedSlug;
  let reservation: { id: string; revision: number; stagingKey: string } | undefined;

  for (let attempt = 0; attempt < 8; attempt++) {
    const requestedLatest = await db
      .select({
        revision: communityAssets.revision,
        ownerAccountId: communityAssets.ownerAccountId,
      })
      .from(communityAssets)
      .where(eq(communityAssets.slug, slug))
      .orderBy(desc(communityAssets.revision))
      .limit(1);

    const latest = requestedLatest[0];
    if (latest && latest.ownerAccountId !== accountId) {
      if (hasExplicitSlug) {
        return json({ error: 'slug-taken' }, 409);
      }
      slug = `${requestedSlug.slice(0, 50)}-${slugSuffix()}`;
      continue;
    }

    const revision = (latest?.revision ?? 0) + 1;
    const id = crypto.randomUUID();
    const stagingKey = stagingObjectKey.build({ accountId, uploadId: id });
    const now = new Date();

    // Abandon stale reservations for this (owner, slug) so a retry after a
    // failed upload is not blocked by its own aborted attempt.
    await db
      .update(assetPublishStaging)
      .set({ state: 'rolled_back', updatedAt: now })
      .where(
        and(
          eq(assetPublishStaging.ownerAccountId, accountId),
          eq(assetPublishStaging.slug, slug),
          eq(assetPublishStaging.state, 'reserved'),
        ),
      );

    try {
      await db.insert(assetPublishStaging).values({
        id,
        ownerAccountId: accountId,
        slug,
        revision,
        title,
        category: input.category,
        tag: input.tag,
        ext: input.ext,
        sizeBytes: input.sizeBytes,
        stagingKey,
        state: 'reserved',
        provenanceJson: JSON.stringify(input.provenance),
        createdAt: now,
        updatedAt: now,
      });
      reservation = { id, revision, stagingKey };
      break;
    } catch (error) {
      const cause =
        error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
      const message = `${String(error)} ${String(cause)}`;
      if (/UNIQUE constraint failed: asset_publish_staging/i.test(message)) {
        continue;
      }
      throw error;
    }
  }

  if (!reservation) {
    return json({ error: 'revision-conflict' }, 409);
  }

  logger.info('asset:community reserved', {
    slug,
    revision: reservation.revision,
    category: input.category,
    sizeBytes: input.sizeBytes,
  });

  return json(
    {
      slug,
      revision: reservation.revision,
      uploadPath: `/api/assets/community/${slug}/upload`,
      stagingState: 'reserved',
    },
    201,
  );
};

// ── Upload / commit (step 2) ─────────────────────────────────────────────

/**
 * PUT /api/assets/community/:slug/upload — the owner's raw bytes.
 *
 * `Content-Length` is checked against `MAX_UPLOAD_SIZE` **before** the body is
 * buffered (the `storage.ts:85-93` shape), the hub computes the sha256 itself
 * and never trusts a client claim, and the object lands in the private intake
 * bucket. A failed hop rolls the reservation back.
 */
export const handleUploadCommunityAsset = async (
  request: Request,
  env: AssetCommunityEnv,
  slug: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  if (!withinPublishRateLimit(accountId)) {
    logger.info('asset:community upload rate-limited', { accountId, slug });
    return rateLimited();
  }

  const db = drizzle(env.DB, { schema: { assetPublishStaging, communityAssets } });
  const stagingRows = await db
    .select()
    .from(assetPublishStaging)
    .where(
      and(
        eq(assetPublishStaging.ownerAccountId, accountId),
        eq(assetPublishStaging.slug, slug),
        inArray(assetPublishStaging.state, ['reserved', 'uploaded', 'orphaned']),
      ),
    )
    .orderBy(desc(assetPublishStaging.createdAt))
    .limit(1);
  const staging = stagingRows[0];
  if (!staging) {
    return notFound();
  }

  const rollback = async (): Promise<void> => {
    await db
      .update(assetPublishStaging)
      .set({ state: 'rolled_back', updatedAt: new Date() })
      .where(
        and(
          eq(assetPublishStaging.id, staging.id),
          inArray(assetPublishStaging.state, ['reserved', 'uploaded', 'orphaned']),
        ),
      );
  };

  // 🔴 Size gate BEFORE buffering. A mismatched declared size fails closed,
  // and asking for the body first would let a capped asset buffer ~50 MiB.
  const declaredLength = Number(request.headers.get('content-length'));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
    return badRequest('invalid-argument');
  }
  if (declaredLength > MAX_UPLOAD_SIZE) {
    return json({ error: 'asset_too_large', maxBytes: MAX_UPLOAD_SIZE }, 413);
  }
  if (declaredLength !== staging.sizeBytes) {
    await rollback();
    return unprocessable('size-mismatch', { declaredSizeBytes: staging.sizeBytes });
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_UPLOAD_SIZE) {
    await rollback();
    return json({ error: 'asset_too_large', maxBytes: MAX_UPLOAD_SIZE }, 413);
  }
  if (raw.byteLength !== staging.sizeBytes) {
    await rollback();
    return unprocessable('size-mismatch', { declaredSizeBytes: staging.sizeBytes });
  }

  // 🔴 Security/privacy, defensively: strip container metadata BEFORE the hash
  // is computed, so the hub hashes exactly the bytes it stores
  // (`staging.sha256` and the promoted object's content address must agree).
  //
  // The client publish transport already stripped, so an honest upload is
  // unchanged here. A caller that skipped it shrinks at this point — which
  // would desync the size it reserved from the bytes on the wire — and is
  // refused rather than silently stored at a different length.
  const stripped = stripImageMetadata(new Uint8Array(raw));
  if (stripped.bytes.byteLength !== staging.sizeBytes) {
    logger.info('asset:community upload carried unstripped metadata', {
      slug,
      declaredSizeBytes: staging.sizeBytes,
      strippedSizeBytes: stripped.bytes.byteLength,
      format: stripped.format,
    });
    await rollback();
    return unprocessable('size-mismatch', {
      declaredSizeBytes: staging.sizeBytes,
      detail: 'embedded metadata present',
    });
  }
  const bytes = stripped.bytes;

  const sha256 = await sha256Hex(bytes);

  try {
    await env.UPLOADS_BUCKET.put(staging.stagingKey, bytes, {
      httpMetadata: { contentType: mimeForExtension(staging.ext) },
    });
  } catch (error) {
    logger.error('asset:community upload failed', { slug, error });
    await rollback();
    return json({ error: 'upload-failed' }, 502);
  }

  // reserved → uploaded (CAS). A resumed retry is already past this transition.
  await db
    .update(assetPublishStaging)
    .set({ state: 'uploaded', sha256, updatedAt: new Date() })
    .where(
      and(
        eq(assetPublishStaging.id, staging.id),
        inArray(assetPublishStaging.state, ['reserved', 'uploaded', 'orphaned']),
      ),
    );

  // Commit the immutable revision. The staging row stays `uploaded` if this
  // fails — a recoverable state, never a visible public row.
  const now = new Date();
  try {
    await db.insert(communityAssets).values({
      id: crypto.randomUUID(),
      ownerAccountId: accountId,
      slug: staging.slug,
      revision: staging.revision,
      title: staging.title,
      category: staging.category,
      tag: staging.tag,
      sha256,
      r2Key: null,
      sizeBytes: staging.sizeBytes,
      ext: staging.ext,
      provenanceJson: staging.provenanceJson,
      license: parseProvenance(staging.provenanceJson).license ?? null,
      moderationState: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
    const message = `${String(error)} ${String(cause)}`;
    logger.error('asset:community commit failed; staging row is recoverable', {
      slug,
      revision: staging.revision,
      error,
    });
    if (/UNIQUE constraint failed: community_assets/i.test(message)) {
      return json({ error: 'revision-conflict' }, 409);
    }
    return json({ error: 'commit-failed' }, 502);
  }

  await db
    .update(assetPublishStaging)
    .set({ state: 'committed', updatedAt: new Date() })
    .where(eq(assetPublishStaging.id, staging.id));

  logger.info('asset:community published', {
    slug: staging.slug,
    revision: staging.revision,
    category: staging.category,
    sizeBytes: staging.sizeBytes,
    sha256,
    moderationState: 'pending',
  });

  return json(
    {
      slug: staging.slug,
      revision: staging.revision,
      sha256,
      moderationState: 'pending',
      deliveryUrl: ownerDeliveryPath(staging.slug),
    },
    201,
  );
};

// ── Listing ──────────────────────────────────────────────────────────────

const toSummary = (options: {
  row: typeof communityAssets.$inferSelect;
  isOwner: boolean;
  env: AssetCommunityEnv;
}): CommunityAssetSummary => {
  const { row, isOwner, env } = options;
  const promoted = row.promotedAt !== null && row.r2Key !== null;
  let deliveryUrl: string | undefined;
  if (promoted) {
    deliveryUrl = publicDeliveryUrl(env, row.r2Key as string);
  } else if (isOwner) {
    deliveryUrl = ownerDeliveryPath(row.slug);
  }
  return {
    slug: row.slug,
    revision: row.revision,
    title: row.title,
    category: row.category as CommunityAssetSummary['category'],
    tag: row.tag,
    sha256: row.sha256,
    ext: row.ext,
    sizeBytes: row.sizeBytes,
    provenance: parseProvenance(row.provenanceJson),
    ...(row.license === null ? {} : { license: row.license }),
    moderationState: row.moderationState,
    isOwner,
    promoted,
    ...(deliveryUrl === undefined ? {} : { deliveryUrl }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

/** A parsed community-listing cursor — the opaque `"<updatedAtMs>.<id>"` token. */
export type CommunityAssetCursor = { updatedAt: Date; id: string };

/**
 * Parses an opaque pagination cursor.
 *
 * @returns The cursor, or undefined when the token is malformed.
 */
export const parseCommunityAssetCursor = (raw: string): CommunityAssetCursor | undefined => {
  const separator = raw.indexOf('.');
  if (separator < 1) {
    return undefined;
  }
  const timestamp = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || id.length === 0) {
    return undefined;
  }
  return { updatedAt: new Date(timestamp), id };
};

/** One page of the community listing. */
export type CommunityAssetListing = {
  items: readonly CommunityAssetSummary[];
  nextCursor?: string;
};

/**
 * Reads one page of community assets, newest first.
 *
 * The single query behind both the JSON route and the public browse page
 * (C-513 AC-4), so the two surfaces cannot diverge on visibility.
 * `mine: false` — the public default — returns **approved, promoted** rows
 * only: a pending or rejected revision is not listable through either surface.
 * `mine: true` scopes to one owner across every moderation state and is
 * session-gated by the route that calls it.
 *
 * Newest revision per slug *within the visible set*, so a pending re-publish
 * never hides the previously approved revision.
 */
export const listCommunityAssets = async (options: {
  env: AssetCommunityEnv;
  category?: string;
  accountId?: string;
  mine?: boolean;
  limit?: number;
  cursor?: CommunityAssetCursor;
}): Promise<CommunityAssetListing> => {
  const { env, category, accountId, mine = false, limit = 50, cursor } = options;
  const db = drizzle(env.DB, { schema: { communityAssets } });

  const visibleState = mine
    ? sql`${communityAssets.ownerAccountId} = ${accountId}`
    : sql`${communityAssets.moderationState} = 'approved' AND ${communityAssets.promotedAt} IS NOT NULL`;

  const newestVisibleRevision = sql`${communityAssets.revision} = (
    SELECT MAX(latest.revision)
    FROM community_assets AS latest
    WHERE latest.slug = ${communityAssets.slug}
      AND ${
        mine
          ? sql`latest.owner_account_id = ${accountId}`
          : sql`latest.moderation_state = 'approved' AND latest.promoted_at IS NOT NULL`
      }
  )`;

  const filters = [visibleState, newestVisibleRevision];
  if (category !== undefined) {
    filters.push(sql`${communityAssets.category} = ${category}`);
  }
  if (cursor) {
    filters.push(
      or(
        lt(communityAssets.updatedAt, cursor.updatedAt),
        and(eq(communityAssets.updatedAt, cursor.updatedAt), lt(communityAssets.id, cursor.id)),
      ) as never,
    );
  }

  const rows = await db
    .select()
    .from(communityAssets)
    .where(and(...filters))
    .orderBy(desc(communityAssets.updatedAt), desc(communityAssets.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) =>
      toSummary({ row, isOwner: mine && row.ownerAccountId === accountId, env }),
    ),
    ...(rows.length > limit && last
      ? { nextCursor: `${last.updatedAt.getTime()}.${last.id}` }
      : {}),
  };
};

/**
 * GET /api/assets/community — community listing.
 *
 * Public: approved + promoted rows only, never another user's pending rows.
 * `?mine=1` returns the caller's own submissions in every moderation state and
 * requires a session.
 */
export const handleListCommunityAssets = async (
  request: Request,
  env: AssetCommunityEnv,
): Promise<Response> => {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return badRequest('invalid-page-size');
  }

  const mine = url.searchParams.get('mine') === '1';
  const category = url.searchParams.get('category');

  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor === null ? undefined : parseCommunityAssetCursor(rawCursor);
  if (rawCursor !== null && cursor === undefined) {
    return badRequest('invalid-cursor');
  }

  let accountId: string | undefined;
  if (mine) {
    accountId = await getSessionUserId(request);
    if (!accountId) {
      return unauthorized();
    }
  }

  const listing = await listCommunityAssets({
    env,
    ...(category === null ? {} : { category }),
    ...(accountId === undefined ? {} : { accountId }),
    mine,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  });

  return json(listing, 200);
};

/** GET /api/assets/community/counters — community-surface counters. */
export const handleCommunityAssetCounters = async (
  _request: Request,
  env: AssetCommunityEnv,
): Promise<Response> => {
  const db = drizzle(env.DB, { schema: { communityAssets } });
  const rows = await db
    .select({ category: communityAssets.category, count: sql<number>`count(*)` })
    .from(communityAssets)
    .where(
      and(eq(communityAssets.moderationState, 'approved'), isNotNull(communityAssets.promotedAt)),
    )
    .groupBy(communityAssets.category);

  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const count = Number(row.count);
    byCategory[row.category] = count;
    total += count;
  }
  return json({ total, byCategory }, 200);
};

/** GET /api/assets/community/:slug — one asset's metadata. */
export const handleGetCommunityAsset = async (
  request: Request,
  env: AssetCommunityEnv,
  slug: string,
): Promise<Response> => {
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
  const accountId = await getSessionUserId(request);
  const isOwner = accountId !== undefined && row.ownerAccountId === accountId;
  const isPublic = row.moderationState === 'approved' && row.promotedAt !== null;
  if (!isPublic && !isOwner) {
    return notFound();
  }
  return json(toSummary({ row, isOwner, env }), 200);
};
