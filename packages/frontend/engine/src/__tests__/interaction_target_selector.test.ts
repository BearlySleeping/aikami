// packages/frontend/engine/src/__tests__/interaction_target_selector.test.ts
//
// Tests for the shared interaction target selector (C-327 AC-2).
import { beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { Interactable, registerInteractableObservers } from '../components/interactable.ts';
import { NPCDialog, registerNPCDialogObservers } from '../components/npc_dialog.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerVisualObservers } from '../components/visual.ts';
import { selectInteractionTarget } from '../systems/interaction_target_selector.ts';

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

// ---------------------------------------------------------------------------

describe('selectInteractionTarget', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
  });

  // ── Basic selection ────────────────────────────────────────────────

  it('selects an NPC within interaction radius', () => {
    const npcEid = addNPC(world, 'npc-1', 'Elder', 30, 0, 50);
    const target = selectInteractionTarget({ world, playerX: 0, playerY: 0 });
    expect(target).toBeDefined();
    expect(target?.entityId).toBe(npcEid);
    expect(target?.targetType).toBe('npc');
    expect(target?.targetName).toBe('Elder');
  });

  it('returns undefined when nothing is in range', () => {
    addNPC(world, 'npc-1', 'Far', 200, 0, 30);
    const target = selectInteractionTarget({ world, playerX: 0, playerY: 0 });
    expect(target).toBeUndefined();
  });

  it('selects an item within default radius', () => {
    const itemEid = addItem(world, 'sword', 30, 0);
    const target = selectInteractionTarget({ world, playerX: 0, playerY: 0 });
    expect(target).toBeDefined();
    expect(target?.entityId).toBe(itemEid);
    expect(target?.targetType).toBe('item');
    expect(target?.targetName).toBe('sword');
  });

  // ── Priority rules ─────────────────────────────────────────────────

  it('prioritises item over NPC when both in range', () => {
    const itemEid = addItem(world, 'potion', 30, 0);
    addNPC(world, 'npc-1', 'Merchant', 40, 0, 50);

    const target = selectInteractionTarget({ world, playerX: 0, playerY: 0 });
    expect(target).toBeDefined();
    expect(target?.targetType).toBe('item');
    expect(target?.entityId).toBe(itemEid);
  });

  it('selects nearest NPC when two are in range', () => {
    const nearEid = addNPC(world, 'npc-near', 'Near', 20, 0, 50);
    addNPC(world, 'npc-far', 'Far', 40, 0, 50);

    const target = selectInteractionTarget({ world, playerX: 0, playerY: 0 });
    expect(target?.entityId).toBe(nearEid);
    expect(target?.targetName).toBe('Near');
  });

  it('selects nearest item when two items are in range', () => {
    const nearItem = addItem(world, 'gem', 15, 0);
    addItem(world, 'rock', 40, 0);

    const target = selectInteractionTarget({ world, playerX: 0, playerY: 0 });
    expect(target?.entityId).toBe(nearItem);
    expect(target?.targetName).toBe('gem');
  });

  // ── Empty world ────────────────────────────────────────────────────

  it('returns undefined in an empty world', () => {
    const target = selectInteractionTarget({ world, playerX: 0, playerY: 0 });
    expect(target).toBeUndefined();
  });

  // ── Entity at exact boundary ───────────────────────────────────────

  it('selects NPC exactly at interaction radius boundary (<= check)', () => {
    addNPC(world, 'npc-edge', 'Edge', 50, 0, 50);
    const target = selectInteractionTarget({ world, playerX: 0, playerY: 0 });
    expect(target).toBeDefined();
    expect(target?.targetName).toBe('Edge');
  });

  it('does NOT select NPC just outside interaction radius', () => {
    addNPC(world, 'npc-out', 'Out', 51, 0, 50);
    const target = selectInteractionTarget({ world, playerX: 0, playerY: 0 });
    expect(target).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

const addItem = (w: World, itemId: string, x: number, y: number): number => {
  const eid = addEntity(w);
  addComponent(w, eid, Position);
  addComponent(w, eid, set(Position, { x, y }));
  addComponent(w, eid, Interactable);
  addComponent(
    w,
    eid,
    set(Interactable, {
      type: 'item',
      itemId,
      quantity: 1,
    }),
  );
  return eid;
};
