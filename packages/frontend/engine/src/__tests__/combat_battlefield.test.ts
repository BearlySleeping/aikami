// packages/frontend/engine/src/__tests__/combat_battlefield.test.ts
//
// C-515 (Combat-03) battlefield-projection coverage.
//
//   AC-1  the battlefield projects from the live ECS world
//   AC-8  the projection quantizes through the canonical helper (no literal)
//
// Contract: C-515 AC-1, AC-8

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { snapshotBattlefield } from '../combat/combat_battlefield.ts';
import { CombatIdentity, registerCombatIdentityObservers } from '../components/combat_identity.ts';
import { GridPosition, registerGridPositionObservers } from '../components/grid_position.ts';
import {
  getTerrainTileSize,
  isBlocksSight,
  isWalkable,
  resetCollisionGrid,
  setTerrainGrid,
} from '../systems/collision_system.ts';
import { TERRAIN_COST_SCALE } from '../systems/terrain_grid.ts';

// ---------------------------------------------------------------------------
// Fixture — a deliberately NON-SQUARE map (5 × 3) at a non-default tile size
// ---------------------------------------------------------------------------

const MAP_WIDTH = 5;
const MAP_HEIGHT = 3;
const TILE_SIZE = 24;

const SOLID = { x: 1, y: 0 };
const MUD = { x: 2, y: 1 };
const OPAQUE = { x: 3, y: 1 };

const index = (x: number, y: number): number => y * MAP_WIDTH + x;

const installTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    cost[i] = TERRAIN_COST_SCALE;
  }
  cost[index(SOLID.x, SOLID.y)] = 0; // impassable
  cost[index(MUD.x, MUD.y)] = TERRAIN_COST_SCALE * 2; // weighted terrain
  blocksSight[index(OPAQUE.x, OPAQUE.y)] = 1;

  setTerrainGrid({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tileSize: TILE_SIZE,
    cost,
    blocksSight,
  });
};

const createCombatant = (
  targetWorld: World,
  combatantId: string,
  cell: { x: number; y: number },
): number => {
  const eid = addEntity(targetWorld);
  addComponent(targetWorld, eid, CombatIdentity);
  addComponent(targetWorld, eid, set(CombatIdentity, { combatantId }));
  addComponent(targetWorld, eid, GridPosition);
  addComponent(targetWorld, eid, set(GridPosition, { x: cell.x, y: cell.y }));
  return eid;
};

let world: World;

beforeEach(() => {
  world = createWorld();
  registerCombatIdentityObservers(world);
  registerGridPositionObservers(world);
  installTerrain();
});

// The terrain/spatial grid is a MODULE singleton — restore it so no later test
// file inherits this fixture's map (C-379's `resetCollisionGrid`).
afterEach(() => {
  resetCollisionGrid();
});

// ---------------------------------------------------------------------------
// AC-1 — projection
// ---------------------------------------------------------------------------

describe('C-515 AC-1: snapshotBattlefield projects the live ECS world', () => {
  it('returns schema-shaped dimensions and flat row-major grids', () => {
    const battlefield = snapshotBattlefield(world);

    expect(battlefield.width).toBe(MAP_WIDTH);
    expect(battlefield.height).toBe(MAP_HEIGHT);
    expect(battlefield.movementCost).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
    expect(battlefield.blocksSight).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
    // Non-square map: a transposition bug would still produce 15 entries.
    expect(battlefield.movementCost?.[index(SOLID.x, SOLID.y)]).toBe(0);
    expect(battlefield.movementCost?.[index(MUD.x, MUD.y)]).toBe(2);
  });

  it('agrees with isWalkable / isBlocksSight cell by cell', () => {
    const battlefield = snapshotBattlefield(world);
    const tileSize = getTerrainTileSize();
    expect(tileSize).toBe(TILE_SIZE);

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const i = index(x, y);
        const centreX = x * tileSize + tileSize / 2;
        const centreY = y * tileSize + tileSize / 2;
        expect(battlefield.movementCost?.[i] !== 0).toBe(isWalkable(centreX, centreY));
        expect(battlefield.blocksSight?.[i]).toBe(isBlocksSight(x, y));
      }
    }
  });

  it('lists terrain-solid and occupied cells in blockedCells', () => {
    createCombatant(world, 'hero', { x: 4, y: 2 });
    const battlefield = snapshotBattlefield(world);

    expect(battlefield.blockedCells).toContainEqual({ x: SOLID.x, y: SOLID.y });
    expect(battlefield.blockedCells).toContainEqual({ x: 4, y: 2 });
  });

  it('keeps blocksSight terrain-derived only — occupants never make a cell opaque', () => {
    const occupant = { x: 0, y: 2 };
    createCombatant(world, 'hero', occupant);
    const battlefield = snapshotBattlefield(world);

    // The occupant's cell is blocked for movement but not for line of sight.
    expect(battlefield.blockedCells).toContainEqual(occupant);
    expect(battlefield.blocksSight?.[index(occupant.x, occupant.y)]).toBe(false);
    // The one opaque cell is opaque because of terrain, and it is also solid
    // for movement only where the terrain says so.
    expect(battlefield.blocksSight?.[index(OPAQUE.x, OPAQUE.y)]).toBe(true);
    expect(battlefield.movementCost?.[index(OPAQUE.x, OPAQUE.y)]).toBeGreaterThan(0);
  });

  it('is deterministic and does not mutate the ECS world', () => {
    const eid = createCombatant(world, 'hero', { x: 4, y: 2 });
    const beforeX = GridPosition.x[eid];
    const beforeY = GridPosition.y[eid];

    const first = snapshotBattlefield(world);
    const second = snapshotBattlefield(world);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(GridPosition.x[eid]).toBe(beforeX);
    expect(GridPosition.y[eid]).toBe(beforeY);
  });

  it('marks every cell outside the grid as absent from the flat arrays', () => {
    const battlefield = snapshotBattlefield(world);
    // A 5×3 grid holds exactly 15 cells — an out-of-bounds cell has no entry,
    // which the pure spatial module treats as impassable.
    expect(battlefield.movementCost).toHaveLength(15);
    expect(battlefield.movementCost?.[index(4, 2)]).toBeGreaterThan(0);
    expect(battlefield.movementCost?.[MAP_WIDTH * MAP_HEIGHT]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-8 — the projection introduces no tile-size literal
// ---------------------------------------------------------------------------

describe('C-515 AC-8: the projection uses the canonical quantizer', () => {
  it('declares no hardcoded tile-size literal', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '../combat/combat_battlefield.ts'),
      'utf8',
    );
    expect(/\b32\b/.test(source)).toBe(false);
    expect(source).toContain('worldPixelToCell');
    expect(source).toContain('getTerrainTileSize');
  });
});
