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
  type ContentPackManifest,
  ContentPackManifestSchema,
  communityMapKey,
  type PackValidationIssue,
  validateCommunityMapDocument,
  validatePack,
} from '@aikami/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Value } from 'typebox/value';
import { getBetterAuth } from './better_auth.ts';

// ── Env ──────────────────────────────────────────────────────────────────

export type MapStudioEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  DB: import('@cloudflare/workers-types').D1Database;
  // biome-ignore lint/style/useNamingConvention: Cloudflare R2 binding name
  CATALOG_BUCKET: import('@cloudflare/workers-types').R2Bucket;
};

let _env: MapStudioEnv | undefined;

/** Inject the per-request Worker env (called by the catch-all route). */
export const setMapStudioEnv = (envValue: MapStudioEnv | undefined): void => {
  _env = envValue;
};

/** The injected env, or undefined when the hub is not on a Worker yet. */
export const getMapStudioEnv = (): MapStudioEnv | undefined => _env;

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

const validateDocument = (document: string): { ok: true } | { ok: false; response: Response } => {
  if (bodyByteLength(document) > COMMUNITY_MAP_DOCUMENT_MAX_BYTES) {
    return {
      ok: false,
      response: json(
        { error: 'document_too_large', maxBytes: COMMUNITY_MAP_DOCUMENT_MAX_BYTES },
        413,
      ),
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
  const valid = validateDocument(document);
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
    const valid = validateDocument(document);
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
  const valid = validateDocument(document);
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
  const requestedSlug =
    typeof body.slug === 'string' && body.slug.length > 0 ? body.slug : slugify(title);
  let slug = requestedSlug;
  let existing = await db.select().from(communityMaps).where(eq(communityMaps.slug, slug));
  if (existing[0] && existing[0].ownerAccountId !== accountId) {
    if (body.slug !== undefined) {
      return json({ error: 'slug-taken' }, 409);
    }
    do {
      slug = `${requestedSlug.slice(0, 50)}-${slugSuffix()}`;
      existing = await db.select().from(communityMaps).where(eq(communityMaps.slug, slug));
    } while (existing[0]);
  }

  const id = existing[0]?.id ?? crypto.randomUUID();
  const revision = (existing[0]?.revision ?? 0) + 1;
  const documentHash = await sha256Hex(document);
  const sizeBytes = bodyByteLength(document);
  const r2Key = communityMapKey.build({ slug, revision: String(revision) });
  const now = new Date();

  // Upload the document asset first; only on success write/refresh the row.
  await env.CATALOG_BUCKET.put(r2Key, document, {
    httpMetadata: { contentType: 'application/json' },
  });

  try {
    if (existing[0]) {
      await db
        .update(communityMaps)
        .set({ title, revision, documentHash, r2Key, sizeBytes, document, updatedAt: now })
        .where(eq(communityMaps.id, id));
    } else {
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
    }
  } catch (error) {
    // Row write failed — remove the orphaned object so no unpublished bytes
    // remain, then surface the failure.
    await env.CATALOG_BUCKET.delete(r2Key).catch(() => undefined);
    throw error;
  }

  return json(
    { slug, revision, documentHash, url: `/api/maps/community/${slug}` },
    existing[0] ? 200 : 201,
  );
};

/** GET /api/maps/community — public list of published community maps. */
export const handleListCommunityMaps = async (
  _request: Request,
  env: MapStudioEnv,
): Promise<Response> => {
  const db = drizzle(env.DB, { schema: { communityMaps } });
  const rows = await db
    .select({
      slug: communityMaps.slug,
      title: communityMaps.title,
      revision: communityMaps.revision,
      documentHash: communityMaps.documentHash,
      sizeBytes: communityMaps.sizeBytes,
      createdAt: communityMaps.createdAt,
      updatedAt: communityMaps.updatedAt,
    })
    .from(communityMaps)
    .orderBy(desc(communityMaps.updatedAt));
  return json(
    rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
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
  const rows = await db.select().from(communityMaps).where(eq(communityMaps.slug, slug));
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
