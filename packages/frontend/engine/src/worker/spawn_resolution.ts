// packages/frontend/engine/src/worker/spawn_resolution.ts
//
// Staging-spawn resolution for LOAD_MAP (C-172/C-138).
//
// When a transition names a `targetSpawnId`, the worker must land the player
// on that authored spawn marker rather than the hardcoded fallback coordinates.
// The marker list and the hash comparison are pure inputs, so this decision
// lives outside the worker's message switch and can be exercised directly.
//
// Extracted from `ecs_worker.ts` (which is at its size-waiver ceiling); the
// call site and behaviour are unchanged.

import { logger } from '$logger';
import type { SpawnPointEntity } from '../assets/map_loader.ts';

/**
 * Resolves the coordinates of the spawn marker with `targetSpawnHash`.
 *
 * Returns `undefined` when there is no marker list or no match, so the caller
 * falls back to the hardcoded target coordinates.
 *
 * @param spawnPointEntities - The new map's spawn markers, if any.
 * @param targetSpawnHash - Hash of the transition's `targetSpawnId`.
 */
export const resolveSpawnInStaging = (
  spawnPointEntities: SpawnPointEntity[] | undefined,
  targetSpawnHash: number,
): { x: number; y: number } | undefined => {
  if (!spawnPointEntities || spawnPointEntities.length === 0) {
    return undefined;
  }

  // Find the matching spawn point entity by spawnHash
  const match = spawnPointEntities.find((sp) => sp.spawnHash === targetSpawnHash);
  if (!match) {
    logger.debug('_resolveSpawnInStaging:no-match', { targetSpawnHash });
    return undefined;
  }

  logger.debug('_resolveSpawnInStaging:resolved', {
    targetSpawnHash,
    x: match.x,
    y: match.y,
  });

  return { x: match.x, y: match.y };
};
