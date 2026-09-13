// apps/frontend/hub/src/lib/server/api/asset_community_shared.ts
//
// C-513 — the helpers every community-asset route module shares: the JSON
// response constructors, the session lookup, the per-account publish limiter,
// the extension/key/URL derivations, and the row → summary projection.
//
// Split out of `asset_community.ts` when the moderation handlers moved to their
// own module: both need these, and neither should own them.

import { ASSET_CATEGORIES, AUDIO_MIME_MAP, IMAGE_MIME_MAP } from '@aikami/constants';
import type { CommunityAssetProvenanceProjection } from '@aikami/schemas';
import { tryReserveWindow } from '@aikami/utils';
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
 * are two hits, so 30 hits is roughly 15 publishes a minute. Deliberately a
 * sliding *window* rather than a bare cooldown: the contract also requires a
 * failed upload to stay retryable and a concurrent duplicate reserve to be
 * arbitrated by the unique index (AC-8), and a pure cooldown would reject both
 * as if they were abuse.
 */
export const COMMUNITY_PUBLISH_MAX_HITS = 30;
export const COMMUNITY_PUBLISH_WINDOW_MS = 60 * 1000;

/** Meters one publish step for `accountId`; false ⇒ answer 429. */
export const withinPublishRateLimit = (accountId: string): boolean =>
  tryReserveWindow(`community-publish:${accountId}`, {
    maxHits: COMMUNITY_PUBLISH_MAX_HITS,
    windowMs: COMMUNITY_PUBLISH_WINDOW_MS,
  });

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
