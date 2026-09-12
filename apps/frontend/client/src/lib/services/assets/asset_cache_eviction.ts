// apps/frontend/client/src/lib/services/assets/asset_cache_eviction.ts
//
// C-373 quota-pressure eviction: frees cache space by dropping the
// least-recently-downloaded non-core cached asset.
//
// Extracted from AssetManager so the manager stays focused on the resolve
// pipeline and the eviction policy is readable (and testable) on its own.
//
// Contract: C-373 AC-3

import { OFFLINE_CORE_PACK_ID } from '@aikami/constants';
import type { AssetRegistryRepository } from '@aikami/frontend/storage';
import type { AssetCacheBackend } from './cache_backend.ts';

/**
 * Packs that are never LRU-evicted under quota pressure (C-435).
 *
 * Exactly one: the offline core. `seedFromCompactSeed` packs every tag in the
 * offline-core declaration as {@link OFFLINE_CORE_PACK_ID} and everything else
 * by category, so the guard is a single pack id rather than a category list.
 * Listing categories here would protect all 12,699 LPC assets and defeat LRU
 * entirely — the opposite of what the contract asks for.
 */
const EVICTION_PROTECTED_PACKS: ReadonlySet<string> = new Set<string>([OFFLINE_CORE_PACK_ID]);

/** Options for {@link evictLruCachedAsset}. */
type EvictLruOptions = {
  registry: AssetRegistryRepository;
  backend: AssetCacheBackend;
  /** Packs that must never be evicted. Defaults to {@link EVICTION_PROTECTED_PACKS}. */
  protectedPacks?: ReadonlySet<string>;
  /** Warning sink (the AssetManager's own logger, so log context stays consistent). */
  warn(message: string, context: Record<string, unknown>): void;
};

/**
 * Evicts the least-recently-downloaded non-core cached asset to free quota.
 *
 * @returns True when an entry was evicted (the caller may retry its `put`).
 */
export const evictLruCachedAsset = async (options: EvictLruOptions): Promise<boolean> => {
  const { registry, backend, warn } = options;
  const protectedPacks = options.protectedPacks ?? EVICTION_PROTECTED_PACKS;

  const cached = await registry.listCachedWithPack();
  const evictable = cached
    .filter((entry) => entry.packId && !protectedPacks.has(entry.packId))
    .sort((a, b) => (a.downloadedAt ?? '').localeCompare(b.downloadedAt ?? ''));

  const victim = evictable[0];
  if (!victim?.cachedHash) {
    warn('asset_manager:quota:no-evictable-packs', {
      message: 'All cached packs are core — leaving the asset not_downloaded.',
    });
    return false;
  }

  await backend.remove(victim.cachedHash);
  await registry.setInstallState({
    assetId: victim.assetId,
    status: 'stale',
    cachedHash: victim.cachedHash,
    downloadedAt: victim.downloadedAt,
  });
  warn('asset_manager:quota:lru-evicted', {
    assetId: victim.assetId,
    packId: victim.packId,
    hash: victim.cachedHash,
  });
  return true;
};

/** Detects QuotaExceededError across environments. */
export const isQuotaExceededError = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    return error.name === 'QuotaExceededError';
  }
  return (error as Error | undefined)?.name === 'QuotaExceededError';
};
