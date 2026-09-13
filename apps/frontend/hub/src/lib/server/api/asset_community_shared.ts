// apps/frontend/hub/src/lib/server/api/asset_community_shared.ts
//
// C-513 — the helpers every community-asset route module shares: the JSON
// response constructors, the session lookup, the per-account publish limiter,
// the extension/key/URL derivations, and the row → summary projection.
//
// Split out of `asset_community.ts` when the moderation handlers moved to their
// own module: both need these, and neither should own them.

import { assetPublishRateLimits } from '@aikami/backend-database';
import { ASSET_CATEGORIES, AUDIO_MIME_MAP, IMAGE_MIME_MAP } from '@aikami/constants';
import type { CommunityAssetProvenanceProjection, RightsDecision } from '@aikami/schemas';
import { and, eq, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
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
  /** Server-owned rights evidence resolver. Absent means unresolved. */
  resolveRightsDecision?(options: {
    accountId: string;
    provenance: CommunityAssetProvenanceProjection;
  }): Promise<RightsDecision | undefined>;
};

/** Content type every JSON route in this feature answers with. */
const jsonContentType = 'application/json';

// ── Response helpers ─────────────────────────────────────────────────────

export const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': jsonContentType } });

export const unauthorized = (): Response => json({ error: 'unauthorized' }, 401);

export const notFound = (): Response => json({ error: 'not-found' }, 404);

export const forbidden = (error: string): Response => json({ error }, 403);

export const badRequest = (error: string, extra?: Record<string, unknown>): Response =>
  json({ error, ...extra }, 400);

export const unprocessable = (error: string, extra?: Record<string, unknown>): Response =>
  json({ error, ...extra }, 422);

/**
 * Community-publish rate limit (Security/privacy QR: "rate-limit publish per
 * account").
 *
 * Metered per account across the whole publish flow — a reserve and its upload
 * are two hits, so 30 hits is roughly 15 publishes a minute. Reservations are
 * persisted in D1 and atomically incremented, so concurrent Worker isolates
 * enforce one shared quota rather than separate process-local limits.
 */
export const COMMUNITY_PUBLISH_MAX_HITS = 30;
export const COMMUNITY_PUBLISH_WINDOW_MS = 60 * 1000;

/** Atomically meters one publish step for `accountId`; false ⇒ answer 429. */
export const withinPublishRateLimit = async (
  env: AssetCommunityEnv,
  accountId: string,
): Promise<boolean> => {
  const db = drizzle(env.DB, { schema: { assetPublishRateLimits } });
  const windowStartedAt = new Date(
    Math.floor(Date.now() / COMMUNITY_PUBLISH_WINDOW_MS) * COMMUNITY_PUBLISH_WINDOW_MS,
  );

  // Bound retained state to the current window for each active account. The
  // reservation below remains the single atomic security decision.
  await db
    .delete(assetPublishRateLimits)
    .where(
      and(
        eq(assetPublishRateLimits.ownerAccountId, accountId),
        lt(assetPublishRateLimits.windowStartedAt, windowStartedAt),
      ),
    );

  const reserved = await db
    .insert(assetPublishRateLimits)
    .values({ ownerAccountId: accountId, windowStartedAt, hits: 1 })
    .onConflictDoUpdate({
      target: [assetPublishRateLimits.ownerAccountId, assetPublishRateLimits.windowStartedAt],
      set: { hits: sql`${assetPublishRateLimits.hits} + 1` },
      setWhere: lt(assetPublishRateLimits.hits, COMMUNITY_PUBLISH_MAX_HITS),
    })
    .returning({ hits: assetPublishRateLimits.hits });

  return reserved.length === 1;
};

/** 429 for a caller that has exhausted its publish window. */
export const rateLimited = (): Response => json({ error: 'rate_limited' }, 429);

/** Resolve the signed-in user id from the request, or undefined. */
export const getSessionUserId = async (request: Request): Promise<string | undefined> => {
  const auth = getBetterAuth();
  if (!auth) {
    return undefined;
  }
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id;
};

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  // TS models `Uint8Array<ArrayBufferLike>` separately from the `BufferSource`
  // WebCrypto accepts; the value is a valid byte view at runtime.
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** MIME type for an extension, or `application/octet-stream`. */
export const mimeForExtension = (ext: string): string =>
  IMAGE_MIME_MAP[ext] ?? AUDIO_MIME_MAP[ext] ?? 'application/octet-stream';

/** True when `ext` is a plausible extension for `category` (server-side). */
export const extensionAllowedForCategory = (category: string, ext: string): boolean => {
  const definition = ASSET_CATEGORIES[category];
  if (definition) {
    return definition.extensions.has(ext);
  }
  return ext in IMAGE_MIME_MAP || ext in AUDIO_MIME_MAP;
};

export const ownerDeliveryPath = (slug: string): string => `/api/assets/community/${slug}/raw`;

export const publicDeliveryUrl = (env: AssetCommunityEnv, r2Key: string): string =>
  env.catalogOriginUrl
    ? `${env.catalogOriginUrl.replace(/\/$/, '')}/${r2Key}`
    : `/api/assets/community/${r2Key}`;

export const parseProvenance = (value: string): CommunityAssetProvenanceProjection => {
  try {
    return JSON.parse(value) as CommunityAssetProvenanceProjection;
  } catch {
    return { source: '' };
  }
};
