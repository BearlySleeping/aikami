// apps/frontend/client/src/lib/services/assets/community_asset_operations.ts
//
// C-513 — the community publish/browse/import and local-library operations the
// AssetManager exposes.
//
// Extracted from `asset_manager.svelte.ts` so the resolver keeps its focus (and
// its file budget). Every function takes the registry and cache backend it
// operates on explicitly, so nothing here reaches for module state and the
// caller stays the single owner of those handles.
//
// Contract: C-513 End-User Asset Publishing and Community Sharing

import { COMMUNITY_ASSET_PACK_ID, GENERATED_ASSET_PACK_ID } from '@aikami/constants';
import type { AssetRegistryRepository } from '@aikami/frontend/storage';
import { extForMimeType } from '@aikami/local-ai';
import type { CommunityAssetSummary } from '@aikami/types';
import type {
  CommunityImportOutcome,
  CommunityLibraryEntry,
  CommunityPublishOutcome,
  CommunityPublishRequest,
} from '$types';
import { hubApiBase, hubAuthHeaders } from '../api/hub_api_client.ts';
import { sha256Hex } from './asset_hasher.ts';
import type { AssetCacheBackend } from './cache_backend.ts';
import { importCommunityAsset, listCommunityAssets } from './community_asset_import.ts';
import { publishCommunityAsset } from './community_asset_publish.ts';

/** The registry + cache a community or local-library operation reads. */
type CommunityAssetOperationContext = {
  registry: AssetRegistryRepository | null;
  backend: AssetCacheBackend | null;
};

/**
 * The hub transport every community call shares.
 *
 * `credentials: 'include'` is what carries the session to the hub, and the
 * headers are resolved per call so a refreshed session is picked up.
 */
const hubTransport = (): {
  hubBaseUrl: string;
  authHeaders: () => Record<string, string>;
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
} => ({
  hubBaseUrl: hubApiBase(),
  authHeaders: () => hubAuthHeaders(),
  fetchImpl: (input, init) => fetch(input, { ...init, credentials: 'include' }),
});

/**
 * Reads a registry asset's cached bytes.
 *
 * Returns undefined when the tag is unknown or its bytes are not cached —
 * publishing is an explicit online action and never fetches on this path.
 */
export const exportRegisteredBytes = async (
  context: CommunityAssetOperationContext,
  tag: string,
): Promise<Uint8Array | undefined> => {
  const { registry, backend } = context;
  if (!registry || !backend) {
    return undefined;
  }
  const record = await registry.findById(tag);
  if (!record) {
    return undefined;
  }
  const blob = await backend.get(record.hash);
  if (!blob) {
    return undefined;
  }
  return new Uint8Array(await blob.arrayBuffer());
};

/** Downloads, verifies and imports one approved community asset (AC-4/AC-10). */
export const importCommunityAssetIntoRegistry = async (
  context: CommunityAssetOperationContext,
  asset: CommunityAssetSummary,
  options: { collision?: 'version' } = {},
): Promise<CommunityImportOutcome> => {
  const { registry, backend } = context;
  if (!registry || !backend) {
    return { imported: false, tag: asset.tag, reason: 'not_initialized' };
  }
  return importCommunityAsset(
    {
      ...hubTransport(),
      hashBytes: (bytes) =>
        // guard-ignore lint/type-safety/casting: TS models `Uint8Array<ArrayBufferLike>` separately from the `BufferSource` BlobPart accepts, but the value is a valid byte view at runtime — this is the DOM boundary the cast is for.
        sha256Hex(new Blob([bytes as unknown as BlobPart])),
      cache: {
        has: (hash) => backend.has(hash),
        put: async ({ hash, blob }) => {
          await backend.put({ hash, blob });
        },
        remove: (hash) => backend.remove(hash),
      },
      register: (registration) => registry.registerCommunity(registration),
      hasRegistryReference: (hash) =>
        registry.findIdsByHashes([hash]).then((assetIds) => assetIds.length > 0),
    },
    asset,
    options,
  );
};

/** Publishes a local asset's cached bytes to the community namespace (AC-1). */
export const publishRegisteredBytes = async (
  context: CommunityAssetOperationContext,
  tag: string,
  request: Omit<CommunityPublishRequest, 'tag' | 'category' | 'ext'>,
): Promise<CommunityPublishOutcome> => {
  const { registry, backend } = context;
  if (!registry) {
    return { published: false, reason: 'not_initialized' };
  }
  const record = await registry.findById(tag);
  if (!record) {
    return { published: false, reason: 'unknown_tag' };
  }
  const blob = backend ? await backend.get(record.hash) : undefined;
  if (!blob) {
    return { published: false, reason: 'bytes_not_cached' };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // The registry stores no extension, so it comes from the bytes' MIME type
  // (the same derivation the generated-asset seam uses).
  const ext = extForMimeType(blob.type) ?? '.bin';
  return publishCommunityAsset(
    hubTransport(),
    { ...request, tag, category: record.category, ext },
    bytes,
  );
};

/** Lists approved community assets from the hub (AC-4). */
export const listApprovedCommunityAssets = (
  options: { category?: CommunityAssetSummary['category']; cursor?: string } = {},
): Promise<{ items: readonly CommunityAssetSummary[]; nextCursor?: string }> =>
  listCommunityAssets(hubTransport(), options);

/**
 * Lists the tags this device owns in one manifest category (AC-10).
 *
 * Covers assets the boot-seed manifest cannot know about — community imports
 * and locally generated audio — so a runtime resolver can serve them from the
 * on-device cache after a reload with no network.
 */
export const listLocalTagsByCategory = async (
  context: CommunityAssetOperationContext,
  category: string,
): Promise<readonly string[]> => {
  const { registry } = context;
  if (!registry) {
    return [];
  }
  const localRecords = (
    await Promise.all([
      registry.listByPack(COMMUNITY_ASSET_PACK_ID),
      registry.listByPack(GENERATED_ASSET_PACK_ID),
    ])
  ).flat();
  return localRecords
    .filter((record) => record.category === category)
    .map((record) => record.id)
    .sort((left, right) => left.localeCompare(right));
};

/** Lists the community assets this device has already imported (AC-10). */
export const listImportedCommunityAssets = async (
  context: CommunityAssetOperationContext,
): Promise<readonly CommunityLibraryEntry[]> => {
  const { registry } = context;
  if (!registry) {
    return [];
  }
  const records = await registry.listByPack(COMMUNITY_ASSET_PACK_ID);
  return records.map((record) => ({
    tag: record.id,
    category: record.category,
    ...(record.license ? { license: record.license } : {}),
    ...(record.attribution ? { attribution: record.attribution } : {}),
  }));
};
