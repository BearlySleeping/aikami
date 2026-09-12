// apps/frontend/hub/src/lib/server/api/map_studio.ts
//
// C-508 — Map Studio Phase 3: per-user drafts + community map publishing.
//
// The curated catalog is a CI-owned static R2 index (invariant: catalog is
// never written by the hub). Creators therefore publish into a hub-served
// *community* namespace: metadata in D1, the native scene document uploaded
// to the CATALOG_BUCKET, and an immutable revision recorded. Listings and
// documents are served back by these endpoints and merged into the studio's
// map picker.
//
// Every draft read/write is owner-scoped (Better Auth session). Publishing is
// gated by the pure `validateCommunityMapDocument` document check plus the
// C-381 `validatePack` provenance/terrain gate when the client supplies the
// source pack context.

import { communityMaps, mapDrafts } from '@aikami/backend-database';
import {
  COMMUNITY_MAP_DOCUMENT_MAX_BYTES,
  CommunityMapSlugSchema,
  type ContentPackManifest,
  ContentPackManifestSchema,
  communityMapKey,
  MAP_DRAFT_DOCUMENT_MAX_BYTES,
  type PackValidationIssue,
  validateCommunityMapDocument,
  validatePack,
} from '@aikami/schemas';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Value } from 'typebox/value';
import { getBetterAuth } from './better_auth.ts';

export type MapStudioEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  DB: import('@cloudflare/workers-types').D1Database;
  // biome-ignore lint/style/useNamingConvention: Cloudflare R2 binding name
  CATALOG_BUCKET: import('@cloudflare/workers-types').R2Bucket;
};

// ── Helpers ──────────────────────────────────────────────────────────────

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const unauthorized = (): Response => json({ error: 'unauthorized' }, 401);

const notFound = (): Response => json({ error: 'not-found' }, 404);

/** Resolve the signed-in user id from the request, or undefined. */
const getSessionUserId = async (request: Request): Promise<string | undefined> => {
  const auth = getBetterAuth();
  if (!auth) {
    return undefined;
  }
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id;
};

const bodyByteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** `My Great Map!` → `my-great-map`. Always non-empty. */
export const slugify = (value: string): string => {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'map';
};

/** A short collision suffix for derived slugs. */
const slugSuffix = (): string => crypto.randomUUID().slice(0, 6);

/** Parse a typebox-parsed document from an unknown body field. */
const asDocumentText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const validateDocument = (
  document: string,
  maxBytes: number,
): { ok: true } | { ok: false; response: Response } => {
  if (bodyByteLength(document) > maxBytes) {
    return {
      ok: false,
      response: json({ error: 'document_too_large', maxBytes }, 413),
    };
  }
  const result = validateCommunityMapDocument(document);
  if (!result.valid) {
    return { ok: false, response: json({ error: 'invalid-document', issues: result.issues }, 422) };
  }
  return { ok: true };
};

// ── Drafts ───────────────────────────────────────────────────────────────

/** GET /api/maps/drafts — the signed-in user's drafts (metadata only). */
export const handleListDrafts = async (request: Request, env: MapStudioEnv): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  const db = drizzle(env.DB, { schema: { mapDrafts } });
  const rows = await db
    .select({
      id: mapDrafts.id,
      name: mapDrafts.name,
      createdAt: mapDrafts.createdAt,
      updatedAt: mapDrafts.updatedAt,
    })
    .from(mapDrafts)
    .where(eq(mapDrafts.ownerAccountId, accountId))
    .orderBy(desc(mapDrafts.updatedAt));
  return json(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    200,
  );
};

/** POST /api/maps/drafts — create a draft. */
export const handleCreateDraft = async (
  request: Request,
  env: MapStudioEnv,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  const body = (rawBody ?? {}) as { name?: unknown; document?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const document = asDocumentText(body.document);
  if (!name || name.length > 120 || !document) {
    return json({ error: 'invalid-argument' }, 400);
  }
  const valid = validateDocument(document, MAP_DRAFT_DOCUMENT_MAX_BYTES);
  if (!valid.ok) {
    return valid.response;
  }

  const db = drizzle(env.DB, { schema: { mapDrafts } });
  const now = new Date();
  const row = await db
    .insert(mapDrafts)
    .values({
      id: crypto.randomUUID(),
      ownerAccountId: accountId,
      name,
      document,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const created = row[0];
  return json(
    {
      id: created.id,
      name: created.name,
      document: created.document,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    },
    201,
  );
};

/** GET /api/maps/drafts/:id — one owned draft, with its document. */
export const handleGetDraft = async (
  request: Request,
  env: MapStudioEnv,
  id: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  const db = drizzle(env.DB, { schema: { mapDrafts } });
  const rows = await db
    .select()
    .from(mapDrafts)
    .where(and(eq(mapDrafts.id, id), eq(mapDrafts.ownerAccountId, accountId)));
  const row = rows[0];
  if (!row) {
    return notFound();
  }
  return json(
    {
      id: row.id,
      name: row.name,
      document: row.document,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    200,
  );
};

/** PUT /api/maps/drafts/:id — update a draft's name and/or document. */
export const handleUpdateDraft = async (
  request: Request,
  env: MapStudioEnv,
  id: string,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  const body = (rawBody ?? {}) as { name?: unknown; document?: unknown };
  const db = drizzle(env.DB, { schema: { mapDrafts } });
  const existing = await db
    .select()
    .from(mapDrafts)
    .where(and(eq(mapDrafts.id, id), eq(mapDrafts.ownerAccountId, accountId)));
  if (!existing[0]) {
    return notFound();
  }

  const patch: { name?: string; document?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) {
      return json({ error: 'invalid-argument' }, 400);
    }
    patch.name = name;
  }
  if (body.document !== undefined) {
    const document = asDocumentText(body.document);
    if (!document) {
      return json({ error: 'invalid-argument' }, 400);
    }
    const valid = validateDocument(document, MAP_DRAFT_DOCUMENT_MAX_BYTES);
    if (!valid.ok) {
      return valid.response;
    }
    patch.document = document;
  }

  const row = await db
    .update(mapDrafts)
    .set(patch)
    .where(and(eq(mapDrafts.id, id), eq(mapDrafts.ownerAccountId, accountId)))
    .returning();
  const updated = row[0];
  return json(
    {
      id: updated.id,
      name: updated.name,
      document: updated.document,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
    200,
  );
};

/** DELETE /api/maps/drafts/:id — remove an owned draft. */
export const handleDeleteDraft = async (
  request: Request,
  env: MapStudioEnv,
  id: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  const db = drizzle(env.DB, { schema: { mapDrafts } });
  const deleted = await db
    .delete(mapDrafts)
    .where(and(eq(mapDrafts.id, id), eq(mapDrafts.ownerAccountId, accountId)))
    .returning({ id: mapDrafts.id });
  if (!deleted[0]) {
    return notFound();
  }
  return json({ deleted: deleted[0].id }, 200);
};

// ── Community publishing ─────────────────────────────────────────────────

/**
 * Optional C-381 `validatePack` gate. Runs only when the studio supplies the
 * source pack context (manifest + optional atlas frames/map files). Returns a
 * 422 Response when the manifest or pack fails validation.
 */
const runPackGate = async (
  packContext: unknown,
): Promise<{ ok: true } | { ok: false; response: Response }> => {
  if (packContext === undefined) {
    return { ok: true };
  }
  const context = packContext as {
    manifest?: unknown;
    atlasFrames?: unknown;
    mapFiles?: unknown;
    mapId?: unknown;
  };
  if (!Value.Check(ContentPackManifestSchema, context.manifest)) {
    return {
      ok: false,
      response: json({ error: 'invalid-pack-context', issues: ['manifest schema invalid'] }, 422),
    };
  }
  const atlasFrames = Array.isArray(context.atlasFrames)
    ? new Set(context.atlasFrames.filter((f): f is string => typeof f === 'string'))
    : undefined;
  const mapFiles =
    context.mapFiles && typeof context.mapFiles === 'object'
      ? (context.mapFiles as Record<string, string>)
      : undefined;
  const result = validatePack({
    manifest: context.manifest as ContentPackManifest,
    atlasFrames,
    mapFiles,
  });
  if (result.errors.length > 0) {
    const issues: PackValidationIssue[] = result.errors;
    return { ok: false, response: json({ error: 'pack-invalid', issues }, 422) };
  }
  return { ok: true };
};

/**
 * POST /api/maps/community — publish (or re-publish) a community map.
 *
 * Owned by the signed-in user. A new publish of an existing slug owned by the
 * caller appends an immutable revision; a slug owned by someone else 409s.
 */
export const handlePublishCommunityMap = async (
  request: Request,
  env: MapStudioEnv,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }
  const body = (rawBody ?? {}) as {
    title?: unknown;
    document?: unknown;
    slug?: unknown;
    packContext?: unknown;
  };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const document = asDocumentText(body.document);
  if (!title || title.length > 120 || !document) {
    return json({ error: 'invalid-argument' }, 400);
  }
  const valid = validateDocument(document, COMMUNITY_MAP_DOCUMENT_MAX_BYTES);
  if (!valid.ok) {
    return valid.response;
  }
  const packGate = await runPackGate(body.packContext);
  if (!packGate.ok) {
    return packGate.response;
  }

  const db = drizzle(env.DB, { schema: { communityMaps } });

  // Resolve the slug: explicit slug must be free or owned by the caller; a
  // derived slug may gain a short suffix to avoid another owner's map.
  let hasExplicitSlug = false;
  let requestedSlug = slugify(title);
  if (body.slug !== undefined && typeof body.slug !== 'string') {
    return json({ error: 'invalid-argument' }, 400);
  }
  if (typeof body.slug === 'string' && body.slug.length > 0) {
    if (!Value.Check(CommunityMapSlugSchema, body.slug)) {
      return json({ error: 'invalid-slug' }, 400);
    }
    hasExplicitSlug = true;
    requestedSlug = body.slug;
  }
  let slug = requestedSlug;
  const documentHash = await sha256Hex(document);
  const sizeBytes = bodyByteLength(document);
  let reservation: { id: string; revision: number; r2Key: string } | undefined;

  // Reserve the immutable (slug, revision) row before touching R2. Concurrent
  // publishers that choose the same next revision conflict here and retry.
  for (let attempt = 0; attempt < 8; attempt++) {
    const latest = await db
      .select()
      .from(communityMaps)
      .where(eq(communityMaps.slug, slug))
      .orderBy(desc(communityMaps.revision))
      .limit(1);
    if (latest[0] && latest[0].ownerAccountId !== accountId) {
      if (hasExplicitSlug) {
        return json({ error: 'slug-taken' }, 409);
      }
      slug = `${requestedSlug.slice(0, 50)}-${slugSuffix()}`;
      continue;
    }

    const revision = (latest[0]?.revision ?? 0) + 1;
    const id = crypto.randomUUID();
    const r2Key = communityMapKey.build({ slug, revision: String(revision) });
    const now = new Date();
    try {
      await db.insert(communityMaps).values({
        id,
        slug,
        ownerAccountId: accountId,
        title,
        revision,
        documentHash,
        r2Key,
        sizeBytes,
        document,
        createdAt: now,
        updatedAt: now,
      });
      reservation = { id, revision, r2Key };
      break;
    } catch (error) {
      const cause =
        error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
      const message = `${String(error)} ${String(cause)}`;
      if (
        /UNIQUE constraint failed: community_maps\.slug, community_maps\.revision/i.test(message)
      ) {
        continue;
      }
      throw error;
    }
  }
  if (!reservation) {
    return json({ error: 'revision-conflict' }, 409);
  }

  try {
    await env.CATALOG_BUCKET.put(reservation.r2Key, document, {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch (error) {
    // Delete the object before releasing this request's reservation. Another
    // request cannot reuse the revision until this exact row is gone.
    await env.CATALOG_BUCKET.delete(reservation.r2Key).catch(() => undefined);
    await db.delete(communityMaps).where(eq(communityMaps.id, reservation.id));
    throw error;
  }

  return json(
    {
      slug,
      revision: reservation.revision,
      documentHash,
      url: `/api/maps/community/${slug}`,
    },
    reservation.revision === 1 ? 201 : 200,
  );
};

/** GET /api/maps/community — public list of published community maps. */
export const handleListCommunityMaps = async (
  request: Request,
  env: MapStudioEnv,
): Promise<Response> => {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return json({ error: 'invalid-page-size' }, 400);
  }
  const rawCursor = url.searchParams.get('cursor');
  let cursor: { updatedAt: Date; id: string } | undefined;
  if (rawCursor !== null) {
    const separator = rawCursor.indexOf('.');
    const timestamp = Number(rawCursor.slice(0, separator));
    const id = rawCursor.slice(separator + 1);
    if (separator < 1 || !Number.isSafeInteger(timestamp) || timestamp < 0 || !id) {
      return json({ error: 'invalid-cursor' }, 400);
    }
    cursor = { updatedAt: new Date(timestamp), id };
  }

  const db = drizzle(env.DB, { schema: { communityMaps } });
  const latestRevision = sql`${communityMaps.revision} = (
    SELECT MAX(latest.revision)
    FROM community_maps AS latest
    WHERE latest.slug = ${communityMaps.slug}
  )`;
  const cursorFilter = cursor
    ? or(
        lt(communityMaps.updatedAt, cursor.updatedAt),
        and(eq(communityMaps.updatedAt, cursor.updatedAt), lt(communityMaps.id, cursor.id)),
      )
    : undefined;
  const rows = await db
    .select({
      id: communityMaps.id,
      slug: communityMaps.slug,
      title: communityMaps.title,
      revision: communityMaps.revision,
      documentHash: communityMaps.documentHash,
      sizeBytes: communityMaps.sizeBytes,
      createdAt: communityMaps.createdAt,
      updatedAt: communityMaps.updatedAt,
    })
    .from(communityMaps)
    .where(cursorFilter ? and(latestRevision, cursorFilter) : latestRevision)
    .orderBy(desc(communityMaps.updatedAt), desc(communityMaps.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return json(
    {
      items: page.map(({ id: _id, ...row }) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      ...(rows.length > limit && last
        ? { nextCursor: `${last.updatedAt.getTime()}.${last.id}` }
        : {}),
    },
    200,
  );
};

/** GET /api/maps/community/:slug — public document for one community map. */
export const handleGetCommunityMap = async (
  _request: Request,
  env: MapStudioEnv,
  slug: string,
): Promise<Response> => {
  const db = drizzle(env.DB, { schema: { communityMaps } });
  const rows = await db
    .select()
    .from(communityMaps)
    .where(eq(communityMaps.slug, slug))
    .orderBy(desc(communityMaps.revision))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return notFound();
  }
  return json(
    {
      slug: row.slug,
      title: row.title,
      revision: row.revision,
      documentHash: row.documentHash,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      document: row.document,
    },
    200,
  );
};
