// packages/frontend/engine/src/__tests__/interaction_proximity_system.test.ts
//
// Tests for the interaction proximity system (C-327 AC-2).
import { beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { registerInteractableObservers } from '../components/interactable.ts';
import { NPCDialog, registerNPCDialogObservers } from '../components/npc_dialog.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerVisualObservers } from '../components/visual.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import {
  clearInteractionProximityState,
  updateInteractionProximity,
} from '../systems/interaction_proximity_system.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestWorld = (): World => {
  const world = createWorld();
  registerPositionObservers(world);
  registerVisualObservers(world);
  registerNPCDialogObservers(world);
  registerInteractableObservers(world);
  return world;
};

const addNPC = (
  w: World,
  npcId: string,
  npcName: string,
  x: number,
  y: number,
  interactionRadius: number,
): number => {
  const eid = addEntity(w);
  addComponent(w, eid, Position);
  addComponent(w, eid, set(Position, { x, y }));
  addComponent(w, eid, NPCDialog);
  addComponent(
    w,
    eid,
    set(NPCDialog, {
      npcId,
      npcName,
      dialog: `Hello from ${npcName}`,
      interactionRadius,
      playerInRange: false,
    }),
  );
  return eid;
};

// ---------------------------------------------------------------------------

describe('updateInteractionProximity', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
    clearInteractionProximityState();
  });

  // ── Entering range ─────────────────────────────────────────────────

  it('emits INTERACTION_TARGET_CHANGED when player is near an NPC', () => {
    const playerEid = addPlayer(world, 0, 0);
    addNPC(world, 'npc-1', 'Elder', 30, 0, 50);

    const events: Array<{ type: string; targetName?: string }> = [];
    bridge.on('INTERACTION_TARGET_CHANGED', (e) => events.push(e));

    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('INTERACTION_TARGET_CHANGED');
    expect(events[0].targetName).toBe('Elder');
  });

  it('emits INTERACTION_TARGET_CHANGED with undefined when nothing in range', () => {
    const playerEid = addPlayer(world, 0, 0);

    const events: Array<{ type: string }> = [];
    bridge.on('INTERACTION_TARGET_CHANGED', (e) => events.push(e));

    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });

    // First tick — nothing in range, but no previous target either
    expect(events).toHaveLength(0);
  });

  // ── Dirty-check (no duplicate events) ──────────────────────────────

  it('does NOT emit duplicate events on consecutive ticks (dirty check)', () => {
    const playerEid = addPlayer(world, 0, 0);
    addNPC(world, 'npc-1', 'Stable', 30, 0, 50);

    const events: Array<{ type: string }> = [];
    bridge.on('INTERACTION_TARGET_CHANGED', (e) => events.push(e));

    // Tick 1 — enters range
    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });
    expect(events).toHaveLength(1);

    // Tick 2 — still in range, same target
    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });
    expect(events).toHaveLength(1);

    // Tick 3 — still in range
    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });
    expect(events).toHaveLength(1);
  });

  it('emits enter → exit → enter sequence correctly', () => {
    const playerEid = addPlayer(world, 0, 0);
    addNPC(world, 'npc-1', 'YoYo', 30, 0, 50);

    const events: Array<{ type: string; targetEntityId?: number }> = [];
    bridge.on('INTERACTION_TARGET_CHANGED', (e) =>
      events.push(e as { type: string; targetEntityId?: number }),
    );

    // Enter
    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });
    expect(events).toHaveLength(1);
    expect(events[0].targetEntityId).toBeGreaterThan(0);

    // Move player far away
    addComponent(world, playerEid, set(Position, { x: 200, y: 200 }));

    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });
    expect(events).toHaveLength(2);
    expect(events[1].targetEntityId).toBeUndefined();

    // Move back
    addComponent(world, playerEid, set(Position, { x: 20, y: 0 }));

    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });
    expect(events).toHaveLength(3);
    expect(events[2].targetEntityId).toBeGreaterThan(0);
  });

  // ── Target switching ───────────────────────────────────────────────

  it('emits when target switches from one NPC to another', () => {
    const playerEid = addPlayer(world, 0, 0);
    addNPC(world, 'npc-1', 'First', 30, 0, 50);
    addNPC(world, 'npc-2', 'Second', 40, 0, 50);

    const events: Array<{ targetName?: string; targetEntityId?: number }> = [];
    bridge.on('INTERACTION_TARGET_CHANGED', (e) =>
      events.push(e as { targetName?: string; targetEntityId?: number }),
    );

    // Player is at (0,0), npc1 at (30,0) is closer
    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });
    expect(events).toHaveLength(1);
    expect(events[0].targetName).toBe('First');

    // Move player closer to npc2
    addComponent(world, playerEid, set(Position, { x: 38, y: 0 }));
    updateInteractionProximity({ world, playerEntityId: playerEid, bridge });

    expect(events).toHaveLength(2);
    expect(events[1].targetName).toBe('Second');
  });

  // ── Safety ─────────────────────────────────────────────────────────

  it('does not throw with undefined bridge', () => {
    const playerEid = addPlayer(world, 0, 0);
    expect(() => {
      updateInteractionProximity({
        world,
        playerEntityId: playerEid,
        bridge: undefined as unknown as EngineBridge,
      });
    }).not.toThrow();
  });

  it('does not throw with undefined world', () => {
    expect(() => {
      updateInteractionProximity({
        world: undefined as unknown as World,
        playerEntityId: 1,
        bridge,
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const addPlayer = (w: World, x: number, y: number): number => {
  const eid = addEntity(w);
  addComponent(w, eid, Position);
  addComponent(w, eid, set(Position, { x, y }));
  return eid;
};
