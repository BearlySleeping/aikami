// apps/frontend/client/src/lib/services/expression/expression_asset_resolver.test.ts
import { describe, expect, mock, test } from 'bun:test';

const CATALOG_BASE_URL = 'https://catalog.example';

mock.module('@aikami/frontend/configs', () => ({
  // biome-ignore lint/style/useNamingConvention: environment variable names are uppercase
  publicEnv: { PUBLIC_ASSETS_BASE_URL: CATALOG_BASE_URL },
}));

import {
  type ExpressionAssetEntry,
  ExpressionAssetResolver,
  type ExpressionAssetResolverInterface,
} from './expression_asset_resolver.ts';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_MANIFEST: ExpressionAssetEntry[] = [
  { npcId: 'blacksmith', emotion: 'joy', imagePath: '/images/npc/blacksmith/joy.webp' },
  { npcId: 'blacksmith', emotion: 'anger', imagePath: '/images/npc/blacksmith/anger.webp' },
  { npcId: 'innkeeper', emotion: 'joy', imagePath: '/assets/expressions/innkeeper_joy.png' },
  {
    npcId: 'innkeeper',
    emotion: 'surprise',
    imagePath: '/assets/expressions/innkeeper_surprise.png',
  },
];

// ---------------------------------------------------------------------------
// AC3: Pre-generated Asset Fast-Path
// ---------------------------------------------------------------------------

describe('ExpressionAssetResolver — AC3: Pre-generated Asset Fast-Path', () => {
  let resolver: ExpressionAssetResolverInterface;

  test('should resolve asset from manifest for known NPC + emotion', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: SAMPLE_MANIFEST,
      basePath: undefined,
    });

    const result = resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' });
    expect(result).toBe('/images/npc/blacksmith/joy.webp');
  });

  test('should resolve a different emotion for same NPC from manifest', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: SAMPLE_MANIFEST,
      basePath: undefined,
    });

    const result = resolver.resolve({ npcId: 'blacksmith', emotion: 'anger' });
    expect(result).toBe('/images/npc/blacksmith/anger.webp');
  });

  test('should resolve asset for different NPC from manifest', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: SAMPLE_MANIFEST,
      basePath: undefined,
    });

    const result = resolver.resolve({ npcId: 'innkeeper', emotion: 'surprise' });
    expect(result).toBe('/assets/expressions/innkeeper_surprise.png');
  });

  test('should return undefined for known NPC with unknown emotion (manifest only)', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: SAMPLE_MANIFEST,
      basePath: undefined,
    });

    const result = resolver.resolve({ npcId: 'blacksmith', emotion: 'sadness' });
    expect(result).toBeUndefined();
  });

  test('should return undefined for unknown NPC (manifest only)', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: SAMPLE_MANIFEST,
      basePath: undefined,
    });

    const result = resolver.resolve({ npcId: 'unknown-npc', emotion: 'joy' });
    expect(result).toBeUndefined();
  });

  test('should return undefined for empty manifest', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: [],
      basePath: undefined,
    });

    const result = resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' });
    expect(result).toBeUndefined();
  });

  test('should resolve via predictable path when no manifest provided', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
    });

    const result = resolver.resolve({ npcId: 'any-npc', emotion: 'joy' });
    expect(result).toBe('/images/npc/any-npc/joy.webp');
  });
});

// ---------------------------------------------------------------------------
// Predictable path resolution
// ---------------------------------------------------------------------------

describe('ExpressionAssetResolver — predictable path resolution', () => {
  test('should construct path from base path when no manifest match', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: [],
      basePath: '/images/npc',
    });

    const result = resolver.resolve({ npcId: 'guard', emotion: 'fear' });
    expect(result).toBe('/images/npc/guard/fear.webp');
  });

  test('should use default basePath when not specified', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
    });

    const result = resolver.resolve({ npcId: 'wizard', emotion: 'blush' });
    expect(result).toBe('/images/npc/wizard/blush.webp');
  });

  test('should prefer manifest over predictable path', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: [{ npcId: 'bard', emotion: 'joy', imagePath: '/custom/bard-joy.png' }],
      basePath: '/images/npc',
    });

    // Manifest hit should return manifest path, NOT the predictable path
    const result = resolver.resolve({ npcId: 'bard', emotion: 'joy' });
    expect(result).toBe('/custom/bard-joy.png');
  });

  test('should fall back to predictable path when manifest has no match', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: [{ npcId: 'bard', emotion: 'joy', imagePath: '/custom/bard-joy.png' }],
      basePath: '/images/npc',
    });

    // Not in manifest — should fall back to predictable path
    const result = resolver.resolve({ npcId: 'bard', emotion: 'sadness' });
    expect(result).toBe('/images/npc/bard/sadness.webp');
  });

  test('should return undefined when basePath is disabled and no manifest match', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: [],
      basePath: undefined,
    });

    const result = resolver.resolve({ npcId: 'any-npc', emotion: 'joy' });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LPC overlay resolution
// ---------------------------------------------------------------------------

describe('ExpressionAssetResolver — LPC overlay resolution', () => {
  let resolver: ExpressionAssetResolverInterface;

  test('should resolve LPC overlays for a known expression', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
    });

    const overlays = resolver.resolveLpcOverlays('angry');
    expect(typeof overlays).toBe('object');
    expect(overlays.eyes).toBeString();
    expect(overlays.eyebrows).toBeString();
    expect(overlays.mouth).toBeString();
  });

  test('should return empty object for neutral (no overlays)', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
    });

    const overlays = resolver.resolveLpcOverlays('neutral');
    expect(overlays.eyes).toBeUndefined();
    expect(overlays.eyebrows).toBeUndefined();
    expect(overlays.mouth).toBeUndefined();
  });

  test('should return empty object for unknown expression ID', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
    });

    const overlays = resolver.resolveLpcOverlays('nonexistent' as unknown as 'neutral');
    expect(typeof overlays).toBe('object');
    expect(Object.keys(overlays).length).toBe(0);
  });

  test('should return partial overlays for expressions with missing assets', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
    });

    // disgusted only has mouth overlay
    const overlays = resolver.resolveLpcOverlays('disgusted');
    expect(overlays.mouth).toBeString();
    expect(overlays.eyes).toBeUndefined();
    expect(overlays.eyebrows).toBeUndefined();
  });

  test('should resolve overlays for all 19 expression IDs', () => {
    resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
    });

    const allIds = [
      'neutral',
      'happy',
      'sad',
      'angry',
      'surprised',
      'fearful',
      'disgusted',
      'amused',
      'annoyed',
      'blushing',
      'confused',
      'determined',
      'flirty',
      'innocent',
      'mischievous',
      'pained',
      'relieved',
      'sleepy',
      'thoughtful',
    ];

    for (const id of allIds) {
      const overlays = resolver.resolveLpcOverlays(id);
      expect(typeof overlays).toBe('object');
    }
  });
});

// ---------------------------------------------------------------------------
// C-510 AC-5: expressions resolve through the registry
// ---------------------------------------------------------------------------

/** A registry seam double: loaded/unloaded, with a tag → URL map. */
const seam = (options: { loaded: boolean; urls?: Record<string, string> }) => {
  const urls = options.urls ?? {};
  return {
    isLoaded: () => options.loaded,
    resolveUrl: (tag: string) => urls[tag] ?? null,
  };
};

describe('ExpressionAssetResolver — C-510 AC-5: registry resolution', () => {
  test('a registered generated expression wins over the predictable path', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      registry: seam({
        loaded: true,
        urls: { 'portraits:blacksmith-joy': 'blob:mock-registered' },
      }),
    });

    expect(resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' })).toBe('blob:mock-registered');
  });

  test('the tag convention matches the expression recipe tagTemplate', () => {
    const seen: string[] = [];
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      registry: {
        isLoaded: () => true,
        resolveUrl: (tag) => {
          seen.push(tag);
          return null;
        },
      },
    });

    resolver.resolve({ npcId: 'Blacksmith', emotion: 'Joy' });
    expect(seen).toEqual(['portraits:blacksmith-joy']);
  });

  test('a loaded registry that knows the tag is absent suppresses the fallback', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      registry: seam({ loaded: true }),
    });

    expect(resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' })).toBeUndefined();
  });

  test('an unloaded registry preserves the predictable-path behaviour', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      registry: seam({ loaded: false }),
    });

    expect(resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' })).toBe(
      '/images/npc/blacksmith/joy.webp',
    );
  });

  test('an explicitly disabled registry also preserves the predictable path', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      registry: null,
    });

    expect(resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' })).toBe(
      '/images/npc/blacksmith/joy.webp',
    );
  });

  test('the manifest still wins over the registry', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      manifest: SAMPLE_MANIFEST,
      registry: seam({
        loaded: true,
        urls: { 'portraits:blacksmith-joy': 'blob:mock-registered' },
      }),
    });

    expect(resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' })).toBe(
      '/images/npc/blacksmith/joy.webp',
    );
  });

  test('a cold cache is not a miss — an origin URL is still returned', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      registry: seam({
        loaded: true,
        urls: { 'portraits:blacksmith-joy': 'https://assets.example/props/x.webp' },
      }),
    });

    expect(resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' })).toBe(
      'https://assets.example/props/x.webp',
    );
  });

  test('LPC overlay resolution is unaffected by the registry path', () => {
    const resolver = new ExpressionAssetResolver({
      className: 'TestResolver',
      registry: seam({ loaded: true }),
    });

    expect(resolver.resolveLpcOverlays('happy')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// C-510 AC-5: production wiring (default registry seam)
// ---------------------------------------------------------------------------

describe('ExpressionAssetResolver — C-510 AC-5: production composition', () => {
  test('the production factory wires the default registry seam without breaking boot', async () => {
    const { getExpressionAssetResolver } = await import('./expression_asset_resolver.ts');
    const { assetStore } = await import('../assets/asset_store.svelte.ts');

    const hash = 'a'.repeat(64);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === `${CATALOG_BASE_URL}/seed/asset_seed.json`) {
        return Response.json({
          sv: 1,
          g: '2026-09-12T00:00:00.000Z',
          o: CATALOG_BASE_URL,
          r: [{ t: 'portraits:blacksmith-joy', h: hash, s: 1, c: 'portraits', e: '.webp' }],
        });
      }
      return Response.json({ schemaVersion: 1, tags: [], rationale: {} });
    });

    try {
      await assetStore.rescanAssets();

      // Production composition omits `registry`, so resolution must traverse
      // the shared AssetStore rather than the predictable-path fallback.
      const resolver = getExpressionAssetResolver({ className: 'CombatExpressionResolver' });
      const catalogUrl = `${CATALOG_BASE_URL}/assets/aa/${hash}.webp`;

      expect(catalogUrl).not.toBe('/images/npc/blacksmith/joy.webp');
      expect(resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' })).toBe(catalogUrl);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
