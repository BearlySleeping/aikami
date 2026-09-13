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
import {
  ASSET_CATEGORIES,
  AUDIO_MIME_MAP,
  IMAGE_MIME_MAP,
  MAX_UPLOAD_SIZE,
  r2AssetKey,
} from '@aikami/constants';
import {
  COMMUNITY_ASSET_TITLE_MAX_LENGTH,
  type CommunityAssetProvenanceProjection,
  type CommunityAssetSummary,
  evaluateCommunityPublishGate,
  ModerateCommunityAssetRequestSchema,
  ReserveAssetRequestSchema,
  stagingObjectKey,
} from '@aikami/schemas';
import { and, desc, eq, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import { getBetterAuth } from './better_auth.ts';

type D1Database = import('@cloudflare/workers-types').D1Database;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

/** Bindings + injected configuration the community-asset routes need. */
export type AssetCommunityEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  DB: D1Database;
  // biome-ignore lint/style/useNamingConvention: Cloudflare R2 binding name
  CATALOG_BUCKET: R2Bucket;
  // biome-ignore lint/style/useNamingConvention: Cloudflare R2 binding name
  UPLOADS_BUCKET: R2Bucket;
  /**
   * Account ids allowed to moderate. Absent or empty ⇒ nobody is a moderator
   * and every transition is refused (fail closed).
   */
  moderationAccountIds?: readonly string[];
  /** Public origin for promoted bytes (e.g. `https://assets.bearlysleeping.com`). */
  catalogOriginUrl?: string;
};

// ── Response helpers ─────────────────────────────────────────────────────

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const unauthorized = (): Response => json({ error: 'unauthorized' }, 401);

const notFound = (): Response => json({ error: 'not-found' }, 404);

const forbidden = (error: string): Response => json({ error }, 403);

const badRequest = (error: string, extra?: Record<string, unknown>): Response =>
  json({ error, ...extra }, 400);

const unprocessable = (error: string, extra?: Record<string, unknown>): Response =>
  json({ error, ...extra }, 422);

/** Resolve the signed-in user id from the request, or undefined. */
const getSessionUserId = async (request: Request): Promise<string | undefined> => {
  const auth = getBetterAuth();
  if (!auth) {
    return undefined;
  }
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id;
};

const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

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

/** MIME type for an extension, or `application/octet-stream`. */
const mimeForExtension = (ext: string): string =>
  IMAGE_MIME_MAP[ext] ?? AUDIO_MIME_MAP[ext] ?? 'application/octet-stream';

/** True when `ext` is a plausible extension for `category` (server-side). */
const extensionAllowedForCategory = (category: string, ext: string): boolean => {
  const definition = ASSET_CATEGORIES[category];
  if (definition) {
    return definition.extensions.has(ext);
  }
  return ext in IMAGE_MIME_MAP || ext in AUDIO_MIME_MAP;
};

const ownerDeliveryPath = (slug: string): string => `/api/assets/community/${slug}/raw`;

const publicDeliveryUrl = (env: AssetCommunityEnv, r2Key: string): string =>
  env.catalogOriginUrl
    ? `${env.catalogOriginUrl.replace(/\/$/, '')}/${r2Key}`
    : `/api/assets/community/${r2Key}`;

const parseProvenance = (value: string): CommunityAssetProvenanceProjection => {
  try {
    return JSON.parse(value) as CommunityAssetProvenanceProjection;
  } catch {
    return { source: '' };
  }
};

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

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_UPLOAD_SIZE) {
    await rollback();
    return json({ error: 'asset_too_large', maxBytes: MAX_UPLOAD_SIZE }, 413);
  }
  if (bytes.byteLength !== staging.sizeBytes) {
    await rollback();
    return unprocessable('size-mismatch', { declaredSizeBytes: staging.sizeBytes });
  }

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

/**
 * GET /api/assets/community — community listing.
 *
 * Public: approved + promoted rows only (the newest approved revision per
 * slug), never another user's pending rows. `?mine=1` returns the caller's own
 * submissions in every moderation state and requires a session.
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
  let cursor: { updatedAt: Date; id: string } | undefined;
  if (rawCursor !== null) {
    const separator = rawCursor.indexOf('.');
    const timestamp = Number(rawCursor.slice(0, separator));
    const id = rawCursor.slice(separator + 1);
    if (separator < 1 || !Number.isSafeInteger(timestamp) || timestamp < 0 || !id) {
      return badRequest('invalid-cursor');
    }
    cursor = { updatedAt: new Date(timestamp), id };
  }

  let accountId: string | undefined;
  if (mine) {
    accountId = await getSessionUserId(request);
    if (!accountId) {
      return unauthorized();
    }
  }

  const db = drizzle(env.DB, { schema: { communityAssets } });

  // Newest revision per slug *within the visible set*. A pending re-publish
  // must not hide the previously approved revision.
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
  if (category !== null) {
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
  return json(
    {
      items: page.map((row) =>
        toSummary({ row, isOwner: mine && row.ownerAccountId === accountId, env }),
      ),
      ...(rows.length > limit && last
        ? { nextCursor: `${last.updatedAt.getTime()}.${last.id}` }
        : {}),
    },
    200,
  );
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
