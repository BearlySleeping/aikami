// packages/frontend/engine/src/systems/path_follow_system.test.ts
//
// C-379 AC-7: PathFollow writes Velocity toward waypoints; the system is
// the single locomotion executor.
//
// - A companion placed behind a wall from the player reaches its formation
//   slot without passing through the wall.
// - Path completion detaches the component and zeroes velocity.
// - An empty path is a no-op.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, set } from 'bitecs';
import { Companion, registerCompanionObservers } from '../components/companion.ts';
import { NPCDialog, registerNPCDialogObservers } from '../components/npc_dialog.ts';
import { PathFollow, registerPathFollowObservers } from '../components/path_follow.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { findPath } from '../math/astar.ts';
import type { CollisionGrid } from './collision_system.ts';
import { resetCollisionGrid, setCollisionGrid } from './collision_system.ts';
import { updateMovement } from './movement_system.ts';
import {
  getNpcHaltReason,
  hasActivePath,
  resetNpcHaltReasons,
  updatePathFollow,
} from './path_follow_system.ts';

const ALL_WALKABLE: CollisionGrid = {
  width: 10,
  height: 10,
  tileSize: 32,
  grid: new Array(100).fill(false),
};

describe('path_follow_system (C-379 AC-7)', () => {
  let world: World;

  // High, unique eid ranges per test avoid SoA collisions with other test
  // files (module-global component arrays; bitecs worlds recycle eids).

  beforeEach(() => {
    world = createWorld();
    registerPositionObservers(world);
    registerVelocityObservers(world);
    registerPathFollowObservers(world);
    registerNPCDialogObservers(world);
    registerCompanionObservers(world);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  /** Creates a fresh entity and returns its real eid. */
  const nextEid = (): number => addEntity(world);

  const attachPath = (eid: number, waypoints: number[], speed = 80, arriveRadius = 4): void => {
    addComponent(
      world,
      eid,
      set(PathFollow, {
        waypoints: new Float32Array(waypoints),
        index: 1,
        length: waypoints.length / 2,
        speed,
        repathAtMs: 0,
        arriveRadius,
      }),
    );
  };

  it('writes Velocity toward the current waypoint', () => {
    setCollisionGrid(ALL_WALKABLE);
    const eid = nextEid();
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 160, y: 160 })); // tile (5,5) centre
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
    // Goal waypoint due east: same row, tile (7,5) centre = (240, 160).
    attachPath(eid, [160, 160, 240, 160], 80);

    updatePathFollow(world, 100); // 0.1s

    const vel = getComponent(world, eid, Velocity) as { x: number; y: number } | undefined;
    expect(vel).toBeDefined();
    if (vel) {
      // Direction is +x (waypoint east). Magnitude ≈ speed (80 px/s).
      expect(vel.x).toBeGreaterThan(0);
      expect(Math.abs(vel.y)).toBeLessThanOrEqual(0.001); // exactly east
      expect(Math.hypot(vel.x, vel.y)).toBeCloseTo(80, 3);
    }
  });

  it('reaches the final waypoint, zeroes velocity and detaches PathFollow', () => {
    setCollisionGrid(ALL_WALKABLE);
    const eid = nextEid();
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 160, y: 160 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 50, y: 0 }));
    // Tiny path: next waypoint 8px away, arriveRadius 8 → reached in one step.
    attachPath(eid, [160, 160, 168, 160], 80, 8);

    // Run the full loop — path-follow writes velocity, movement resolves it.
    let frames = 0;
    while (hasActivePath(world, eid) && frames < 100) {
      updatePathFollow(world, 100);
      updateMovement(world, 100);
      frames++;
    }

    const vel = getComponent(world, eid, Velocity) as { x: number; y: number } | undefined;
    expect(vel).toBeDefined();
    if (vel) {
      expect(vel.x).toBe(0);
      expect(vel.y).toBe(0);
    }
    // Component detached — no live path remains.
    expect(hasActivePath(world, eid)).toBe(false);
    expect(frames).toBeLessThan(100);
  });

  it('companion routes around a wall to its formation slot (AC-7)', () => {
    // 10×10 grid. Wall column at x=5, y=5..8 blocks the straight line from
    // (3,5) to (7,5); row 4 stays open to route around. The goal is two
    // columns past the wall so the 32px entity box has clearance while
    // turning (a corner-adjacent goal pins the box — grid-aligned
    // waypoint movement with a 2-row/2-column box, C-379 Open Questions:
    // path smoothing is deferred).
    const grid: CollisionGrid = {
      width: 10,
      height: 10,
      tileSize: 32,
      grid: new Array(100).fill(false),
    };
    for (let y = 5; y < 9; y++) {
      grid.grid[y * 10 + 5] = true;
    }
    setCollisionGrid(grid);

    // A* waypoints from (3,5) to (7,5) must route around the wall — never
    // through it. This is the unit-level integration the AC-7 demands:
    // A* produces waypoints, PathFollow writes Velocity, updateMovement
    // resolves them.
    const result = findPath({
      grid: {
        width: 10,
        height: 10,
        cost: Uint8Array.from(grid.grid.map((b) => (b ? 0 : 16))),
      },
      start: { x: 3, y: 5 },
      goal: { x: 7, y: 5 },
    });
    expect(result.path.length).toBeGreaterThan(0);
    // The path must not include the wall column x=5 for rows 5..8.
    for (const cell of result.path) {
      if (cell.x === 5 && cell.y >= 5 && cell.y <= 8) {
        throw new Error(`path crosses the wall at (${cell.x},${cell.y})`);
      }
    }

    const eid = nextEid();
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 3 * 32 + 16, y: 5 * 32 + 16 })); // tile (3,5)
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));

    const waypoints = new Float32Array(result.path.length * 2);
    for (let i = 0; i < result.path.length; i++) {
      waypoints[i * 2] = result.path[i].x * 32 + 16;
      waypoints[i * 2 + 1] = result.path[i].y * 32 + 16;
    }
    addComponent(
      world,
      eid,
      set(PathFollow, {
        waypoints,
        index: 1,
        length: result.path.length,
        speed: 80,
        repathAtMs: 0,
        arriveRadius: 6,
      }),
    );

    // Run the sim loop until the path completes.
    let frames = 0;
    while (hasActivePath(world, eid) && frames < 2000) {
      updatePathFollow(world, 100);
      updateMovement(world, 100);
      frames++;
    }

    const pos = getComponent(world, eid, Position) as { x: number; y: number };
    // Reached the formation slot tile (7,5) centre, ± arrival radius.
    expect(Math.abs(pos.x - (7 * 32 + 16))).toBeLessThanOrEqual(10);
    expect(Math.abs(pos.y - (5 * 32 + 16))).toBeLessThanOrEqual(10);
    expect(frames).toBeLessThan(2000);
  });

  it('empty path is a no-op and clears any existing motion', () => {
    setCollisionGrid(ALL_WALKABLE);
    const eid = nextEid();
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 160, y: 160 }));
    addComponent(world, eid, Velocity);
    // Start with NON-zero velocity — the system must clear it when the
    // path is empty (a zero-initialized test proved nothing; CodeRabbit
    // review, C-379).
    addComponent(world, eid, set(Velocity, { x: 50, y: -30 }));
    attachPath(eid, [], 80, 4);

    updatePathFollow(world, 100);

    const vel = getComponent(world, eid, Velocity) as { x: number; y: number } | undefined;
    expect(vel).toBeDefined();
    if (vel) {
      // Motion cleared to zero.
      expect(vel.x).toBe(0);
      expect(vel.y).toBe(0);
    }
    expect(hasActivePath(world, eid)).toBe(false);
  });

  // ---------------------------------------------------------------------
  // C-402 AC-3: NPCs halt at their interaction radius
  // ---------------------------------------------------------------------

  describe('C-402 AC-3: NPC halt rule at interaction radius', () => {
    beforeEach(() => {
      // CodeRabbit review (C-402): stale module-level halt state from a
      // previous test must not make this suite's wait-for-halt loops pass
      // vacuously — an old 'player_proximity' entry for a recycled eid
      // would break the loop on frame 0 without the NPC ever moving.
      resetNpcHaltReasons();
    });

    // The halt-rule tests create real bitecs entities (eids 1..N) and write
    // module-global SoA slots (Position, Velocity, PathFollow, NPCDialog,
    // Companion). Those slots are shared across ALL test files — a stale
    // Companion.recruited[2] here would make turn_manager's low-eid combat
    // participant look like a companion and silently skip TURN_CHANGED.
    // Delete the slots on the way out so later files start clean.
    afterEach(() => {
      for (let eid = 1; eid <= 8; eid++) {
        delete Position.x[eid];
        delete Position.y[eid];
        delete Velocity.x[eid];
        delete Velocity.y[eid];
        delete PathFollow.waypoints[eid];
        delete PathFollow.index[eid];
        delete PathFollow.length[eid];
        delete PathFollow.speed[eid];
        delete PathFollow.repathAtMs[eid];
        delete PathFollow.arriveRadius[eid];
        delete NPCDialog.npcId[eid];
        delete NPCDialog.npcName[eid];
        delete NPCDialog.dialog[eid];
        delete NPCDialog.interactionRadius[eid];
        delete NPCDialog.playerInRange[eid];
        delete NPCDialog.isVendor[eid];
        delete NPCDialog.vendorInventory[eid];
        delete Companion.npcId[eid];
        delete Companion.approval[eid];
        delete Companion.recruited[eid];
      }
    });

    it('an NPC pathing toward the player stops at interactionRadius with player_proximity', () => {
      setCollisionGrid(ALL_WALKABLE);

      // Player entity at tile (5,5) centre (160,160).
      const playerEid = addEntity(world);
      addComponent(world, playerEid, Position);
      addComponent(world, playerEid, set(Position, { x: 160, y: 160 }));

      // NPC with NPCDialog(interactionRadius: 48) two tiles west, pathed
      // toward the player's tile.
      const npcEid = nextEid();
      addComponent(world, npcEid, Position);
      addComponent(world, npcEid, set(Position, { x: 96, y: 160 })); // tile (3,5)
      addComponent(world, npcEid, Velocity);
      addComponent(world, npcEid, set(Velocity, { x: 0, y: 0 }));
      addComponent(world, npcEid, NPCDialog);
      addComponent(
        world,
        npcEid,
        set(NPCDialog, {
          npcId: 'halt_npc',
          npcName: 'Halt NPC',
          dialog: 'Hi',
          interactionRadius: 48,
          playerInRange: false,
          isVendor: false,
          vendorInventory: '',
        }),
      );
      // Path INTO the player's tile — the halt rule must stop the NPC
      // before it enters.
      attachPath(npcEid, [96, 160, 160, 160], 60, 6);

      // Run the full locomotion + movement loop until the NPC halts at
      // the interaction radius. The path stays attached while halted (the
      // GOAP executor skips entities with active paths), so break on the
      // halt reason rather than waiting for path completion.
      let frames = 0;
      while (frames < 2000 && getNpcHaltReason(npcEid) !== 'player_proximity') {
        updatePathFollow(world, 100, playerEid);
        updateMovement(world, 100);
        frames++;
      }

      const pos = getComponent(world, npcEid, Position) as { x: number; y: number };
      const distance = Math.hypot(pos.x - 160, pos.y - 160);
      // The NPC actually MOVED toward the player before halting — the
      // reset in beforeEach guarantees this cannot pass on stale halt
      // state (CodeRabbit review, C-402). Start x was 96 (tile 3).
      expect(pos.x).toBeGreaterThan(96);
      // Halted at conversational distance: >= interactionRadius (48) and
      // < interactionRadius + tileSize (48 + 32 = 80). Never entered the
      // player's tile.
      expect(distance).toBeGreaterThanOrEqual(48);
      expect(distance).toBeLessThan(48 + 32);
      expect(getNpcHaltReason(npcEid)).toBe('player_proximity');
      // Still within the sim bound — did not spin forever.
      expect(frames).toBeLessThan(2000);
    });

    it("releases a halted NPC's pursue path after the corridor-yield threshold", () => {
      // CodeRabbit review (C-402): a halted NPC must not occupy a corridor
      // indefinitely — after HALT_YIELD_THRESHOLD_MS of continuous halt
      // the PathFollow component is released so the GOAP executor can
      // re-task the NPC (its within-radius gate prevents an immediate
      // re-request of the same pursue goal); the halt reason is preserved
      // for observability.
      setCollisionGrid(ALL_WALKABLE);

      const playerEid = addEntity(world);
      addComponent(world, playerEid, Position);
      addComponent(world, playerEid, set(Position, { x: 160, y: 160 }));

      const npcEid = nextEid();
      addComponent(world, npcEid, Position);
      addComponent(world, npcEid, set(Position, { x: 96, y: 160 })); // tile (3,5)
      addComponent(world, npcEid, Velocity);
      addComponent(world, npcEid, set(Velocity, { x: 0, y: 0 }));
      addComponent(world, npcEid, NPCDialog);
      addComponent(
        world,
        npcEid,
        set(NPCDialog, {
          npcId: 'yield_npc',
          npcName: 'Yield NPC',
          dialog: 'Hi',
          interactionRadius: 48,
          playerInRange: false,
          isVendor: false,
          vendorInventory: '',
        }),
      );
      attachPath(npcEid, [96, 160, 160, 160], 60, 6);

      // Tick past the 5000ms yield threshold while the NPC is halted at
      // the radius (0.1s sim per frame — 60 frames = 6s).
      for (let frame = 0; frame < 60; frame++) {
        updatePathFollow(world, 100, playerEid);
        updateMovement(world, 100);
      }

      // Path released — the halted NPC no longer holds a live path toward
      // the player; the halt reason is preserved for observability.
      expect(hasActivePath(world, npcEid)).toBe(false);
      expect(getNpcHaltReason(npcEid)).toBe('player_proximity');
    });

    it('a party follower (Companion) is NOT halted by the player proximity rule', () => {
      // OQ-1: party followers carry NPCDialog in this codebase (spawned via
      // _spawnNpc), so the halt rule must ALSO exclude Companion entities —
      // otherwise a recruited follower could never reach its formation slot
      // behind the player (which sits inside the interaction radius).
      setCollisionGrid(ALL_WALKABLE);

      const playerEid = addEntity(world);
      addComponent(world, playerEid, Position);
      addComponent(world, playerEid, set(Position, { x: 160, y: 160 }));

      // Companion RIGHT NEXT to the player (inside any sane radius) with a
      // short path — must keep steering, never player_proximity-halt.
      const companionEid = nextEid();
      addComponent(world, companionEid, Position);
      addComponent(world, companionEid, set(Position, { x: 160, y: 190 })); // 30px away
      addComponent(world, companionEid, Velocity);
      addComponent(world, companionEid, set(Velocity, { x: 0, y: 0 }));
      addComponent(world, companionEid, NPCDialog);
      addComponent(
        world,
        companionEid,
        set(NPCDialog, {
          npcId: 'companion',
          npcName: 'Follower',
          dialog: 'Hi',
          interactionRadius: 48,
          playerInRange: false,
          isVendor: false,
          vendorInventory: '',
        }),
      );
      addComponent(world, companionEid, Companion);
      addComponent(
        world,
        companionEid,
        set(Companion, { npcId: 'companion', approval: 0, recruited: true }),
      );
      attachPath(companionEid, [160, 190, 160, 160], 60, 6);

      updatePathFollow(world, 100, playerEid);
      updateMovement(world, 100);

      // The companion is 30px from the player (inside radius 48) yet the
      // rule must not fire — it steers toward the waypoint instead.
      const vel = getComponent(world, companionEid, Velocity) as
        | { x: number; y: number }
        | undefined;
      expect(getNpcHaltReason(companionEid)).not.toBe('player_proximity');
      expect(vel).toBeDefined();
      if (vel) {
        expect(vel.x !== 0 || vel.y !== 0).toBe(true);
      }
    });
  });
});
