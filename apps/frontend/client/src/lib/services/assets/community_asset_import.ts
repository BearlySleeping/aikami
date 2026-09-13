// apps/frontend/client/src/lib/services/assets/community_asset_import.ts
//
// C-513 AC-4 / AC-10 / AC-11 — the community browse + import path.
//
// Browsing reads the hub's public community listing; importing downloads the
// promoted, content-addressed bytes, verifies the hash the hub advertises, and
// writes them into the local cache + registry as an `r2` source. After that the
// import resolves offline through the ordinary registry/cache path — no new
// resolution route, no network on reload.
//
// Transport is injected (`fetch` + base URL + auth headers) rather than imported
// so the module stays testable and a view model never touches the transport.
//
// Contract: C-513 AC-4 / AC-10 / AC-11

import type {
  CommunityAssetImportResult,
  CommunityAssetRegistration,
} from '@aikami/frontend/storage';
import type { CatalogCategory, CommunityAssetSummary } from '@aikami/types';

/** The hub transport the browse and import paths both need. */
export type CommunityHubTransport = {
  /** The hub API base (mode-aware), e.g. `https://hub.bearlysleeping.com/api`. */
  hubBaseUrl: string;
  /** Session/bearer headers for the owner-scoped calls (never for browse). */
  authHeaders: () => Record<string, string>;
  /** `fetch` (injected so tests can stub the hub). */
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

/** The seams the *import* path additionally needs. */
export type CommunityAssetImportDeps = CommunityHubTransport & {
  /** Content-hash verification, identical to the generated-asset path. */
  hashBytes: (bytes: Uint8Array) => Promise<string>;
  /** The shared content-hash cache. */
  cache: {
    has(hash: string): Promise<boolean>;
    put(options: { hash: string; blob: Blob }): Promise<void>;
  };
  /**
   * Writes the registry row. Injected as a callback rather than a database
   * handle so this module never touches the local DB directly — the asset
   * manager owns that seam (`AssetRegistryRepository.registerCommunity`).
   */
  register(asset: CommunityAssetRegistration): Promise<CommunityAssetImportResult>;
  /** Debug logger. */
  debug?: (message: string, context: Record<string, unknown>) => void;
};

/** One page of the hub's public community listing. */
export type CommunityBrowsePage = {
  items: readonly CommunityAssetSummary[];
  nextCursor?: string;
};

/** Outcome of importing one community asset. */
export type CommunityImportOutcome =
  | { imported: true; tag: string; sha256: string; unchanged: boolean }
  | {
      imported: false;
      tag: string;
      reason: string;
      collision?: CommunityAssetImportResult['collision'];
    };

/** Builds an absolute hub URL for a hub-relative path. */
const hubUrl = (deps: CommunityHubTransport, path: string): string =>
  `${deps.hubBaseUrl.replace(/\/$/, '')}${path}`;

/**
 * Lists approved, promoted community assets.
 *
 * Public and session-free — a signed-out player can browse.
 */
export const listCommunityAssets = async (
  deps: CommunityHubTransport,
  options: { category?: CatalogCategory; limit?: number; cursor?: string } = {},
): Promise<CommunityBrowsePage> => {
  const params = new URLSearchParams();
  if (options.category !== undefined) {
    params.set('category', options.category);
  }
  params.set('limit', String(options.limit ?? 24));
  if (options.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }

  const response = await deps.fetchImpl(hubUrl(deps, `/assets/community?${params.toString()}`), {
    method: 'GET',
  });
  if (!response.ok) {
    throw new Error(`Community browse failed (HTTP ${response.status})`);
  }
  const body = (await response.json()) as CommunityBrowsePage;
  return { items: body.items ?? [], ...(body.nextCursor ? { nextCursor: body.nextCursor } : {}) };
};

/** Lists the signed-in owner's own submissions, in every moderation state. */
export const listMyCommunityAssets = async (
  deps: CommunityHubTransport,
  options: { limit?: number; cursor?: string } = {},
): Promise<CommunityBrowsePage> => {
  const params = new URLSearchParams({ mine: '1', limit: String(options.limit ?? 24) });
  if (options.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  const response = await deps.fetchImpl(hubUrl(deps, `/assets/community?${params.toString()}`), {
    method: 'GET',
    headers: { ...deps.authHeaders() },
  });
  if (!response.ok) {
    throw new Error(`Community submissions failed (HTTP ${response.status})`);
  }
  const body = (await response.json()) as CommunityBrowsePage;
  return { items: body.items ?? [], ...(body.nextCursor ? { nextCursor: body.nextCursor } : {}) };
};

/**
 * Downloads and imports one approved community asset.
 *
 * Nothing is written until the bytes verify against the advertised hash; a
 * registry collision is returned for an explicit decision (AC-11) — pass
 * `options.collision = 'version'` to accept it.
 */
export const importCommunityAsset = async (
  deps: CommunityAssetImportDeps,
  asset: CommunityAssetSummary,
  options: { collision?: 'version' } = {},
): Promise<CommunityImportOutcome> => {
  if (!asset.promoted || asset.deliveryUrl === undefined) {
    return { imported: false, tag: asset.tag, reason: 'not_promoted' };
  }

  const response = await deps.fetchImpl(asset.deliveryUrl, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Community download failed (HTTP ${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== asset.sizeBytes) {
    return { imported: false, tag: asset.tag, reason: 'size_mismatch' };
  }

  const actualHash = await deps.hashBytes(bytes);
  if (actualHash !== asset.sha256) {
    return { imported: false, tag: asset.tag, reason: 'hash_mismatch' };
  }

  // Cache before the registry row, so a resolvable tag never points at missing
  // bytes. The cache backend re-verifies the hash on put.
  if (!(await deps.cache.has(asset.sha256))) {
    const blob = new Blob([bytes], { type: mimeForExt(asset.ext) });
    await deps.cache.put({ hash: asset.sha256, blob });
  }

  const result = await deps.register({
    tag: asset.tag,
    hash: asset.sha256,
    sizeBytes: asset.sizeBytes,
    category: asset.category,
    url: asset.deliveryUrl,
    provenanceSource: asset.provenance.source,
    ...(asset.license === undefined ? {} : { license: asset.license }),
    ...(options.collision === undefined ? {} : { collision: options.collision }),
  });

  if (!result.imported) {
    return {
      imported: false,
      tag: asset.tag,
      reason: result.reason ?? 'collision',
      ...(result.collision === undefined ? {} : { collision: result.collision }),
    };
  }

  deps.debug?.('community_asset_import:imported', {
    tag: asset.tag,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    unchanged: result.unchanged === true,
  });

  return {
    imported: true,
    tag: result.tag,
    sha256: result.hash,
    unchanged: result.unchanged === true,
  };
};

/** Minimal extension → MIME map for the cached blob (registry stores the ext). */
const mimeForExt = (ext: string): string => {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ogg':
      return 'audio/ogg';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    default:
      return 'application/octet-stream';
  }
};
