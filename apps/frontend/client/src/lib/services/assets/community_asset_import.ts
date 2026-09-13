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

import type { CatalogCategory, CommunityAssetSummary } from '@aikami/types';
import type {
  CommunityAssetImportDeps,
  CommunityBrowsePage,
  CommunityHubTransport,
  CommunityImportOutcome,
} from '$types';

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

  // C-513 AC-10: already on this device ⇒ never fetched. Re-importing a cached
  // revision is a bookkeeping no-op, and — more importantly — the resolution
  // path after an offline reload must not depend on the hub being reachable.
  const insertedCacheEntry = !(await deps.cache.has(asset.sha256));
  if (insertedCacheEntry) {
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
    const blob = new Blob([bytes], { type: mimeForExt(asset.ext) });
    await deps.cache.put({ hash: asset.sha256, blob });
  }

  let result: Awaited<ReturnType<CommunityAssetImportDeps['register']>>;
  try {
    result = await deps.register({
      tag: asset.tag,
      hash: asset.sha256,
      sizeBytes: asset.sizeBytes,
      category: asset.category,
      url: asset.deliveryUrl,
      provenanceSource: asset.provenance.source,
      ...(asset.license === undefined ? {} : { license: asset.license }),
      ...(options.collision === undefined ? {} : { collision: options.collision }),
    });
  } catch (error) {
    if (insertedCacheEntry) {
      const committed = await deps.hasRegistryReference(asset.sha256).catch(() => true);
      if (!committed) {
        await deps.cache.remove(asset.sha256).catch(() => undefined);
      }
    }
    throw error;
  }

  if (!result.imported) {
    if (insertedCacheEntry) {
      await deps.cache.remove(asset.sha256).catch(() => undefined);
    }
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
