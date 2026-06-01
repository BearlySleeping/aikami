// packages/frontend/engine/src/__tests__/context_system.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, query, set } from 'bitecs';
import type { NPCDialogData } from '../components/npc_dialog.ts';
import { NPCDialog, registerNPCDialogObservers } from '../components/npc_dialog.ts';
import type { PositionData } from '../components/position.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerSpriteObservers } from '../components/sprite.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { SpatialHashGrid } from '../math/spatial_hash_grid.ts';
import { clearContextState, updateContextSystem } from '../systems/context_system.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestWorld = (): World => {
  const world = createWorld();
  registerPositionObservers(world);
  registerSpriteObservers(world);
  registerNPCDialogObservers(world);
  return world;
};

/** Query terms for context-bearing entities (used by the grid population helper). */
const CONTEXT_QUERY_TERMS = [Position, NPCDialog];

/** Grid cell size matching the default context radius. */
const GRID_CELL_SIZE = 50;

/** Capacity large enough for all test entities. */
const GRID_CAPACITY = 1024;

/** Pre-allocated position buffer for grid population in tests. */
const testPositionBuffer = new Float32Array(GRID_CAPACITY * 2);

/**
 * Populates a spatial hash grid with all context-bearing entities from the
 * given world. Must be called after entity creation / position changes and
 * before `updateContextSystem`.
 */
const populateTestGrid = (w: World, grid: SpatialHashGrid): void => {
  const entityIds: number[] = [];

  for (const eid of query(w, CONTEXT_QUERY_TERMS)) {
    const pos = getComponent(w, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    const idx = entityIds.length;
    testPositionBuffer[idx * 2] = pos.x;
    testPositionBuffer[idx * 2 + 1] = pos.y;
    entityIds.push(eid);
  }

  grid.populate(testPositionBuffer, entityIds);
};

// ---------------------------------------------------------------------------
// ContextSystem — context entry
// ---------------------------------------------------------------------------

describe('ContextSystem — context entry', () => {
  let world: World;
  let bridge: MockEngineBridge;
  let grid: SpatialHashGrid;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
    grid = new SpatialHashGrid({ cellSize: GRID_CELL_SIZE, capacity: GRID_CAPACITY });
    clearContextState();
  });

  it('emits CONTEXT_ENTERED when player is within default 50px radius', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 30, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'gandalf',
        npcName: 'Gandalf',
        dialog: 'A wizard is never late...',
        interactionRadius: 30,
        playerInRange: false,
      }),
    );

    const received: Array<{ type: string; entityId: string }> = [];
    bridge.on('CONTEXT_ENTERED', (event) => {
      received.push(event);
    });

    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('CONTEXT_ENTERED');
    expect(received[0].entityId).toBe('gandalf');
  });

  it('includes NPC context payload in CONTEXT_ENTERED event', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 40, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'npc-001',
        npcName: 'Elder',
        dialog: 'Welcome, traveler!',
        interactionRadius: 20,
        playerInRange: false,
      }),
    );

    const received: Array<{ entityId: string; contextPayload: unknown }> = [];
    bridge.on('CONTEXT_ENTERED', (event) => {
      received.push(event);
    });

    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    expect(received).toHaveLength(1);
    const payload = received[0].contextPayload as NPCDialogData;
    expect(payload.npcId).toBe('npc-001');
    expect(payload.npcName).toBe('Elder');
    expect(payload.dialog).toBe('Welcome, traveler!');
    expect(payload.interactionRadius).toBe(20);
  });

  it('does NOT emit CONTEXT_ENTERED when player is outside the default radius', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 100, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'far-npc',
        npcName: 'Distant',
        dialog: 'Too far!',
        interactionRadius: 20,
        playerInRange: false,
      }),
    );

    const received: Array<{ type: string }> = [];
    bridge.on('CONTEXT_ENTERED', () => {
      received.push({ type: 'CONTEXT_ENTERED' });
    });

    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    expect(received).toHaveLength(0);
  });

  it('does NOT emit CONTEXT_ENTERED when player is exactly on the radius boundary (strict less-than)', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 50, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'boundary-npc',
        npcName: 'Boundary',
        dialog: 'On the edge',
        interactionRadius: 10,
        playerInRange: false,
      }),
    );

    const received: Array<{ type: string }> = [];
    bridge.on('CONTEXT_ENTERED', () => {
      received.push({ type: 'CONTEXT_ENTERED' });
    });

    // radius = 50, dist = 50, distSq = 2500, radiusSq = 2500, 2500 < 2500 = false
    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Context exit tests
// ---------------------------------------------------------------------------

describe('ContextSystem — context exit', () => {
  let world: World;
  let bridge: MockEngineBridge;
  let grid: SpatialHashGrid;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
    grid = new SpatialHashGrid({ cellSize: GRID_CELL_SIZE, capacity: GRID_CAPACITY });
    clearContextState();
  });

  it('emits CONTEXT_EXITED when player leaves the context radius', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 10, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'leaving-npc',
        npcName: 'Leaver',
        dialog: 'Goodbye!',
        interactionRadius: 5,
        playerInRange: false,
      }),
    );

    // First tick — player enters context
    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    // Second tick — move player far away
    addComponent(world, playerEid, set(Position, { x: 200, y: 200 }));

    const received: Array<{ type: string; entityId: string }> = [];
    bridge.on('CONTEXT_EXITED', (event) => {
      received.push(event);
    });

    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('CONTEXT_EXITED');
    expect(received[0].entityId).toBe('leaving-npc');
  });

  it('does NOT emit CONTEXT_EXITED if player never entered', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 200, y: 200 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 10, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'never-entered',
        npcName: 'Never',
        dialog: 'Alone',
        interactionRadius: 5,
        playerInRange: false,
      }),
    );

    const received: Array<{ type: string }> = [];
    bridge.on('CONTEXT_EXITED', () => {
      received.push({ type: 'CONTEXT_EXITED' });
    });

    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple NPCs
// ---------------------------------------------------------------------------

describe('ContextSystem — multiple NPCs', () => {
  let world: World;
  let bridge: MockEngineBridge;
  let grid: SpatialHashGrid;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
    grid = new SpatialHashGrid({ cellSize: GRID_CELL_SIZE, capacity: GRID_CAPACITY });
    clearContextState();
  });

  it('can track multiple NPCs simultaneously', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    // NPC 1 — within 50px at (30, 0)
    const npc1Eid = addEntity(world);
    addComponent(world, npc1Eid, Position);
    addComponent(world, npc1Eid, set(Position, { x: 30, y: 0 }));
    addComponent(world, npc1Eid, NPCDialog);
    addComponent(
      world,
      npc1Eid,
      set(NPCDialog, {
        npcId: 'npc-1',
        npcName: 'First',
        dialog: 'Hello!',
        interactionRadius: 10,
        playerInRange: false,
      }),
    );

    // NPC 2 — within 50px at (0, 40)
    const npc2Eid = addEntity(world);
    addComponent(world, npc2Eid, Position);
    addComponent(world, npc2Eid, set(Position, { x: 0, y: 40 }));
    addComponent(world, npc2Eid, NPCDialog);
    addComponent(
      world,
      npc2Eid,
      set(NPCDialog, {
        npcId: 'npc-2',
        npcName: 'Second',
        dialog: 'Hi there!',
        interactionRadius: 15,
        playerInRange: false,
      }),
    );

    // NPC 3 — outside 50px at (100, 0)
    const npc3Eid = addEntity(world);
    addComponent(world, npc3Eid, Position);
    addComponent(world, npc3Eid, set(Position, { x: 100, y: 0 }));
    addComponent(world, npc3Eid, NPCDialog);
    addComponent(
      world,
      npc3Eid,
      set(NPCDialog, {
        npcId: 'npc-3',
        npcName: 'Far',
        dialog: 'Can you hear me?',
        interactionRadius: 20,
        playerInRange: false,
      }),
    );

    const entered: string[] = [];
    bridge.on('CONTEXT_ENTERED', (event) => {
      entered.push(event.entityId);
    });

    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    expect(entered).toHaveLength(2);
    expect(entered).toEqual(expect.arrayContaining(['npc-1', 'npc-2']));
    expect(entered).not.toContain('npc-3');
  });

  it('can enter and exit multiple NPCs independently', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npc1Eid = addEntity(world);
    addComponent(world, npc1Eid, Position);
    addComponent(world, npc1Eid, set(Position, { x: 30, y: 0 }));
    addComponent(world, npc1Eid, NPCDialog);
    addComponent(
      world,
      npc1Eid,
      set(NPCDialog, {
        npcId: 'npc-1',
        npcName: 'First',
        dialog: 'Hello!',
        interactionRadius: 10,
        playerInRange: false,
      }),
    );

    const npc2Eid = addEntity(world);
    addComponent(world, npc2Eid, Position);
    addComponent(world, npc2Eid, set(Position, { x: 0, y: 40 }));
    addComponent(world, npc2Eid, NPCDialog);
    addComponent(
      world,
      npc2Eid,
      set(NPCDialog, {
        npcId: 'npc-2',
        npcName: 'Second',
        dialog: 'Hi there!',
        interactionRadius: 15,
        playerInRange: false,
      }),
    );

    // First tick — both enter
    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    // Move player toward NPC 2 only, away from NPC 1
    addComponent(world, playerEid, set(Position, { x: 10, y: 80 }));

    const entered: string[] = [];
    const exited: string[] = [];
    bridge.on('CONTEXT_ENTERED', (event) => {
      entered.push(event.entityId);
    });
    bridge.on('CONTEXT_EXITED', (event) => {
      exited.push(event.entityId);
    });

    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });

    // NPC 1 should exit (distance from 10,80 to 30,0 is 20,80 → distSq = 400+6400 = 6800 > 2500)
    expect(exited).toContain('npc-1');

    // NPC 2 at (0, 40), player at (10, 80) → distSq = 100+1600 = 1700 < 2500 → still in context
    expect(exited).not.toContain('npc-2');
  });
});

// ---------------------------------------------------------------------------
// Custom context radius
// ---------------------------------------------------------------------------

describe('ContextSystem — custom radius', () => {
  let world: World;
  let bridge: MockEngineBridge;
  let grid: SpatialHashGrid;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
    grid = new SpatialHashGrid({ cellSize: GRID_CELL_SIZE, capacity: GRID_CAPACITY });
    clearContextState();
  });

  it('uses custom context radius when provided', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 75, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'wide-npc',
        npcName: 'Wide',
        dialog: 'I can be detected from far away!',
        interactionRadius: 10,
        playerInRange: false,
      }),
    );

    // Default radius 50 would NOT detect this NPC at distance 75
    // Custom radius 100 SHOULD detect it
    const received: Array<{ type: string }> = [];
    bridge.on('CONTEXT_ENTERED', () => {
      received.push({ type: 'CONTEXT_ENTERED' });
    });

    populateTestGrid(world, grid);
    updateContextSystem({
      world,
      playerEntityId: playerEid,
      bridge,
      spatialGrid: grid,
      contextRadius: 100,
    });

    expect(received).toHaveLength(1);
  });

  it('custom radius of 0 means no context is ever entered', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 1, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'zero-radius',
        npcName: 'Zero',
        dialog: 'Never seen',
        interactionRadius: 10,
        playerInRange: false,
      }),
    );

    const received: Array<{ type: string }> = [];
    bridge.on('CONTEXT_ENTERED', () => {
      received.push({ type: 'CONTEXT_ENTERED' });
    });

    populateTestGrid(world, grid);
    updateContextSystem({
      world,
      playerEntityId: playerEid,
      bridge,
      spatialGrid: grid,
      contextRadius: 0,
    });

    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Safety — edge cases
// ---------------------------------------------------------------------------

describe('ContextSystem — safety edge cases', () => {
  let world: World;
  let bridge: MockEngineBridge;
  let grid: SpatialHashGrid;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
    grid = new SpatialHashGrid({ cellSize: GRID_CELL_SIZE, capacity: GRID_CAPACITY });
    clearContextState();
  });

  it('safely handles undefined bridge', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    expect(() => {
      updateContextSystem({
        world,
        playerEntityId: playerEid,
        bridge: undefined as unknown as EngineBridge,
        spatialGrid: grid,
      });
    }).not.toThrow();
  });

  it('safely handles undefined world', () => {
    expect(() => {
      updateContextSystem({
        world: undefined as unknown as World,
        playerEntityId: 1,
        bridge,
        spatialGrid: grid,
      });
    }).not.toThrow();
  });

  it('safely handles player without Position component', () => {
    const playerEid = addEntity(world);

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 10, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'npc',
        npcName: 'NPC',
        dialog: 'Hi',
        interactionRadius: 100,
        playerInRange: false,
      }),
    );

    expect(() => {
      updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });
    }).not.toThrow();
  });

  it('does not emit duplicate CONTEXT_ENTERED on consecutive ticks while still in range', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 30, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'stable-npc',
        npcName: 'Stable',
        dialog: 'Still here',
        interactionRadius: 10,
        playerInRange: false,
      }),
    );

    const entered: string[] = [];
    bridge.on('CONTEXT_ENTERED', (event) => {
      entered.push(event.entityId);
    });

    // Tick 1 — enters context
    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });
    expect(entered).toHaveLength(1);

    // Tick 2 — still in range, should NOT re-emit
    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });
    expect(entered).toHaveLength(1);

    // Tick 3 — still in range, should NOT re-emit
    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });
    expect(entered).toHaveLength(1);
  });

  it('emits enter → exit → enter sequence correctly', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 30, y: 0 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'yo-yo',
        npcName: 'YoYo',
        dialog: 'Back and forth',
        interactionRadius: 5,
        playerInRange: false,
      }),
    );

    const enters: string[] = [];
    const exits: string[] = [];
    bridge.on('CONTEXT_ENTERED', (event) => {
      enters.push(event.entityId);
    });
    bridge.on('CONTEXT_EXITED', (event) => {
      exits.push(event.entityId);
    });

    // Tick 1 — enters
    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });
    expect(enters).toHaveLength(1);
    expect(exits).toHaveLength(0);

    // Tick 2 — leaves (move far away)
    addComponent(world, playerEid, set(Position, { x: 200, y: 200 }));
    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });
    expect(enters).toHaveLength(1);
    expect(exits).toHaveLength(1);
    expect(exits[0]).toBe('yo-yo');

    // Tick 3 — re-enters (move back)
    addComponent(world, playerEid, set(Position, { x: 20, y: 0 }));
    populateTestGrid(world, grid);
    updateContextSystem({ world, playerEntityId: playerEid, bridge, spatialGrid: grid });
    expect(enters).toHaveLength(2);
    expect(exits).toHaveLength(1);
  });
});
