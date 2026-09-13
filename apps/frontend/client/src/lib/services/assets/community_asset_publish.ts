// apps/frontend/client/src/lib/services/assets/community_asset_publish.ts
//
// C-513 AC-1 (client half): publish a local asset to the community namespace.
//
// Two steps, so bytes never travel in a JSON body:
//   1. POST /assets/community        — reserve (JSON metadata + declared size)
//   2. PUT  /assets/community/:slug/upload — the raw bytes
//
// The hub re-validates everything and computes the hash itself; this module
// never claims a hash. Publishing is an explicit, online, signed-in action —
// nothing about creating or using an asset depends on it.
//
// Contract: C-513

import { MAX_UPLOAD_SIZE } from '@aikami/constants';
import type { ReserveAssetRequest } from '@aikami/types';
import { stripImageMetadata } from '@aikami/utils';
import type {
  CommunityPublishDeps,
  CommunityPublishOutcome,
  CommunityPublishRequest,
} from './community_asset_capabilities.ts';

/** Hub-relative path builder (the base has no trailing slash). */
const hubUrl = (deps: CommunityPublishDeps, path: string): string =>
  `${deps.hubBaseUrl.replace(/\/$/, '')}${path}`;

/** Maps a hub refusal body to the outcome shape. */
const refusal = async (response: Response): Promise<CommunityPublishOutcome> => {
  let body: { error?: string; missing?: string[]; message?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Non-JSON error body — fall through with just the status.
  }
  return {
    published: false,
    reason: body.error ?? `http_${response.status}`,
    ...(body.missing === undefined ? {} : { missing: body.missing }),
    ...(body.message === undefined ? {} : { message: body.message }),
  };
};

/**
 * Publishes raw bytes as a community asset.
 *
 * The bytes are stripped of container metadata first (C-513 Security/privacy:
 * "strip EXIF and any embedded metadata that leaks local paths") and the
 * declared size comes from the *stripped* length — so the hub's
 * `declared == Content-Length` check keeps its meaning, and the hub hashes
 * exactly the bytes that travelled.
 */
export const publishCommunityAsset = async (
  deps: CommunityPublishDeps,
  request: CommunityPublishRequest,
  bytes: Uint8Array,
): Promise<CommunityPublishOutcome> => {
  const stripped = stripImageMetadata(bytes);
  const payload = stripped.bytes;

  if (payload.byteLength === 0) {
    return { published: false, reason: 'empty_asset' };
  }
  if (payload.byteLength > MAX_UPLOAD_SIZE) {
    return { published: false, reason: 'asset_too_large' };
  }

  const reserveBody: ReserveAssetRequest = {
    category: request.category as ReserveAssetRequest['category'],
    tag: request.tag,
    title: request.title,
    ext: request.ext,
    sizeBytes: payload.byteLength,
    provenance: request.provenance,
    ...(request.slug === undefined ? {} : { slug: request.slug }),
  };

  const reserveResponse = await deps.fetchImpl(hubUrl(deps, '/assets/community'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...deps.authHeaders() },
    credentials: 'include',
    body: JSON.stringify(reserveBody),
  });

  if (!reserveResponse.ok) {
    return refusal(reserveResponse);
  }

  const reservation = (await reserveResponse.json()) as {
    slug: string;
    revision: number;
    uploadPath: string;
  };

  const uploadResponse = await deps.fetchImpl(hubUrl(deps, reservation.uploadPath), {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', ...deps.authHeaders() },
    credentials: 'include',
    // A Uint8Array body makes the browser set `Content-Length` itself — the
    // header the hub checks before it buffers anything.
    // guard-ignore lint/type-safety/casting: the Fetch `BodyInit` union models `BufferSource` separately from `Uint8Array<ArrayBufferLike>`; the value is a valid byte body at runtime — this is the DOM boundary the cast exists for.
    body: payload as unknown as BodyInit,
  });

  if (!uploadResponse.ok) {
    return refusal(uploadResponse);
  }

  const result = (await uploadResponse.json()) as {
    slug: string;
    revision: number;
    sha256: string;
    moderationState: 'pending';
    deliveryUrl: string;
  };

  return {
    published: true,
    slug: result.slug,
    revision: result.revision,
    sha256: result.sha256,
    moderationState: 'pending',
    deliveryUrl: result.deliveryUrl,
  };
};
