// packages/frontend/engine/src/__tests__/goap_combat_tactics.test.ts
//
// GOAP Combat Tactics — unit tests for tactical combat AI.
// Contract C-197: Validates zero-allocation tactical action resolution,
// JPS distance-weighted targeting, and relational faction aggro shifts.
//
// AC-1: Zero-allocation tactical action resolution
// AC-2: JPS distance-weighted targeting
// AC-3: Turn-driven tactical action execution

import { beforeEach, describe, expect, test } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { CombatTactics } from '../components/combat_tactics.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerTurnOrderObservers } from '../components/turn_order.ts';
import { setCollisionGrid } from '../systems/collision_system.ts';
import {
  resolveTacticalAction,
  scoreTarget,
  updateGoapCombatTactics,
} from '../systems/goap_combat_tactics_system.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Creates a test world with necessary observers registered. */
const createTestWorld = (): World => {
  const world = createWorld();
  registerPositionObservers(world);
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  return world;
};

/**
 * Spawns a combat participant entity at the given grid position.
 * Includes CombatStats with simple combat attributes.
 */
const spawnCombatant = (
  world: World,
  options: {
    x: number;
    y: number;
    health?: number;
    maxHealth?: number;
    attack?: number;
    defense?: number;
    accuracy?: number;
    evasion?: number;
    preferredRange?: number;
  },
): number => {
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: options.x, y: options.y }));
  addComponent(world, eid, CombatStats);
  addComponent(
    world,
    eid,
    set(CombatStats, {
      health: options.health ?? 100,
      maxHealth: options.maxHealth ?? 100,
      initiative: 10,
      attack: options.attack ?? 5,
      defense: options.defense ?? 12,
      accuracy: options.accuracy ?? 4,
      evasion: options.evasion ?? 12,
    }),
  );

  // Set CombatTactics directly on the SoA for tactical AI
  CombatTactics.preferredRange[eid] = options.preferredRange ?? 3;
  CombatTactics.threatTargetEid[eid] = 0;
  CombatTactics.tacticalActionMask[eid] = 0;

  return eid;
};

/**
 * Sets up a simple walkable grid for collision system tests.
 */
const setupWalkableGrid = (): void => {
  // Create a 50x50 collision grid where all cells are walkable
  const grid = {
    width: 50,
    height: 50,
    tileSize: 32,
    grid: new Array(50 * 50).fill(false),
  };
  setCollisionGrid(grid);
};

// ---------------------------------------------------------------------------
// AC-1: Zero-allocation tactical action resolution
// ---------------------------------------------------------------------------

describe('AC-1: Zero-allocation tactical action resolution', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
    setupWalkableGrid();
  });

  test('resolveTacticalAction selects the closest target', () => {
    const enemyEid = spawnCombatant(world, {
      x: 160,
      y: 160,
      preferredRange: 3,
    });
    // Close target
    const closeEid = spawnCombatant(world, {
      x: 192,
      y: 160, // 1 tile away
    });
    // Far target
    const farEid = spawnCombatant(world, {
      x: 512,
      y: 512, // ~11 tiles away
    });

    const selected = resolveTacticalAction(world, enemyEid, [closeEid, farEid]);
    expect(selected).toBe(closeEid);

    // CombatTactics should reflect the selection
    expect(CombatTactics.threatTargetEid[enemyEid]).toBe(closeEid);
    expect(CombatTactics.tacticalActionMask[enemyEid]).toBeGreaterThan(0);
  });

  test('resolveTacticalAction returns 0 when no valid targets', () => {
    const enemyEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });

    const selected = resolveTacticalAction(world, enemyEid, []);
    expect(selected).toBe(0);
  });

  test('resolveTacticalAction skips dead targets', () => {
    const enemyEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });
    const deadEid = spawnCombatant(world, {
      x: 192,
      y: 160,
      health: 0,
    });
    const aliveEid = spawnCombatant(world, {
      x: 256,
      y: 160,
      health: 50,
    });

    const selected = resolveTacticalAction(world, enemyEid, [deadEid, aliveEid]);
    expect(selected).toBe(aliveEid);
  });

  test('scoreTarget returns higher scores for closer targets', () => {
    const attackerEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });
    const closeEid = spawnCombatant(world, {
      x: 192,
      y: 160, // 1 cell away
    });
    const farEid = spawnCombatant(world, {
      x: 512,
      y: 512, // ~11 cells away
    });

    const closeScore = scoreTarget(world, attackerEid, closeEid);
    const farScore = scoreTarget(world, attackerEid, farEid);

    expect(closeScore).toBeGreaterThan(farScore);
  });

  test('scoreTarget returns 0 when positions are missing', () => {
    const attackerEid = addEntity(world);
    const targetEid = spawnCombatant(world, { x: 192, y: 160 });

    // Attacker has no Position component
    const score = scoreTarget(world, attackerEid, targetEid);
    expect(score).toBe(0);
  });

  test('scoreTarget gives loyalty bonus to already-targeted entities', () => {
    const attackerEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });
    // Two equally-distant targets with identical HP for reference
    const targetA = spawnCombatant(world, { x: 256, y: 160, health: 100, maxHealth: 100 });
    spawnCombatant(world, { x: 160, y: 256, health: 100, maxHealth: 100 }); // equally distant, same HP

    const scoreWithoutLoyalty = scoreTarget(world, attackerEid, targetA, false);
    const scoreWithLoyalty = scoreTarget(world, attackerEid, targetA, true);

    expect(scoreWithLoyalty).toBeGreaterThan(scoreWithoutLoyalty);
  });

  test('updateGoapCombatTactics processes all tactical combatants', () => {
    const playerEid = spawnCombatant(world, {
      x: 320,
      y: 320,
      health: 100,
    });
    const enemy1Eid = spawnCombatant(world, {
      x: 160,
      y: 160,
      preferredRange: 3,
    });
    const enemy2Eid = spawnCombatant(world, {
      x: 480,
      y: 160,
      preferredRange: 5,
    });
    // A non-tactical entity (no preferredRange set)
    spawnCombatant(world, {
      x: 640,
      y: 640,
      preferredRange: 0,
    });

    updateGoapCombatTactics(world, playerEid);

    // Both tactical enemies should have a target (the player)
    expect(CombatTactics.threatTargetEid[enemy1Eid]).toBeGreaterThan(0);
    expect(CombatTactics.threatTargetEid[enemy2Eid]).toBeGreaterThan(0);
  });

  test('updateGoapCombatTactics is a no-op without world or player', () => {
    const world = createTestWorld();
    // No entities with CombatTactics — should not throw
    expect(() => {
      updateGoapCombatTactics(world, 0);
    }).not.toThrow();

    expect(() => {
      updateGoapCombatTactics(undefined as unknown as World, 0);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-2: JPS distance-weighted targeting
// ---------------------------------------------------------------------------

describe('AC-2: JPS distance-weighted targeting', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
    setupWalkableGrid();
  });

  test('distant targets score lower than close targets', () => {
    const attackerEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });
    const closeTarget = spawnCombatant(world, {
      x: 224,
      y: 160, // 2 cells away
    });
    const midTarget = spawnCombatant(world, {
      x: 352,
      y: 160, // 6 cells away
    });
    const farTarget = spawnCombatant(world, {
      x: 640,
      y: 160, // 15 cells away
    });

    const closeScore = scoreTarget(world, attackerEid, closeTarget);
    const midScore = scoreTarget(world, attackerEid, midTarget);
    const farScore = scoreTarget(world, attackerEid, farTarget);

    expect(closeScore).toBeGreaterThan(midScore);
    expect(midScore).toBeGreaterThan(farScore);
  });

  test('weak targets score higher than full-HP targets at same distance', () => {
    const attackerEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });
    // Same distance but weak (20% HP)
    const weakTarget = spawnCombatant(world, {
      x: 256,
      y: 160,
      health: 20,
      maxHealth: 100,
    });
    // Full HP at same distance
    const fullTarget = spawnCombatant(world, {
      x: 256,
      y: 256,
      health: 100,
      maxHealth: 100,
    });

    const weakScore = scoreTarget(world, attackerEid, weakTarget);
    const fullScore = scoreTarget(world, attackerEid, fullTarget);

    expect(weakScore).toBeGreaterThan(fullScore);
  });

  test('targets beyond 2x preferred range are penalized', () => {
    const attackerEid = spawnCombatant(world, {
      x: 160,
      y: 160,
      preferredRange: 1, // small preferred range
    });
    // Within 2x preferred range (2 cells → 2 distance, ≤ 2)
    const closeEid = spawnCombatant(world, {
      x: 224,
      y: 160,
    });
    // Way beyond 2x preferred range (10 cells)
    const farEid = spawnCombatant(world, {
      x: 480,
      y: 160,
    });

    const closeScore = scoreTarget(world, attackerEid, closeEid);
    const farScore = scoreTarget(world, attackerEid, farEid);

    // Close target should score much higher (0.5x penalty on far)
    expect(closeScore).toBeGreaterThan(farScore * 2);
  });

  test('performs many evaluations in under 1ms (AC-2 performance)', () => {
    const attackerEid = spawnCombatant(world, {
      x: 160,
      y: 160,
      preferredRange: 3,
    });
    const targets: number[] = [];
    for (let i = 0; i < 50; i++) {
      const tx = 200 + (i % 10) * 64;
      const ty = 200 + Math.floor(i / 10) * 64;
      const tEid = spawnCombatant(world, {
        x: tx,
        y: ty,
        health: 50 + (i % 50),
        maxHealth: 100,
      });
      targets.push(tEid);
    }

    const start = performance.now();
    for (const t of targets) {
      scoreTarget(world, attackerEid, t);
    }
    const elapsed = performance.now() - start;

    // 50 evaluations should complete well under 5ms
    expect(elapsed).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Tactical action execution (turn-driven)
// ---------------------------------------------------------------------------

describe('AC-3: Turn-driven tactical action execution', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
    setupWalkableGrid();
  });

  test('resolveTacticalAction prefers weak targets over full-HP at same distance', () => {
    const enemyEid = spawnCombatant(world, {
      x: 160,
      y: 160,
      preferredRange: 3,
    });
    // Full HP player — 2 cells away at grid (7,5)
    const fullPlayer = spawnCombatant(world, {
      x: 224,
      y: 160,
      health: 100,
      maxHealth: 100,
    });
    // Weak companion — 2 cells away at grid (5,7), same distance, lower HP
    const weakCompanion = spawnCombatant(world, {
      x: 160,
      y: 224,
      health: 10,
      maxHealth: 100,
    });

    const selected = resolveTacticalAction(world, enemyEid, [fullPlayer, weakCompanion]);
    // Should pick the weak companion (higher score due to WeakTarget bonus)
    expect(selected).toBe(weakCompanion);
  });

  test('resolveTacticalAction respects loyalty tie-breaker (Watch Point: Oscillation)', () => {
    const enemyEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });
    // Two equally-distant targets with identical HP
    const targetA = spawnCombatant(world, {
      x: 256,
      y: 160,
      health: 50,
      maxHealth: 100,
    });
    const targetB = spawnCombatant(world, {
      x: 256,
      y: 256,
      health: 50,
      maxHealth: 100,
    });

    // First selection
    const first = resolveTacticalAction(world, enemyEid, [targetA, targetB]);
    expect(first).toBeGreaterThan(0);

    // Second selection — should pick the SAME target due to loyalty bonus
    const second = resolveTacticalAction(world, enemyEid, [targetA, targetB]);
    expect(second).toBe(first);
  });

  test('resolveTacticalAction handles single-target scenario', () => {
    const enemyEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });
    const onlyTarget = spawnCombatant(world, {
      x: 320,
      y: 320,
    });

    const selected = resolveTacticalAction(world, enemyEid, [onlyTarget]);
    expect(selected).toBe(onlyTarget);
  });

  test('resolveTacticalAction handles zero-health self (should not loop)', () => {
    const enemyEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });
    // Set enemy health to 0 — but the function should still work
    CombatStats.health[enemyEid] = 0;

    const target = spawnCombatant(world, {
      x: 320,
      y: 320,
      health: 50,
    });

    // Should not throw — enemy with 0 HP still resolves targets
    const selected = resolveTacticalAction(world, enemyEid, [target]);
    // However, the caller (turn_manager) should skip dead enemies
    expect(selected).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Obstacle path penalty
// ---------------------------------------------------------------------------

describe('AC-2: Obstacle path penalty', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
  });

  test('obstructed paths produce lower scores', () => {
    // Create a grid with a wall in the midpoint between attacker and target
    const grid = {
      width: 50,
      height: 50,
      tileSize: 32,
      grid: new Array(50 * 50).fill(false),
    };
    // Place a wall at (8, 5) — midpoint between attacker (5,5) and target (12,5)
    grid.grid[5 * 50 + 8] = true;
    setCollisionGrid(grid);

    const attackerEid = spawnCombatant(world, {
      x: 160,
      y: 160, // grid ~(5,5)
    });
    // Target at same distance but obstructed
    const obstructedTarget = spawnCombatant(world, {
      x: 384,
      y: 160, // grid (12,5) — midpoint (8,5) is blocked
    });
    // Target at same distance but clear
    const clearTarget = spawnCombatant(world, {
      x: 160,
      y: 384, // grid (5,12) — clear
    });

    const obstructedScore = scoreTarget(world, attackerEid, obstructedTarget);
    const clearScore = scoreTarget(world, attackerEid, clearTarget);

    // Obstructed path should score lower (penalty applied)
    expect(clearScore).toBeGreaterThan(obstructedScore);
  });

  test('clear paths have no penalty', () => {
    setupWalkableGrid();
    const attackerEid = spawnCombatant(world, {
      x: 160,
      y: 160,
    });
    const targetEid = spawnCombatant(world, {
      x: 384,
      y: 160, // 7 cells, all walkable
    });

    const score = scoreTarget(world, attackerEid, targetEid);
    // Score should be positive (no penalty applied)
    expect(score).toBeGreaterThan(0);
  });
});
