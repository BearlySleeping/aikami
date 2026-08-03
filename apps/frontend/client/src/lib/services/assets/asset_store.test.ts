// apps/frontend/client/src/lib/services/assets/asset_store.test.ts
// biome-ignore-all lint/style/useNamingConvention: mock properties mirror external API / enum names
//
// Unit tests for AssetStore tag → static URL resolution (C-243 contract).
// Extended for C-372: LPC tags resolve to canonical /game-data/ static URLs
// with no /src/lib/assets/ segment and no Firebase Storage origin; unknown
// tags resolve to null.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/services/assets/asset_store.test.ts

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { AssetManifest } from '@aikami/types';

// $logger resolves to the SvelteKit sink which pulls $env at import time —
// mock it so the store loads cleanly in Bun.
mock.module('$logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

import { LpcAnimationState } from '$lib/data/lpc_models';
import { lpcTag } from '$lib/data/lpc_tags';
import { assetStore } from './asset_store.svelte';

// ── Fixtures ──────────────────────────────────────────────────────────────

const LPC_MANIFEST: AssetManifest = {
  scannedAt: '2026-08-02T00:00:00.000Z',
  count: 3,
  assets: {
    'lpc:torso:aprons:apron_female:walk': {
      tag: 'lpc:torso:aprons:apron_female:walk',
      category: 'lpc',
      subcategory: 'torso/aprons',
      name: 'apron_female.walk',
      path: 'lpc/torso/aprons/apron_female.walk.webp',
      ext: '.webp',
    },
    'lpc:body:bodies_male:walk': {
      tag: 'lpc:body:bodies_male:walk',
      category: 'lpc',
      subcategory: 'body',
      name: 'bodies_male.walk',
      path: 'lpc/body/bodies_male.walk.webp',
      ext: '.webp',
    },
    'music:exploration:Chainsmoker': {
      tag: 'music:exploration:Chainsmoker',
      category: 'music',
      subcategory: 'exploration',
      name: 'Chainsmoker',
      path: 'music/exploration/Chainsmoker.mp3',
      ext: '.mp3',
    },
  },
  byCategory: {
    music: [],
    sfx: [],
    ambient: [],
    sprites: [],
    backgrounds: [],
    lpc: [
      {
        tag: 'lpc:torso:aprons:apron_female:walk',
        category: 'lpc',
        subcategory: 'torso/aprons',
        name: 'apron_female.walk',
        path: 'lpc/torso/aprons/apron_female.walk.webp',
        ext: '.webp',
      },
      {
        tag: 'lpc:body:bodies_male:walk',
        category: 'lpc',
        subcategory: 'body',
        name: 'bodies_male.walk',
        path: 'lpc/body/bodies_male.walk.webp',
        ext: '.webp',
      },
    ],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('assetStore.resolveUrl — LPC tags (C-372)', () => {
  beforeEach(() => {
    assetStore.manifest = LPC_MANIFEST;
  });

  it('resolves an LPC tag to a canonical /game-data/ static URL', () => {
    const tag = lpcTag('torso/aprons/apron_female', LpcAnimationState.Walk);
    expect(tag).toBe('lpc:torso:aprons:apron_female:walk');

    const url = assetStore.resolveUrl(tag);
    expect(url).toBe('/game-data/lpc/torso/aprons/apron_female.walk.webp');
  });

  it('maps deep sub-slot assetIds (slash form) to colon tags', () => {
    const tag = lpcTag('hair/bangslong2/bg_adult', LpcAnimationState.Shoot);
    expect(tag).toBe('lpc:hair:bangslong2:bg_adult:shoot');
  });

  it('never returns a /src/lib/assets/ segment or Firebase Storage origin', () => {
    const url = assetStore.resolveUrl(lpcTag('body/bodies_male', LpcAnimationState.Walk));
    expect(url).toBe('/game-data/lpc/body/bodies_male.walk.webp');
    expect(url).not.toContain('/src/lib/assets/');
    expect(url).not.toContain('firebasestorage');
    expect(url).not.toContain('localhost:9198');
  });

  it('returns null for an unmapped tag', () => {
    expect(assetStore.resolveUrl(lpcTag('body/tail/cat_adult', LpcAnimationState.Walk))).toBeNull();
  });

  it('returns null when the manifest is not loaded', () => {
    assetStore.manifest = null;
    expect(assetStore.resolveUrl(lpcTag('body/bodies_male', LpcAnimationState.Walk))).toBeNull();
  });

  it('still resolves non-LPC tags through the same resolver', () => {
    expect(assetStore.resolveUrl('music:exploration:Chainsmoker')).toBe(
      '/game-data/music/exploration/Chainsmoker.mp3',
    );
  });
});
