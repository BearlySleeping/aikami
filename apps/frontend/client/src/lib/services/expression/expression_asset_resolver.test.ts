// apps/frontend/client/src/lib/services/media/expression_asset_resolver.test.ts
import { describe, expect, test } from 'bun:test';
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
