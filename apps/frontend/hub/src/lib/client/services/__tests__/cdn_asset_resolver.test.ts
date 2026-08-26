// apps/frontend/hub/src/lib/client/services/__tests__/cdn_asset_resolver.test.ts
//
// AC-3: The hub resolver builds correct content-addressed URLs.
//
// Given a CatalogAssetEntry with hash `ab34…` and ext `.webp`, and an origin
// of `https://assets.example.com`, when `createCdnAssetResolver` is called,
// then it returns `https://assets.example.com/assets/ab/ab34….webp`, a
// trailing slash on the origin produces no double slash, an unknown tag
// returns null, and release is a no-op that does not throw.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { CatalogAssetEntry } from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';

const MOCK_ENTRIES = [
  {
    tag: 'lpc:body:bodies_male:walk',
    hash: 'ab34cd56ef78901234567890abcdef1234567890abcdef1234567890abcdef',
    ext: '.webp',
  },
  {
    tag: 'lpc:head:heads_female:walk',
    hash: 'cd78ef90ab1234567890abcdef1234567890abcdef1234567890abcdef123456',
    ext: '.webp',
  },
] as const satisfies readonly CatalogAssetEntry[];

describe('AC-3: CDN AssetResolver builds correct content-addressed URLs', () => {
  let resolver: AssetResolver;

  beforeEach(async () => {
    mock.module('$logger', () => ({
      logger: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
    }));

    const mod = await import('../cdn_asset_resolver');
    resolver = mod.createCdnAssetResolver({
      originUrl: 'https://assets.example.com',
      entries: MOCK_ENTRIES,
    });
  });

  test('returns correct content-addressed URL', () => {
    const url = resolver.resolve('lpc:body:bodies_male:walk');
    expect(url).toBe(
      'https://assets.example.com/assets/ab/ab34cd56ef78901234567890abcdef1234567890abcdef1234567890abcdef.webp',
    );
  });

  test('trailing slash on origin produces no double slash', async () => {
    const mod = await import('../cdn_asset_resolver');
    const resolverWithSlash = mod.createCdnAssetResolver({
      originUrl: 'https://assets.example.com/',
      entries: MOCK_ENTRIES,
    });
    const url = resolverWithSlash.resolve('lpc:body:bodies_male:walk');
    expect(url).toBe(
      'https://assets.example.com/assets/ab/ab34cd56ef78901234567890abcdef1234567890abcdef1234567890abcdef.webp',
    );
  });

  test('unknown tag returns null', () => {
    const url = resolver.resolve('unknown:tag');
    expect(url).toBeNull();
  });

  test('release is a no-op that does not throw', () => {
    expect(() =>
      resolver.release(
        'https://assets.example.com/assets/ab/ab34cd56ef78901234567890abcdef1234567890abcdef1234567890abcdef.webp',
      ),
    ).not.toThrow();
  });

  test('kind is cdn', () => {
    expect(resolver.kind).toBe('cdn');
  });
});
