// apps/frontend/hub/src/lib/server/api/asset_themes.ts
//
// C-530 AC-1 / AC-2 / AC-3 — Hub theme publishing.
//
// Reserve → upload the package to the *private* intake bucket → validate the
// whole package server-side with the same core validator the client and the CLI
// use → commit an immutable pending version → promote into the shared
// content-addressed `assets/` namespace at moderation time.
//
// The publish pattern mirrors C-513's `asset_community.ts` exactly (validate →
// session gate → reserve the immutable key in D1 → R2 write → rollback on
// failure), because the invariants are the same ones: bytes are never public on
// upload, the hub computes the content address itself, and the reserve-generated
// row id doubles as the upload id so a retry is idempotent without a second,
// client-supplied key.
//
// 🔴 Three rules this module exists to enforce:
//   1. A theme is not a `CatalogCategory`. `.zip` is in neither the image nor
//      the audio extension map, so a theme package is refused at *reserve*
//      today — hence the dedicated `/api/assets/themes*` family.
//   2. The manifest inside the archive is the authority. `themeId`, `version`,
//      `license`, `themeApiRange`, the author display name and every declared
//      asset come from the *validated* package, never from a JSON claim.
//   3. `(themeId, version)` is immutable. A second publish of the same pair is
//      a named `duplicate-version` refusal, never a new revision.

import { assetPublishStaging, themePublishStaging, themeVersions } from '@aikami/backend-database';
import { MAX_UPLOAD_SIZE, r2AssetKey } from '@aikami/constants';
import {
  isThemeApiRangeSupported,
  readThemeArchiveEntries,
  type ThemePackageValidation,
  validateThemeArchive,
} from '@aikami/frontend/theme';
import {
  type CommunityAssetProvenanceProjection,
  evaluateCommunityPublishGate,
  ReserveThemeVersionRequestSchema,
  type ThemeVersionSummary,
} from '@aikami/schemas';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import {
  badRequest,
  getSessionUserId,
  json,
  notFound,
  rateLimited,
  sha256Hex,
  unauthorized,
  unprocessable,
  withinPublishRateLimit,
} from './asset_community_shared.ts';
import type { AssetThemeEnv } from './asset_themes_env.ts';
import {
  deriveVariantFacts,
  listThemeVersions,
  mapThemeValidationIssues,
  parseThemeVersionCursor,
  readVisibleThemeVersion,
  serializeVariantDeclarations,
  type ThemeRejection,
  themeOwnerDeliveryPath,
  themeUploadPath,
  toThemeDetail,
  toThemeSummary,
} from './asset_themes_shared.ts';

/** The staging states a resumed retry may continue from. */
const RESUMABLE_STATES = ['reserved', 'uploaded', 'orphaned'] as const;

/** 503 for a deployment where the theme feature gate is off. */
const themePublishingDisabled = (): Response =>
  json({ error: 'theme-publishing-disabled', detail: 'Theme publishing is disabled.' }, 503);

/** 503 for a deployment without the intake binding. */
const themePublishingUnconfigured = (): Response =>
  json({ error: 'theme-publishing-unconfigured' }, 503);

const rejection = (value: ThemeRejection): Response =>
  json(
    { error: value.error, ...(value.detail === undefined ? {} : { detail: value.detail }) },
    value.status,
  );

// ── Reservation (step 1) ─────────────────────────────────────────────────

/**
 * POST /api/assets/themes — reserve a theme-version publish.
 *
 * Validates the metadata and the scoped rights gate *before* anything is
 * written, refuses a pair that already exists as a named `duplicate-version`,
 * and reserves `(owner, themeId, version)` in `theme_publish_staging`.
 */
export const handleReserveThemeVersion = async (
  request: Request,
  env: AssetThemeEnv,
  rawBody: unknown,
): Promise<Response> => {
  if (!env.themePublishingEnabled) {
    return themePublishingDisabled();
  }

  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  if (!(await withinPublishRateLimit(env, accountId))) {
    logger.info('asset:theme reserve rate-limited', { accountId });
    return rateLimited();
  }

  const body = rawBody ?? {};
  if (!Value.Check(ReserveThemeVersionRequestSchema, body)) {
    return badRequest('invalid-argument');
  }
  const input = body as {
    themeId: string;
    version: string;
    sizeBytes: number;
    provenance: CommunityAssetProvenanceProjection;
  };

  if (input.sizeBytes > MAX_UPLOAD_SIZE) {
    return json({ error: 'theme-archive-too-large', maxBytes: MAX_UPLOAD_SIZE }, 413);
  }

  // The licence/provenance gate runs at *reserve*: a refused publish must never
  // upload a byte. Rights come only from the server-owned evidence resolver.
  const rights = await env.resolveRightsDecision?.({
    accountId,
    provenance: input.provenance,
  });
  const gate = evaluateCommunityPublishGate({ provenance: input.provenance, rights });
  if (!gate.ok) {
    logger.info('asset:theme reserve refused by rights gate', {
      code: gate.code,
      missing: gate.missing,
    });
    return json({ error: gate.code, missing: gate.missing, message: gate.message }, 422);
  }

  const db = drizzle(env.DB, { schema: { themePublishStaging, themeVersions } });

  // (themeId, version) is immutable and globally reserved: a second publish of
  // the same pair is refused by name, and a pair owned by somebody else is
  // indistinguishable from a taken name.
  const existing = await db
    .select({ ownerAccountId: themeVersions.ownerAccountId, version: themeVersions.version })
    .from(themeVersions)
    .where(eq(themeVersions.slug, input.themeId));

  // Ownership is resolved before the version is: a theme id owned by somebody
  // else is `theme-slug-taken` regardless of which versions exist, so the
  // answer never leaks whether a particular version was already published.
  if (existing.length > 0 && existing.every((row) => row.ownerAccountId !== accountId)) {
    return json({ error: 'theme-slug-taken' }, 409);
  }
  if (existing.some((row) => row.version === input.version)) {
    return json({ error: 'duplicate-version' }, 409);
  }

  const id = crypto.randomUUID();
  const stagingKey = `staging/${accountId}/${id}`;
  const now = new Date();

  // Abandon stale reservations for this (owner, slug, version) so a retry after
  // a failed upload is not blocked by its own aborted attempt.
  await db
    .update(themePublishStaging)
    .set({ state: 'rolled_back', updatedAt: now })
    .where(
      and(
        eq(themePublishStaging.ownerAccountId, accountId),
        eq(themePublishStaging.slug, input.themeId),
        eq(themePublishStaging.version, input.version),
        eq(themePublishStaging.state, 'reserved'),
      ),
    );

  try {
    await db.insert(themePublishStaging).values({
      id,
      ownerAccountId: accountId,
      slug: input.themeId,
      version: input.version,
      sizeBytes: input.sizeBytes,
      stagingKey,
      state: 'reserved',
      provenanceJson: JSON.stringify(input.provenance),
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
    const message = `${String(error)} ${String(cause)}`;
    if (/UNIQUE constraint failed: theme_publish_staging/i.test(message)) {
      return json({ error: 'revision-conflict' }, 409);
    }
    throw error;
  }

  logger.info('asset:theme reserved', {
    themeId: input.themeId,
    version: input.version,
    sizeBytes: input.sizeBytes,
  });

  return json(
    {
      themeId: input.themeId,
      version: input.version,
      uploadPath: themeUploadPath(input.themeId, input.version),
      stagingState: 'reserved',
    },
    201,
  );
};

// ── Upload / commit (step 2) ─────────────────────────────────────────────

/**
 * PUT /api/assets/themes/:slug/upload — the owner's raw package bytes.
 *
 * `Content-Length` is checked against the reservation **before** the body is
 * buffered, the hub computes the sha256 itself, the whole package is validated
 * with the shared core validator behind the Worker-runtime extractor, and the
 * object lands in the private intake bucket. A failed hop rolls the reservation
 * back.
 */
export const handleUploadThemeVersion = async (
  request: Request,
  env: AssetThemeEnv,
  themeId: string,
  version: string | undefined,
): Promise<Response> => {
  if (!env.themePublishingEnabled) {
    return themePublishingDisabled();
  }

  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  if (!(await withinPublishRateLimit(env, accountId))) {
    logger.info('asset:theme upload rate-limited', { accountId, themeId });
    return rateLimited();
  }

  const db = drizzle(env.DB, { schema: { themePublishStaging, themeVersions } });
  const stagingFilters = [
    eq(themePublishStaging.ownerAccountId, accountId),
    eq(themePublishStaging.slug, themeId),
    inArray(themePublishStaging.state, [...RESUMABLE_STATES]),
  ];
  if (version !== undefined) {
    stagingFilters.push(eq(themePublishStaging.version, version));
  }
  const stagingRows = await db
    .select()
    .from(themePublishStaging)
    .where(and(...stagingFilters))
    .orderBy(desc(themePublishStaging.createdAt))
    .limit(1);
  const staging = stagingRows[0];
  if (!staging) {
    return notFound();
  }

  const rollback = async (): Promise<void> => {
    await db
      .update(themePublishStaging)
      .set({ state: 'rolled_back', updatedAt: new Date() })
      .where(
        and(
          eq(themePublishStaging.id, staging.id),
          inArray(themePublishStaging.state, [...RESUMABLE_STATES]),
        ),
      );
  };

  // 🔴 Size gate BEFORE buffering.
  const declaredLength = Number(request.headers.get('content-length'));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
    return badRequest('invalid-argument');
  }
  if (declaredLength > MAX_UPLOAD_SIZE) {
    return json({ error: 'theme-archive-too-large', maxBytes: MAX_UPLOAD_SIZE }, 413);
  }
  if (declaredLength !== staging.sizeBytes) {
    await rollback();
    return unprocessable('size-mismatch', { declaredSizeBytes: staging.sizeBytes });
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_UPLOAD_SIZE) {
    await rollback();
    return json({ error: 'theme-archive-too-large', maxBytes: MAX_UPLOAD_SIZE }, 413);
  }
  if (raw.byteLength !== staging.sizeBytes) {
    await rollback();
    return unprocessable('size-mismatch', { declaredSizeBytes: staging.sizeBytes });
  }

  const bytes = new Uint8Array(raw);

  // 🔴 Server-side validation. A client-supplied verdict is never consulted.
  const read = await readThemeArchiveEntries(bytes);
  if (!read.ok) {
    logger.info('asset:theme upload refused at the archive container', {
      themeId,
      code: read.issues[0]?.code,
    });
    await rollback();
    return rejection(mapThemeValidationIssues(read.issues));
  }

  const validation: ThemePackageValidation = validateThemeArchive(read.entries);
  if (!validation.ok || validation.manifest === undefined) {
    logger.info('asset:theme upload refused by the package validator', {
      themeId,
      codes: validation.errors.map((entry) => entry.code),
    });
    await rollback();
    return rejection(mapThemeValidationIssues(validation.errors));
  }
  const manifest = validation.manifest;

  // The archive is the authority: a reservation for a different identity than
  // the package declares is refused rather than reconciled.
  if (manifest.id !== staging.slug || manifest.version !== staging.version) {
    await rollback();
    return json(
      {
        error: 'theme-invalid-manifest',
        detail: `The package declares ${manifest.id}@${manifest.version}, not ${staging.slug}@${staging.version}.`,
      },
      422,
    );
  }
  if (manifest.license.trim().length === 0) {
    await rollback();
    return json({ error: 'theme-invalid-license' }, 422);
  }
  if (!isThemeApiRangeSupported(manifest.themeApiRange)) {
    await rollback();
    return json(
      {
        error: 'theme-unsupported-api',
        detail: `This theme requires theme API "${manifest.themeApiRange}", which this server does not implement.`,
      },
      422,
    );
  }

  const sha256 = await sha256Hex(bytes);
  const variantFacts = deriveVariantFacts(validation, read.entries);

  try {
    await env.UPLOADS_BUCKET.put(staging.stagingKey, bytes, {
      httpMetadata: { contentType: 'application/zip' },
    });
  } catch (error) {
    logger.error('asset:theme upload failed', { themeId, error });
    await rollback();
    return json({ error: 'upload-failed' }, 502);
  }

  await db
    .update(themePublishStaging)
    .set({ state: 'uploaded', sha256, updatedAt: new Date() })
    .where(
      and(
        eq(themePublishStaging.id, staging.id),
        inArray(themePublishStaging.state, [...RESUMABLE_STATES]),
      ),
    );

  const now = new Date();
  try {
    await db.insert(themeVersions).values({
      id: crypto.randomUUID(),
      ownerAccountId: accountId,
      slug: staging.slug,
      version: staging.version,
      name: manifest.name,
      authorDisplayName: manifest.author.displayName,
      license: manifest.license,
      themeApiRange: manifest.themeApiRange,
      manifestJson: JSON.stringify(manifest),
      variantsJson: serializeVariantDeclarations(validation),
      variantFactsJson: JSON.stringify(variantFacts),
      assetCount: manifest.assets.length,
      packageBytes: bytes.byteLength,
      sha256,
      r2Key: null,
      ext: '.zip',
      provenanceJson: staging.provenanceJson,
      moderationState: 'pending',
      hasHudPreset: manifest.hudPreset !== undefined,
      notes: staging.notes,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
    const message = `${String(error)} ${String(cause)}`;
    logger.error('asset:theme commit failed; staging row is recoverable', {
      themeId,
      version: staging.version,
      error,
    });
    if (/UNIQUE constraint failed: theme_versions/i.test(message)) {
      await rollback();
      return json({ error: 'duplicate-version' }, 409);
    }
    return json({ error: 'commit-failed' }, 502);
  }

  await db
    .update(themePublishStaging)
    .set({ state: 'committed', updatedAt: new Date() })
    .where(eq(themePublishStaging.id, staging.id));

  logger.info('asset:theme published', {
    themeId: staging.slug,
    version: staging.version,
    packageBytes: bytes.byteLength,
    sha256,
    moderationState: 'pending',
  });

  return json(
    {
      themeId: staging.slug,
      version: staging.version,
      sha256,
      moderationState: 'pending',
      deliveryUrl: themeOwnerDeliveryPath(staging.slug, staging.version),
    },
    201,
  );
};

// ── Listing ──────────────────────────────────────────────────────────────

/**
 * GET /api/assets/themes — theme listing.
 *
 * Public: approved + promoted + non-revoked rows only. `?mine=1` returns the
 * caller's own submissions in every moderation state and requires a session.
 */
export const handleListThemeVersions = async (
  request: Request,
  env: AssetThemeEnv,
): Promise<Response> => {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 48 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return badRequest('invalid-page-size');
  }

  const mine = url.searchParams.get('mine') === '1';
  const themeId = url.searchParams.get('themeId');
  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor === null ? undefined : parseThemeVersionCursor(rawCursor);
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

  const listing = await listThemeVersions({
    env,
    ...(themeId === null ? {} : { themeId }),
    ...(accountId === undefined ? {} : { accountId }),
    mine,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  });

  return json(listing, 200);
};

/** GET /api/assets/themes/:slug — one version's detail. */
export const handleGetThemeVersion = async (
  request: Request,
  env: AssetThemeEnv,
  themeId: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const version = url.searchParams.get('version') ?? undefined;
  const accountId = await getSessionUserId(request);

  const row = await readVisibleThemeVersion({
    env,
    themeId,
    ...(version === undefined ? {} : { version }),
    ...(accountId === undefined ? {} : { accountId }),
  });
  if (!row) {
    return notFound();
  }

  const isOwner = accountId !== undefined && row.ownerAccountId === accountId;
  return json(toThemeDetail({ row, isOwner, env }), 200);
};

/** GET /api/assets/themes/:slug/raw — exact-version bytes for the owner, public when promoted. */
export const handleThemeVersionRaw = async (
  request: Request,
  env: AssetThemeEnv,
  themeId: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const version = url.searchParams.get('version') ?? undefined;
  const accountId = await getSessionUserId(request);

  const row = await readVisibleThemeVersion({
    env,
    themeId,
    ...(version === undefined ? {} : { version }),
    ...(accountId === undefined ? {} : { accountId }),
  });
  // Another user's pending row must be indistinguishable from a missing one.
  if (!row || accountId === undefined || row.ownerAccountId !== accountId) {
    return notFound();
  }

  if (row.promotedAt !== null && row.r2Key !== null && row.revokedAt === null) {
    const promotedObject = await env.CATALOG_BUCKET.get(
      r2AssetKey({ hash: row.sha256, ext: row.ext }),
    );
    if (!promotedObject) {
      return notFound();
    }
    const promotedBytes = await promotedObject.arrayBuffer();
    return new Response(promotedBytes, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-length': String(promotedBytes.byteLength),
        'content-disposition': `attachment; filename="${themeId}-${row.version}.aikami-theme.zip"`,
        'cache-control': 'private, no-store',
      },
    });
  }

  const db = drizzle(env.DB, { schema: { themePublishStaging } });
  const stagingRows = await db
    .select({ stagingKey: themePublishStaging.stagingKey })
    .from(themePublishStaging)
    .where(
      and(
        eq(themePublishStaging.ownerAccountId, accountId),
        eq(themePublishStaging.slug, themeId),
        eq(themePublishStaging.version, row.version),
        sql`${themePublishStaging.state} <> 'rolled_back'`,
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
      'content-type': 'application/zip',
      'content-length': String(bytes.byteLength),
      'content-disposition': `attachment; filename="${themeId}-${row.version}.aikami-theme.zip"`,
      'cache-control': 'private, no-store',
    },
  });
};

/**
 * GET /api/assets/themes/:slug/public — the public, content-addressed bytes.
 *
 * 🔴 Proven against real bytes, not a filtered listing row (AC-3): a pending,
 * rejected or revoked version 404s here, and an approved+promoted version is
 * byte-identical to the uploaded package digest.
 */
export const handleThemeVersionPublic = async (
  request: Request,
  env: AssetThemeEnv,
  themeId: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const version = url.searchParams.get('version') ?? undefined;
  if (version === undefined) {
    return badRequest('invalid-argument');
  }

  const db = drizzle(env.DB, { schema: { themeVersions } });
  const rows = await db
    .select()
    .from(themeVersions)
    .where(and(eq(themeVersions.slug, themeId), eq(themeVersions.version, version)))
    .limit(1);
  const row = rows[0];
  if (
    !row ||
    row.moderationState !== 'approved' ||
    row.promotedAt === null ||
    row.revokedAt !== null
  ) {
    return notFound();
  }

  const object = await env.CATALOG_BUCKET.get(r2AssetKey({ hash: row.sha256, ext: row.ext }));
  if (!object) {
    return notFound();
  }
  const bytes = await object.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-length': String(bytes.byteLength),
      'content-disposition': `attachment; filename="${themeId}-${row.version}.aikami-theme.zip"`,
      // 🔴 The client verifies the body against this digest, and the version it
      // asked for against this header — a Hub that served something else
      // cannot get it installed. Both are derived from the immutable row, never
      // from the request.
      'x-aikami-package-sha256': row.sha256,
      'x-aikami-theme-version': row.version,
      'cache-control': 'public, max-age=300',
    },
  });
};

/** GET /api/assets/themes/counters — theme-surface counters. */
export const handleThemeCounters = async (
  _request: Request,
  env: AssetThemeEnv,
): Promise<Response> => {
  const db = drizzle(env.DB, { schema: { themeVersions } });
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(themeVersions)
    .where(
      and(
        eq(themeVersions.moderationState, 'approved'),
        sql`${themeVersions.promotedAt} IS NOT NULL`,
        sql`${themeVersions.revokedAt} IS NULL`,
      ),
    );
  return json({ total: Number(rows[0]?.count ?? 0) }, 200);
};

export type { ThemeVersionSummary };
export { themePublishingUnconfigured };
