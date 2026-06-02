// apps/frontend/game/src/engine/__tests__/game_world.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, query, set } from 'bitecs';
import type { NPCDialogData } from '../components/npc_dialog.ts';
import { NPCDialog, registerNPCDialogObservers } from '../components/npc_dialog.ts';
import type { PositionData } from '../components/position.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerSpriteObservers, Sprite } from '../components/sprite.ts';
import type { VelocityData } from '../components/velocity.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { createNPC } from '../entities/create_npc.ts';
import { createPlayer } from '../entities/create_player.ts';
import { updateDialogTriggers } from '../systems/dialog_trigger_system.ts';
import { resetMovementTracking, updateMovement } from '../systems/movement_system.ts';

// ---------------------------------------------------------------------------
// Helper: set up a world with all component observers registered
// ---------------------------------------------------------------------------

const createTestWorld = (): World => {
  const world = createWorld();
  registerPositionObservers(world);
  registerVelocityObservers(world);
  registerSpriteObservers(world);
  registerNPCDialogObservers(world);
  return world;
};

// ---------------------------------------------------------------------------
// GameWorld test suite — entity creation, systems, bridge integration
// ---------------------------------------------------------------------------

describe('GameWorld — entity creation', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
  });

  afterEach(() => {
    resetMovementTracking(world);
  });

  it('createPlayer() adds an entity with Position, Velocity, and Sprite', () => {
    const eid = createPlayer(world);

    expect(eid).toBeGreaterThan(0);

    const pos = getComponent(world, eid, Position) as PositionData;
    expect(pos).toBeDefined();
    expect(pos.x).toBe(400);
    expect(pos.y).toBe(300);

    const vel = getComponent(world, eid, Velocity) as VelocityData;
    expect(vel).toBeDefined();
    expect(vel.x).toBe(0);
    expect(vel.y).toBe(0);

    const sprite = getComponent(world, eid, Sprite);
    expect(sprite).toBeDefined();
  });

  it('createNPC() adds an entity with Position, Sprite, and NPCDialog', () => {
    const eid = createNPC(world, {
      npcId: 'test-npc',
      npcName: 'Test NPC',
      x: 200,
      y: 150,
      textureKey: 'npc_test',
      dialog: 'Hello from test!',
      interactionRadius: 50,
    });

    expect(eid).toBeGreaterThan(0);

    const pos = getComponent(world, eid, Position) as PositionData;
    expect(pos).toBeDefined();
    expect(pos.x).toBe(200);
    expect(pos.y).toBe(150);

    const dialog = getComponent(world, eid, NPCDialog) as NPCDialogData;
    expect(dialog).toBeDefined();
    expect(dialog.npcId).toBe('test-npc');
    expect(dialog.npcName).toBe('Test NPC');
    expect(dialog.dialog).toBe('Hello from test!');
    expect(dialog.interactionRadius).toBe(50);
    expect(dialog.playerInRange).toBe(false);
  });

  it('entity query returns created entity', () => {
    createPlayer(world);
    createNPC(world, {
      npcId: 'npc-1',
      npcName: 'NPC 1',
      x: 100,
      y: 100,
      textureKey: 'npc',
      dialog: 'Hi',
      interactionRadius: 40,
    });

    const allPositions = query(world, [Position]);
    expect(allPositions.length).toBe(2);

    const npcEntities = query(world, [NPCDialog]);
    expect(npcEntities.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Movement system tests
// ---------------------------------------------------------------------------

describe('GameWorld — movement system', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
  });

  afterEach(() => {
    resetMovementTracking(world);
  });

  it('updates position based on velocity and delta time', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 0, y: 0 }));
    addComponent(world, eid, Velocity);
    // Diagonal velocity blocked — horizontal dominant → vertical zeroed
    addComponent(world, eid, set(Velocity, { x: 100, y: 50 }));

    updateMovement(world, 1000);

    const pos = getComponent(world, eid, Position) as PositionData;
    // Grid-aligned: snap to (16,16), then step 100px right through cells
    // 3 full cells (96px) + 4px partial → 16+96+4 = 116
    expect(pos.x).toBe(116);
    expect(pos.y).toBe(16);
  });

  it('handles fractional delta time (16ms = ~1 frame at 60fps)', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 0, y: 0 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 60, y: 0 }));

    updateMovement(world, 16);

    const pos = getComponent(world, eid, Position) as PositionData;
    // Grid-aligned: snap to (16,16), then move 0.96px toward (48,16)
    expect(pos.x).toBeCloseTo(16.96, 2);
    expect(pos.y).toBe(16);
  });

  it('does not move entities with zero velocity', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 50, y: 50 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));

    updateMovement(world, 1000);

    const pos = getComponent(world, eid, Position) as PositionData;
    expect(pos.x).toBe(50);
    expect(pos.y).toBe(50);
  });

  it('does not move entity without velocity component', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 10, y: 10 }));

    updateMovement(world, 1000);

    const pos = getComponent(world, eid, Position) as PositionData;
    expect(pos.x).toBe(10);
    expect(pos.y).toBe(10);
  });

  it('safely handles zero or negative delta time', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 0, y: 0 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 100, y: 0 }));

    updateMovement(world, 0);
    let pos = getComponent(world, eid, Position) as PositionData;
    expect(pos.x).toBe(0);

    updateMovement(world, -100);
    pos = getComponent(world, eid, Position) as PositionData;
    expect(pos.x).toBe(0);
  });

  it('safely handles undefined world', () => {
    expect(() => {
      updateMovement(undefined as unknown as World, 1000);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Grid cell alignment tests (C-040)
// ---------------------------------------------------------------------------

describe('GameWorld — grid cell alignment', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
  });

  afterEach(() => {
    resetMovementTracking(world);
  });

  it('snaps position to cell center on first movement frame', () => {
    // Entity at off-grid position (50, 50) — nearest cell center is (48, 48)
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 50, y: 50 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 100, y: 0 }));

    updateMovement(world, 16);

    const pos = getComponent(world, eid, Position) as PositionData;
    // After alignment + 16ms of movement: snapped to cell center (48, 48)
    // then moved right by 100 * 0.016 = 1.6 pixels toward target cell (80, 48)
    expect(pos.x).toBeCloseTo(49.6, 1);
    expect(pos.y).toBe(48);
  });

  it('moves in 32px cell strides along a single axis', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    // Start at a cell center (16, 16)
    addComponent(world, eid, set(Position, { x: 16, y: 16 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 32, y: 0 }));

    // Move 1000ms at 32 px/s = 32 pixels → should reach next cell center at (48, 16)
    updateMovement(world, 1000);

    const pos = getComponent(world, eid, Position) as PositionData;
    expect(pos.x).toBe(48);
    expect(pos.y).toBe(16);
  });

  it('chains multiple cell strides over consecutive frames', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 16, y: 16 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 96, y: 0 }));

    // 96 px/s for 1000ms = 96px = 3 cells of 32px each
    updateMovement(world, 1000);

    const pos = getComponent(world, eid, Position) as PositionData;
    // Should land at cell center 16 + 3*32 = 112
    expect(pos.x).toBe(112);
    expect(pos.y).toBe(16);
  });

  it('blocks diagonal velocity, preferring the dominant horizontal axis', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 16, y: 16 }));
    addComponent(world, eid, Velocity);
    // Horizontal is dominant (100 > 50)
    addComponent(world, eid, set(Velocity, { x: 100, y: 50 }));

    updateMovement(world, 16);

    const pos = getComponent(world, eid, Position) as PositionData;
    // y must NOT change — vertical component blocked
    expect(pos.y).toBe(16);
    // x should advance toward target cell (16 + 32 = 48)
    expect(pos.x).toBeGreaterThan(16);
    expect(pos.x).toBeLessThan(48);
  });

  it('blocks diagonal velocity, preferring the dominant vertical axis', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 16, y: 16 }));
    addComponent(world, eid, Velocity);
    // Vertical is dominant (100 > 50)
    addComponent(world, eid, set(Velocity, { x: 50, y: 100 }));

    updateMovement(world, 16);

    const pos = getComponent(world, eid, Position) as PositionData;
    // x must NOT change — horizontal component blocked
    expect(pos.x).toBe(16);
    // y should advance toward target cell (16 + 32 = 48)
    expect(pos.y).toBeGreaterThan(16);
    expect(pos.y).toBeLessThan(48);
  });

  it('preserves position precision across small delta steps', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 16, y: 16 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 32, y: 0 }));

    // Simulate 64 frames at 16ms each (= 1024ms total, enough for 32px cell crossing)
    for (let frame = 0; frame < 64; frame++) {
      updateMovement(world, 16);
    }

    const pos = getComponent(world, eid, Position) as PositionData;
    // 32 px/s × 1.024s = 32.768px accumulated, enough to cross (48,16) cell boundary
    expect(pos.x).toBeGreaterThanOrEqual(48);
    expect(pos.x).toBeLessThanOrEqual(64);
    expect(pos.y).toBe(16);
  });

  it('preserves idle position without cell snapping', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    // Off-grid idle position — should NOT snap
    addComponent(world, eid, set(Position, { x: 50, y: 50 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));

    updateMovement(world, 1000);

    const pos = getComponent(world, eid, Position) as PositionData;
    expect(pos.x).toBe(50);
    expect(pos.y).toBe(50);
  });

  it('clears target state when velocity drops to zero', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 16, y: 16 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 32, y: 0 }));

    // Move halfway through a cell
    updateMovement(world, 500);
    let pos = getComponent(world, eid, Position) as PositionData;
    expect(pos.x).toBeGreaterThan(16);
    expect(pos.x).toBeLessThan(48);

    // Stop movement
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
    updateMovement(world, 16);
    pos = getComponent(world, eid, Position) as PositionData;
    const stoppedX = pos.x;

    // Subsequent frames should not move the entity
    updateMovement(world, 16);
    pos = getComponent(world, eid, Position) as PositionData;
    expect(pos.x).toBe(stoppedX);
  });

  it('restarts grid alignment when velocity changes direction', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 16, y: 16 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 32, y: 0 }));

    // Move right partway
    updateMovement(world, 200);

    // Switch to moving down — should trigger re-alignment
    addComponent(world, eid, set(Velocity, { x: 0, y: 32 }));
    updateMovement(world, 16);

    const pos = getComponent(world, eid, Position) as PositionData;
    // Direction change triggers snap to nearest cell center, then move down.
    // x snaps back from ~22.4 to nearest cell center (16).
    // Then y advances 0.512px from 16.
    // x should be at a cell center (mod 32 === 16 within float tolerance)
    const remainder = ((pos.x % 32) + 32) % 32; // handles negative remainder
    expect(Math.abs(remainder - 16)).toBeLessThan(0.1);
    // y should have advanced downward from the cell center
    expect(pos.y).toBeGreaterThan(16);
  });
});

// ---------------------------------------------------------------------------
// Dialog trigger system tests
// ---------------------------------------------------------------------------

describe('GameWorld — dialog trigger system', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
  });

  it('emits NPC_DIALOG_START when player enters interaction radius', () => {
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
        npcId: 'npc-test',
        npcName: 'Greeter',
        dialog: 'Welcome!',
        interactionRadius: 50,
        playerInRange: false,
      }),
    );

    const received: Array<{ type: string }> = [];
    bridge.on('NPC_DIALOG_START', (event) => {
      received.push(event);
    });

    updateDialogTriggers(world, playerEid, bridge);

    expect(received).toHaveLength(1);
    expect(NPCDialog.playerInRange[npcEid]).toBe(true);
  });

  it('does NOT emit NPC_DIALOG_START when player is outside radius', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    const npcEid = addEntity(world);
    addComponent(world, npcEid, Position);
    addComponent(world, npcEid, set(Position, { x: 200, y: 200 }));
    addComponent(world, npcEid, NPCDialog);
    addComponent(
      world,
      npcEid,
      set(NPCDialog, {
        npcId: 'far-npc',
        npcName: 'Distant',
        dialog: 'Too far!',
        interactionRadius: 30,
        playerInRange: false,
      }),
    );

    const received: Array<{ type: string }> = [];
    bridge.on('NPC_DIALOG_START', () => {
      received.push({ type: 'NPC_DIALOG_START' });
    });

    updateDialogTriggers(world, playerEid, bridge);

    expect(received).toHaveLength(0);
  });

  it('emits NPC_DIALOG_END when player leaves interaction radius', () => {
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
        dialog: 'Bye!',
        interactionRadius: 5,
        playerInRange: true,
      }),
    );

    const receivedEnd: Array<{ type: string; npcId: string }> = [];
    bridge.on('NPC_DIALOG_END', (event) => {
      receivedEnd.push(event);
    });

    updateDialogTriggers(world, playerEid, bridge);

    expect(receivedEnd).toHaveLength(1);
  });

  it('safely handles undefined bridge', () => {
    const playerEid = addEntity(world);
    addComponent(world, playerEid, Position);
    addComponent(world, playerEid, set(Position, { x: 0, y: 0 }));

    expect(() => {
      updateDialogTriggers(world, playerEid, undefined as unknown as EngineBridge);
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
      updateDialogTriggers(world, playerEid, bridge);
    }).not.toThrow();
  });
});
