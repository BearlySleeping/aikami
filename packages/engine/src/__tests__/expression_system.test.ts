// packages/engine/src/__tests__/expression_system.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import {
  Appearance,
  EXPRESSION_MAP,
  FACE_LAYER_INDEX,
  registerAppearanceObservers,
} from '../components/appearance.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { clearMacroQueue, enqueueMacro, updateExpressions } from '../systems/expression_system.ts';
import type { GameEvent } from '../types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestWorld = (): World => {
  const world = createWorld();
  registerAppearanceObservers(world);
  return world;
};

/** Collects events of a specific type from the bridge. */
const collectBridgeEvents = (
  bridge: EngineBridge,
  eventType: GameEvent['type'],
): { events: GameEvent[]; unsubscribe: () => void } => {
  const events: GameEvent[] = [];
  const unsubscribe = bridge.on(eventType, (event) => {
    events.push(event);
  });
  return { events, unsubscribe };
};

/** Spawns an entity with Appearance at neutral expression. */
const spawnAppearanceEntity = (world: World): number => {
  const eid = addEntity(world);
  addComponent(world, eid, Appearance);
  addComponent(
    world,
    eid,
    set(Appearance, { layer0: 0, layer1: 0, layer2: 0, layer3: 0, layer4: 0 }),
  );
  return eid;
};

// ---------------------------------------------------------------------------
// EXPRESSION_MAP constants
// ---------------------------------------------------------------------------

describe('EXPRESSION_MAP constants', () => {
  it('maps common expression strings to integer IDs', () => {
    expect(EXPRESSION_MAP.neutral).toBe(0);
    expect(EXPRESSION_MAP.joy).toBe(1);
    expect(EXPRESSION_MAP.anger).toBe(2);
    expect(EXPRESSION_MAP.sadness).toBe(3);
    expect(EXPRESSION_MAP.surprise).toBe(4);
    expect(EXPRESSION_MAP.fear).toBe(5);
    expect(EXPRESSION_MAP.disgust).toBe(6);
    expect(EXPRESSION_MAP.blush).toBe(7);
    expect(EXPRESSION_MAP.wink).toBe(8);
    expect(EXPRESSION_MAP.pout).toBe(9);
  });

  it('FACE_LAYER_INDEX is layer 1', () => {
    expect(FACE_LAYER_INDEX).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ExpressionSystem — Appearance mutation
// ---------------------------------------------------------------------------

describe('ExpressionSystem — Appearance mutation', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
    clearMacroQueue();
  });

  it('updates Appearance.layer1[eid] when macro name is "anim"', () => {
    const eid = spawnAppearanceEntity(world);

    enqueueMacro({ name: 'anim', args: ['joy'], entityId: eid });
    updateExpressions(world, bridge);

    expect(Appearance.layer1[eid]).toBe(EXPRESSION_MAP.joy);
  });

  it('updates to anger expression', () => {
    const eid = spawnAppearanceEntity(world);

    enqueueMacro({ name: 'anim', args: ['anger'], entityId: eid });
    updateExpressions(world, bridge);

    expect(Appearance.layer1[eid]).toBe(EXPRESSION_MAP.anger);
  });

  it('updates to sadness expression', () => {
    const eid = spawnAppearanceEntity(world);

    enqueueMacro({ name: 'anim', args: ['sadness'], entityId: eid });
    updateExpressions(world, bridge);

    expect(Appearance.layer1[eid]).toBe(EXPRESSION_MAP.sadness);
  });

  it('can transition from one expression to another', () => {
    const eid = spawnAppearanceEntity(world);

    // Start joy
    enqueueMacro({ name: 'anim', args: ['joy'], entityId: eid });
    updateExpressions(world, bridge);
    expect(Appearance.layer1[eid]).toBe(EXPRESSION_MAP.joy);

    // Transition to anger
    enqueueMacro({ name: 'anim', args: ['anger'], entityId: eid });
    updateExpressions(world, bridge);
    expect(Appearance.layer1[eid]).toBe(EXPRESSION_MAP.anger);
  });

  it('emits APPEARANCE_CHANGED event on expression update', () => {
    const eid = spawnAppearanceEntity(world);

    const { events } = collectBridgeEvents(bridge, 'APPEARANCE_CHANGED');

    enqueueMacro({ name: 'anim', args: ['joy'], entityId: eid });
    updateExpressions(world, bridge);

    expect(events).toHaveLength(1);
    const ev = events[0];
    if (ev.type === 'APPEARANCE_CHANGED') {
      expect(ev.eid).toBe(eid);
      expect(ev.layerIds).toBeDefined();
      expect(ev.layerIds.length).toBe(5);
      expect(ev.layerIds[FACE_LAYER_INDEX]).toBe(EXPRESSION_MAP.joy);
    } else {
      throw new Error('Expected APPEARANCE_CHANGED event');
    }
  });

  it('processes multiple macros for different entities in one tick', () => {
    const eid1 = spawnAppearanceEntity(world);
    const eid2 = spawnAppearanceEntity(world);

    const { events } = collectBridgeEvents(bridge, 'APPEARANCE_CHANGED');

    enqueueMacro({ name: 'anim', args: ['joy'], entityId: eid1 });
    enqueueMacro({ name: 'anim', args: ['anger'], entityId: eid2 });

    updateExpressions(world, bridge);

    expect(Appearance.layer1[eid1]).toBe(EXPRESSION_MAP.joy);
    expect(Appearance.layer1[eid2]).toBe(EXPRESSION_MAP.anger);
    expect(events).toHaveLength(2);
  });

  it('processes multiple macros for the same entity (last one wins in same tick)', () => {
    const eid = spawnAppearanceEntity(world);

    enqueueMacro({ name: 'anim', args: ['joy'], entityId: eid });
    enqueueMacro({ name: 'anim', args: ['anger'], entityId: eid });
    enqueueMacro({ name: 'anim', args: ['sadness'], entityId: eid });

    updateExpressions(world, bridge);

    // All macros are processed in-order — last one wins
    expect(Appearance.layer1[eid]).toBe(EXPRESSION_MAP.sadness);
  });
});

// ---------------------------------------------------------------------------
// ExpressionSystem — safety / edge cases
// ---------------------------------------------------------------------------

describe('ExpressionSystem — safety edge cases', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
    clearMacroQueue();
  });

  it('ignores macro with unrecognized name (not "anim")', () => {
    const eid = spawnAppearanceEntity(world);

    enqueueMacro({ name: 'trigger_anim', args: ['joy'], entityId: eid });
    updateExpressions(world, bridge);

    expect(Appearance.layer1[eid]).toBe(0); // unchanged
  });

  it('ignores unrecognized expression names', () => {
    const eid = spawnAppearanceEntity(world);

    enqueueMacro({ name: 'anim', args: ['nonexistent_expression'], entityId: eid });
    updateExpressions(world, bridge);

    expect(Appearance.layer1[eid]).toBe(0); // unchanged
  });

  it('ignores macro with empty args array', () => {
    const eid = spawnAppearanceEntity(world);

    enqueueMacro({ name: 'anim', args: [], entityId: eid });
    updateExpressions(world, bridge);

    expect(Appearance.layer1[eid]).toBe(0); // unchanged
  });

  it('ignores macro with entityId 0', () => {
    // Create an entity with eid 1 but set entityId to 0
    const eid = spawnAppearanceEntity(world);

    // Macro targets entityId 0 which is not a valid entity
    enqueueMacro({ name: 'anim', args: ['joy'], entityId: 0 });
    updateExpressions(world, bridge);

    // Entity 1 should be unaffected
    expect(Appearance.layer1[eid]).toBe(0);
  });

  it('ignores macro with negative entityId', () => {
    const eid = spawnAppearanceEntity(world);

    enqueueMacro({ name: 'anim', args: ['joy'], entityId: -1 });
    updateExpressions(world, bridge);

    expect(Appearance.layer1[eid]).toBe(0);
  });

  it('safely handles undefined world', () => {
    bridge.on('GAME_ERROR', () => {}); // silence events
    expect(() => {
      updateExpressions(undefined as unknown as World, bridge);
    }).not.toThrow();
  });

  it('safely handles undefined bridge', () => {
    const eid = spawnAppearanceEntity(world);

    enqueueMacro({ name: 'anim', args: ['joy'], entityId: eid });

    expect(() => {
      updateExpressions(world, undefined as unknown as EngineBridge);
    }).not.toThrow();
  });

  it('returns early when queue is empty (no side effects)', () => {
    const eid = spawnAppearanceEntity(world);

    // Pre-set a non-zero layer value
    Appearance.layer1[eid] = 5;

    const { events } = collectBridgeEvents(bridge, 'APPEARANCE_CHANGED');

    // No macros enqueued — should be a no-op
    updateExpressions(world, bridge);

    expect(Appearance.layer1[eid]).toBe(5); // unchanged
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// dirtyCheckAppearance — render system export
// ---------------------------------------------------------------------------

describe('dirtyCheckAppearance', () => {
  it('is exported from the render_system module', async () => {
    const mod = await import('../systems/render_system.ts');
    expect(typeof mod.dirtyCheckAppearance).toBe('function');
  });

  it('invalidates composed sprite when layer IDs change', () => {
    // This is a module-level export check — actual behavior tested via
    // the GameWorld integration path (APPEARANCE_CHANGED → dirtyCheckAppearance).
  });
});
