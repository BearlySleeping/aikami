// apps/frontend/client/src/lib/data/__tests__/no_global_resolver.test.ts
//
// AC-1: No module-level resolver state remains.
//
// Verifies that the module-level mutable resolver and manifest state have been
// removed from the codebase. This is a compile-time check — if the deleted
// symbols are still referenced, the build fails.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

describe('AC-1: No module-level resolver state remains', () => {
  beforeEach(async () => {
    // Mock dependencies that lpc_renderer.ts and lpc_asset_catalog.ts import
    mock.module('@aikami/frontend/engine/content', () => ({
      resolveLpcSheetGeometry: (sheet: { width: number; height: number }) => ({
        pitch: 64,
        columns: Math.floor(sheet.width / 64),
        rows: Math.floor(sheet.height / 64),
        scale: 1,
        anchorOffset: { x: -32, y: -32 },
      }),
    }));

    mock.module('$lib/services/assets/asset_store.svelte', () => ({
      assetStore: {
        resolveUrl: () => null,
        seed: null,
        manifest: null,
        coreTags: new Set<string>(),
        fetchManifest: mock(async () => {}),
        setBackground: mock(() => {}),
        setMusic: mock(() => {}),
        setAudioMuted: mock(() => {}),
      },
    }));

    mock.module('$logger', () => ({
      logger: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
    }));
  });

  test('lpc_renderer exports createLpcRenderer instead of setLpcUrlResolver', async () => {
    const mod = await import('../lpc_renderer');
    // The new API
    expect(typeof mod.createLpcRenderer).toBe('function');
    // The old API must not exist
    const modRecord = mod as unknown as Record<string, unknown>;
    expect(modRecord.setLpcUrlResolver).toBeUndefined();
    expect(modRecord.setLpcManifestReady).toBeUndefined();
    expect(modRecord.clearLpcCaches).toBeUndefined();
  });

  test('lpc_asset_catalog no longer exports wireLpcUrlResolver or getLpcAssetPath', async () => {
    const mod = await import('../lpc_asset_catalog');
    // The old wiring functions must not exist
    const modRecord = mod as unknown as Record<string, unknown>;
    expect(modRecord.wireLpcUrlResolver).toBeUndefined();
    expect(modRecord.getLpcAssetPath).toBeUndefined();
  });

  test('createLpcRenderer returns an object with the expected shape', async () => {
    const lpcMod = await import('../lpc_renderer');
    const fixtureResolver = {
      resolve: (tag: string) => `https://example.com/${tag}`,
      release: () => {},
      kind: 'fixture' as const,
    };
    const renderer = lpcMod.createLpcRenderer({ resolver: fixtureResolver });
    expect(renderer).toBeDefined();
    expect(typeof renderer.loadSheet).toBe('function');
    expect(typeof renderer.extractFrame).toBe('function');
    expect(typeof renderer.getFrameTexture).toBe('function');
    expect(typeof renderer.createSprite).toBe('function');
    expect(typeof renderer.clearCaches).toBe('function');
    expect(renderer.resolver).toBe(fixtureResolver);
  });
});
