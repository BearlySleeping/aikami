// packages/frontend/engine/src/systems/goap_movement_executor.test.ts
//
// C-402 AC-3: pursue-target goal selection is radius-aware — the goal cell
// must NOT be the target's own cell (A* would route through the player's
// tile, recreating the deadlock the halt rule removes). Instead the goal is
// a walkable cell at roughly the NPC's interaction radius from the target.

import { describe, expect, it } from 'bun:test';
import type { CollisionGrid } from './collision_system.ts';
import { _pickPursueGoal } from './goap_movement_executor.ts';
import { buildTerrainGridFromBoolean } from './terrain_grid.ts';

const ALL_WALKABLE: CollisionGrid = {
  width: 12,
  height: 12,
  tileSize: 32,
  grid: new Array(144).fill(false),
};

describe('goap_movement_executor C-402 radius-aware pursue goal', () => {
  it('picks a walkable cell at ~interactionRadius from the target, not the target cell', () => {
    const terrain = buildTerrainGridFromBoolean(ALL_WALKABLE);
    const goal = _pickPursueGoal({
      fromX: 2,
      fromY: 5,
      targetGx: 5,
      targetGy: 5,
      radiusPx: 48,
      tileSize: 32,
      terrain,
    });

    expect(goal).toBeDefined();
    // Never the target's own cell.
    expect(goal?.x === 5 && goal?.y === 5).toBe(false);
    // Centre distance from the target's centre is roughly the radius
    // (48px) — within one tile band.
    if (goal) {
      const cx = goal.x * 32 + 16;
      const cy = goal.y * 32 + 16;
      const targetCx = 5 * 32 + 16;
      const targetCy = 5 * 32 + 16;
      const dist = Math.hypot(cx - targetCx, cy - targetCy);
      expect(dist).toBeGreaterThanOrEqual(32);
      expect(dist).toBeLessThanOrEqual(80);
    }
  });

  it('prefers a cell on the agent side (closer to the agent)', () => {
    const terrain = buildTerrainGridFromBoolean(ALL_WALKABLE);
    const goal = _pickPursueGoal({
      fromX: 2,
      fromY: 5, // west of the target
      targetGx: 5,
      targetGy: 5,
      radiusPx: 48,
      tileSize: 32,
      terrain,
    });
    // The chosen goal should be on the west side (x < 5) — approaching from
    // the agent's own side keeps the path short.
    expect(goal).toBeDefined();
    if (goal) {
      expect(goal.x).toBeLessThan(5);
    }
  });
});
