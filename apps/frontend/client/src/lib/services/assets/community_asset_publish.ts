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
import type {
  CommunityAssetProvenanceProjection,
  ReserveAssetRequest,
  RightsDecision,
} from '@aikami/types';
import type { CommunityHubTransport } from './community_asset_import.ts';

/** The transport plus the hub base every publish call targets. */
export type CommunityPublishDeps = CommunityHubTransport;

/** What the user asked to publish. */
export type CommunityPublishRequest = {
  /** Resolver tag (must match the AssetRef tag shape). */
  tag: string;
  /** The asset's registry category (a CatalogCategory). */
  category: string;
  title: string;
  /** Extension including the dot, lowercase. */
  ext: string;
  /** Redacted provenance projection — never prompts or local paths. */
  provenance: CommunityAssetProvenanceProjection;
  /** C-518's scoped rights record. Absent ⇒ the hub fails closed. */
  rights?: RightsDecision;
  /** Optional explicit slug; the hub derives one from the title otherwise. */
  slug?: string;
};

/** The publish outcome the UI renders. */
export type CommunityPublishOutcome =
  | {
      published: true;
      slug: string;
      revision: number;
      sha256: string;
      moderationState: 'pending';
      deliveryUrl: string;
    }
  | {
      published: false;
      reason: string;
      /** Scopes the rights gate found unmet, when the refusal was scope-related. */
      missing?: readonly string[];
      message?: string;
    };

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
 * The bytes are the source of truth for the declared size: the request's
 * `sizeBytes` comes from the byte length here, so the hub's
 * `declared == Content-Length` check can only fail when the transport mangles
 * the body.
 */
export const publishCommunityAsset = async (
  deps: CommunityPublishDeps,
  request: CommunityPublishRequest,
  bytes: Uint8Array,
): Promise<CommunityPublishOutcome> => {
  if (bytes.byteLength === 0) {
    return { published: false, reason: 'empty_asset' };
  }
  if (bytes.byteLength > MAX_UPLOAD_SIZE) {
    return { published: false, reason: 'asset_too_large' };
  }

  const reserveBody: ReserveAssetRequest = {
    category: request.category as ReserveAssetRequest['category'],
    tag: request.tag,
    title: request.title,
    ext: request.ext,
    sizeBytes: bytes.byteLength,
    provenance: request.provenance,
    ...(request.rights === undefined ? {} : { rights: request.rights }),
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
    body: bytes as unknown as BodyInit,
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
