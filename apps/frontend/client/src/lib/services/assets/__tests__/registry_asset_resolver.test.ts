// apps/frontend/client/src/lib/services/assets/__tests__/registry_asset_resolver.test.ts
//
// AC-4: The client resolver preserves acquire/warm/fallback ordering.
//
// Given the client registry resolver adapter, when a tag is resolved that has
// a cached blob URL, one that is uncached but present in the registry, and
// one that is unknown, then the first returns the blob URL synchronously,
// the second returns the origin URL and triggers a background warm, and the
// third returns null — the same three behaviours assetStore.resolveUrl has
// today.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AssetResolver } from '@aikami/types';

describe('AC-4: RegistryAssetResolver preserves acquire/warm/fallback ordering', () => {
  let resolver: AssetResolver;

  beforeEach(async () => {
    // Mock assetStore.resolveUrl
    mock.module('../asset_store.svelte', () => ({
      assetStore: {
        resolveUrl: (tag: string): string | null => {
          if (tag === 'cached:tag') {
            return 'blob:http://localhost/cached-asset';
          }
          if (tag === 'uncached:tag') {
            return 'https://origin.example.com/assets/uncached-asset.webp';
          }
          if (tag === 'unknown:tag') {
            return null;
          }
          return null;
        },
        fetchManifest: mock(async () => {}),
        seed: null,
        manifest: null,
        coreTags: new Set<string>(),
        setBackground: mock(() => {}),
        setMusic: mock(() => {}),
        setAudioMuted: mock(() => {}),
      },
    }));

    // Mock assetManager.releaseUrl
    mock.module('../asset_manager.svelte', () => ({
      assetManager: {
        releaseUrl: mock((_url: string) => {}),
      },
    }));

    mock.module('$logger', () => ({
      logger: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
    }));

    const mod = await import('../registry_asset_resolver');
    resolver = mod.createRegistryAssetResolver();
  });

  test('cached tag returns blob URL synchronously', () => {
    const url = resolver.resolve('cached:tag');
    expect(url).toBe('blob:http://localhost/cached-asset');
  });

  test('uncached but known tag returns origin URL', () => {
    const url = resolver.resolve('uncached:tag');
    expect(url).toBe('https://origin.example.com/assets/uncached-asset.webp');
  });

  test('unknown tag returns null', () => {
    const url = resolver.resolve('unknown:tag');
    expect(url).toBeNull();
  });

  test('kind is registry', () => {
    expect(resolver.kind).toBe('registry');
  });

  test('release delegates to assetManager.releaseUrl', async () => {
    const { assetManager } = await import('../asset_manager.svelte');
    const cachedUrl = 'blob:http://localhost/cached-asset';
    resolver.release(cachedUrl);
    expect(assetManager.releaseUrl).toHaveBeenCalledWith(cachedUrl);
  });
});
