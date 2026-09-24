// packages/frontend/engine/src/worker/companion_restore.ts

import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import { logger } from '$logger';
import { COMPANION_COLLISION_MASK, CollisionData } from '../components/collision_data.ts';
import { Companion } from '../components/companion.ts';
import { GridPosition } from '../components/grid_position.ts';
import { PathFollow } from '../components/path_follow.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import {
  getMapPixelBounds,
  getPathfindingGrid,
  insertIntoSpatialGrid,
  isCellBlocked,
  removeFromSpatialGrid,
} from '../systems/collision_system.ts';
import { clampSpawnToWalkable, isPlayerSpawnBlocked } from '../systems/movement_system.ts';
import { clearActorMovement } from '../systems/path_follow_system.ts';
import type { TerrainGrid } from '../systems/terrain_grid.ts';

/** Restore path that requested entity relocation. */
type RestoreSource = 'LOAD_GAME' | 'LOAD_MAP' | 'RESTORE_PLAYER';

type RestoreEntityOptions = {
  world: World;
  playerEntityId: number;
  source: RestoreSource;
};

type RestoreRelocation = {
  entityId: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
};

type SafeCellOptions = {
  cellX: number;
  cellY: number;
  entityId: number;
  mask: number;
  terrain: TerrainGrid;
};

const COMPANION_QUERY_TERMS = [Companion, Position, GridPosition];

/** Stable nearest-to-player order for the eight cells touching the player. */
const ADJACENT_CELL_OFFSETS = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
] as const;

const _cellCenter = (options: { cellX: number; cellY: number; terrain: TerrainGrid }) => ({
  x: options.cellX * options.terrain.tileSize + options.terrain.tileSize / 2,
  y: options.cellY * options.terrain.tileSize + options.terrain.tileSize / 2,
});

const _isSafeCell = (options: SafeCellOptions): boolean => {
  const { cellX, cellY, entityId, mask, terrain } = options;
  if (cellX < 0 || cellY < 0 || cellX >= terrain.width || cellY >= terrain.height) {
    return false;
  }
  const terrainCost = terrain.cost[cellY * terrain.width + cellX] ?? 0;
  return terrainCost !== 0 && !isCellBlocked(cellX, cellY, mask, entityId);
};

const _findAdjacentCell = (options: {
  entityId: number;
  mask: number;
  playerCell: { x: number; y: number } | undefined;
  terrain: TerrainGrid;
}): { x: number; y: number } | undefined => {
  if (!options.playerCell) {
    return undefined;
  }

  for (const offset of ADJACENT_CELL_OFFSETS) {
    const cell = { x: options.playerCell.x + offset.x, y: options.playerCell.y + offset.y };
    const isSafe = _isSafeCell({
      cellX: cell.x,
      cellY: cell.y,
      entityId: options.entityId,
      mask: options.mask,
      terrain: options.terrain,
    });
    if (isSafe) {
      return cell;
    }
  }

  return undefined;
};

const _findRingCell = (options: {
  entityId: number;
  fromCell: { x: number; y: number };
  mask: number;
  playerCell: { x: number; y: number } | undefined;
  terrain: TerrainGrid;
}): { x: number; y: number } | undefined => {
  const center = _cellCenter({
    cellX: options.fromCell.x,
    cellY: options.fromCell.y,
    terrain: options.terrain,
  });
  const clamped = clampSpawnToWalkable(
    center.x,
    center.y,
    (pixelX, pixelY) => {
      const cellX = Math.floor(pixelX / options.terrain.tileSize);
      const cellY = Math.floor(pixelY / options.terrain.tileSize);
      const overlapsPlayer = cellX === options.playerCell?.x && cellY === options.playerCell?.y;
      return (
        overlapsPlayer ||
        !_isSafeCell({
          cellX,
          cellY,
          entityId: options.entityId,
          mask: options.mask,
          terrain: options.terrain,
        })
      );
    },
    {
      width: options.terrain.width * options.terrain.tileSize,
      height: options.terrain.height * options.terrain.tileSize,
    },
  );
  const cell = {
    x: Math.floor(clamped.x / options.terrain.tileSize),
    y: Math.floor(clamped.y / options.terrain.tileSize),
  };
  const isSafe = _isSafeCell({
    cellX: cell.x,
    cellY: cell.y,
    entityId: options.entityId,
    mask: options.mask,
    terrain: options.terrain,
  });
  const overlapsPlayer = cell.x === options.playerCell?.x && cell.y === options.playerCell?.y;
  return isSafe && !overlapsPlayer ? cell : undefined;
};

const _relocateCompanion = (options: {
  entityId: number;
  playerPosition: PositionData | undefined;
  source: RestoreSource;
  terrain: TerrainGrid;
  world: World;
}): RestoreRelocation | undefined => {
  const position = getComponent(options.world, options.entityId, Position) as
    | PositionData
    | undefined;
  const gridPosition = getComponent(options.world, options.entityId, GridPosition) as
    | { x: number; y: number }
    | undefined;
  if (!position || !gridPosition) {
    return undefined;
  }

  const fromCell = { x: gridPosition.x, y: gridPosition.y };
  const mask = CollisionData.mask[options.entityId] ?? COMPANION_COLLISION_MASK;
  const tileSize = options.terrain.tileSize;
  const playerCell = options.playerPosition
    ? {
        x: Math.floor(options.playerPosition.x / tileSize),
        y: Math.floor(options.playerPosition.y / tileSize),
      }
    : undefined;
  const currentIsSafe = _isSafeCell({
    cellX: fromCell.x,
    cellY: fromCell.y,
    entityId: options.entityId,
    mask,
    terrain: options.terrain,
  });
  const overlapsPlayer = fromCell.x === playerCell?.x && fromCell.y === playerCell?.y;
  if (currentIsSafe && !overlapsPlayer) {
    return undefined;
  }
  const targetCell =
    (Companion.recruited[options.entityId] === true
      ? _findAdjacentCell({
          entityId: options.entityId,
          mask,
          playerCell,
          terrain: options.terrain,
        })
      : undefined) ??
    _findRingCell({
      entityId: options.entityId,
      fromCell,
      mask,
      playerCell,
      terrain: options.terrain,
    });
  if (!targetCell) {
    logger.warn('restore:companion-relocation-failed', {
      source: options.source,
      entityId: options.entityId,
      from: fromCell,
    });
    return undefined;
  }

  const target = _cellCenter({
    cellX: targetCell.x,
    cellY: targetCell.y,
    terrain: options.terrain,
  });
  removeFromSpatialGrid(options.entityId);
  addComponent(options.world, options.entityId, set(Position, target));
  addComponent(options.world, options.entityId, set(GridPosition, targetCell));
  insertIntoSpatialGrid(options.entityId);
  clearActorMovement(options.world, options.entityId);
  PathFollow.repathAtMs[options.entityId] = 0;

  const relocation = {
    entityId: options.entityId,
    from: { x: position.x, y: position.y },
    to: target,
  };
  logger.info('restore:companion-relocated', {
    source: options.source,
    entityId: options.entityId,
    companionId: Companion.npcId[options.entityId] ?? '',
    from: relocation.from,
    to: relocation.to,
  });
  return relocation;
};

/**
 * Relocates restored actors that can no longer occupy their saved cells.
 *
 * The player reuses the production full-box spawn clamp. Companions use their
 * own collision mask and the shared footprint-aware pathfinding grid. Recruited
 * companions prefer a safe cell touching the player, then fall back to the same
 * 20-ring nearest-cell search. Unrecruited companions use the ring search around
 * their own saved position. Every relocated companion drops its stale movement
 * path so the next party-follow tick requests a fresh route.
 *
 * @param options - Restore world, player entity, and originating message path.
 * @returns Player and companion relocations, in entity-query order.
 */
export const relocateRestoredEntities = (
  options: RestoreEntityOptions,
): readonly RestoreRelocation[] => {
  const relocations: RestoreRelocation[] = [];
  let playerPosition =
    options.playerEntityId > 0
      ? (getComponent(options.world, options.playerEntityId, Position) as PositionData | undefined)
      : undefined;
  if (playerPosition) {
    const clamped = clampSpawnToWalkable(
      playerPosition.x,
      playerPosition.y,
      isPlayerSpawnBlocked,
      getMapPixelBounds(),
    );
    if (clamped.x !== playerPosition.x || clamped.y !== playerPosition.y) {
      const from = { x: playerPosition.x, y: playerPosition.y };
      logger.debug('restore:player-relocated', {
        source: options.source,
        entityId: options.playerEntityId,
        from,
        to: clamped,
      });
      addComponent(options.world, options.playerEntityId, set(Position, clamped));
      playerPosition = clamped;
      relocations.push({
        entityId: options.playerEntityId,
        from,
        to: clamped,
      });
    }
  }

  const terrain = getPathfindingGrid();
  if (!terrain) {
    return relocations;
  }
  for (const entityId of query(options.world, COMPANION_QUERY_TERMS)) {
    const relocation = _relocateCompanion({
      entityId,
      playerPosition,
      source: options.source,
      terrain,
      world: options.world,
    });
    if (relocation) {
      relocations.push(relocation);
    }
  }

  return relocations;
};
