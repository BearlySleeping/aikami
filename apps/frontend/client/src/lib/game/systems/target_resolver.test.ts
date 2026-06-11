// apps/frontend/client/src/lib/game/systems/target_resolver.test.ts

import { beforeEach, describe, expect, test } from 'bun:test';
import { TargetResolver, type TargetResolverSource } from './target_resolver.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal mock PixiJS Container for tests. */
const createMockSprite = (label: string) => {
  return {
    label,
    x: 0,
    y: 0,
    visible: true,
  };
};

/** Creates a TargetResolverSource backed by plain Maps. */
const createSource = (): TargetResolverSource & {
  npcMeta: Map<number, { eid: number; npcId: string }>;
  renderEntries: Map<number, { displayObject: ReturnType<typeof createMockSprite> }>;
} => {
  const npcMeta = new Map<number, { eid: number; npcId: string }>();
  const renderEntries = new Map<number, { displayObject: ReturnType<typeof createMockSprite> }>();

  return {
    npcMeta,
    renderEntries,
    getNpcMeta(eid: number) {
      return npcMeta.get(eid);
    },
    getRenderEntry(eid: number) {
      const entry = renderEntries.get(eid);
      if (!entry) {
        return undefined;
      }
      return {
        displayObject: entry.displayObject as unknown as import('pixi.js').Container,
        tint: 0xffffff,
        cullable: true,
      };
    },
    getNpcEntityIds() {
      return npcMeta.keys();
    },
  };
};

// ---------------------------------------------------------------------------
// AC4: Sprite Target Resolution
// ---------------------------------------------------------------------------

describe('TargetResolver — AC4: Sprite Target Resolution', () => {
  let resolver: TargetResolver;
  let source: ReturnType<typeof createSource>;

  beforeEach(() => {
    source = createSource();
    resolver = new TargetResolver({ source });
  });

  test('should resolve npcId to the correct PixiJS display object', () => {
    const elderSprite = createMockSprite('elder_sprite');
    const merchantSprite = createMockSprite('merchant_sprite');

    // Register two NPCs
    source.npcMeta.set(1, { eid: 1, npcId: 'npc-elder-001' });
    source.npcMeta.set(2, { eid: 2, npcId: 'npc-merchant-002' });
    source.renderEntries.set(1, { displayObject: elderSprite });
    source.renderEntries.set(2, { displayObject: merchantSprite });

    const resolved = resolver.resolveTarget('npc-elder-001');

    expect(resolved).toBeDefined();
    expect((resolved as ReturnType<typeof createMockSprite>).label).toBe('elder_sprite');
  });

  test('should resolve a different npcId to its own sprite', () => {
    const merchantSprite = createMockSprite('merchant_sprite');

    source.npcMeta.set(2, { eid: 2, npcId: 'npc-merchant-002' });
    source.renderEntries.set(2, { displayObject: merchantSprite });

    const resolved = resolver.resolveTarget('npc-merchant-002');

    expect(resolved).toBeDefined();
    expect((resolved as ReturnType<typeof createMockSprite>).label).toBe('merchant_sprite');
  });

  test('should return undefined when npcId is not found', () => {
    const resolved = resolver.resolveTarget('npc-nonexistent');

    expect(resolved).toBeUndefined();
  });

  test('should return undefined when NPC has metadata but no render entry yet', () => {
    source.npcMeta.set(1, { eid: 1, npcId: 'npc-ghost-003' });
    // No render entry — sprite not loaded yet

    const resolved = resolver.resolveTarget('npc-ghost-003');

    expect(resolved).toBeUndefined();
  });

  test('should not crash when source has no NPCs at all', () => {
    const resolved = resolver.resolveTarget('npc-any');

    expect(resolved).toBeUndefined();
  });
});
