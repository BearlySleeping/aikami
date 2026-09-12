// apps/frontend/client/src/lib/services/assets/asset_cache_eviction.test.ts

import { describe, expect, test } from 'bun:test';
import type { AssetRegistryRepository } from '@aikami/frontend/storage';
import type { InstallStateRecord } from '@aikami/types';
import { evictLruCachedAsset } from './asset_cache_eviction.ts';
import type { AssetCacheBackend } from './cache_backend.ts';

describe('evictLruCachedAsset', () => {
  test('marks every shared-hash reference stale before removing the bytes', async () => {
    const hash = 'a'.repeat(64);
    const states = new Map<string, InstallStateRecord>([
      [
        'portraits:first',
        {
          assetId: 'portraits:first',
          status: 'cached',
          cachedHash: hash,
          downloadedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      [
        'portraits:second',
        {
          assetId: 'portraits:second',
          status: 'cached',
          cachedHash: hash,
          downloadedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    ]);
    const events: string[] = [];
    const registry = {
      listCachedWithPack: async () =>
        [...states.values()].map((state) => ({
          assetId: state.assetId,
          packId: 'portraits',
          cachedHash: state.cachedHash,
          downloadedAt: state.downloadedAt,
        })),
      setInstallState: async (state: InstallStateRecord) => {
        events.push(`stale:${state.assetId}`);
        states.set(state.assetId, state);
      },
    } as AssetRegistryRepository;
    const backend = {
      remove: async (removedHash: string) => {
        events.push(`remove:${removedHash}`);
      },
    } as AssetCacheBackend;

    expect(await evictLruCachedAsset({ registry, backend, warn: () => undefined })).toBe(true);
    expect(states.get('portraits:first')?.status).toBe('stale');
    expect(states.get('portraits:second')?.status).toBe('stale');
    expect(events.at(-1)).toBe(`remove:${hash}`);
  });
});
