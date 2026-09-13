// apps/frontend/client/src/lib/data/npc_avatar_catalog_generated.test.ts
//
// C-512: a locally generated portrait must resolve *before* the hardcoded
// sprite map — including for an NPC the map does not know at all.
//
// The asset store is mocked so the registry seam is deterministic; the
// non-registry behaviour stays covered by npc_avatar_catalog.test.ts.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

const resolvedTags: string[] = [];
let generatedTagToResolve: string | undefined;

mock.module('$lib/services/assets/asset_store.svelte', () => ({
  assetStore: {
    resolveUrl: (tag: string) => {
      resolvedTags.push(tag);
      return tag === generatedTagToResolve ? 'blob:generated-portrait' : null;
    },
  },
}));

const { resolveNpcAvatarUrl } = await import('./npc_avatar_catalog.ts');

beforeEach(() => {
  resolvedTags.length = 0;
  generatedTagToResolve = undefined;
});

describe('resolveNpcAvatarUrl — generated portraits (C-512 AC-2)', () => {
  test('a generated portrait wins over the hardcoded sprite map', () => {
    generatedTagToResolve = 'portraits:merchant-neutral';

    expect(resolveNpcAvatarUrl({ npcId: 'merchant' })).toBe('blob:generated-portrait');
    expect(resolvedTags).toContain('portraits:merchant-neutral');
  });

  test('an NPC the sprite map does not know still renders a generated portrait', () => {
    generatedTagToResolve = 'portraits:blacksmith-neutral';

    expect(resolveNpcAvatarUrl({ npcId: 'blacksmith' })).toBe('blob:generated-portrait');
  });

  test('a non-neutral request falls back to the generated neutral bust', () => {
    generatedTagToResolve = 'portraits:merchant-neutral';

    expect(resolveNpcAvatarUrl({ npcId: 'merchant', expression: 'joy' })).toBe(
      'blob:generated-portrait',
    );
    // Requested emotion first, then neutral.
    expect(resolvedTags.slice(0, 2)).toEqual([
      'portraits:merchant-joy',
      'portraits:merchant-neutral',
    ]);
  });

  test('with no generated row the catalog sprite path is unchanged', () => {
    expect(resolveNpcAvatarUrl({ npcId: 'merchant' })).toBe(
      '/game-data/portraits/npc/aragon/neutral.webp',
    );
  });

  test('an NPC with neither a generated portrait nor a sprite entry is still the placeholder', () => {
    expect(resolveNpcAvatarUrl({ npcId: 'nobody-at-all' })).toBe(
      '/game-data/portraits/npc/placeholder.svg',
    );
  });
});
