// packages/frontend/engine/src/components/enemy.ts
import type { World } from 'bitecs';
import { observe, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Enemy — tag component marking an entity as a hostile combat encounter
//
// Contract C-144: The encounter system queries entities with this tag to
// detect spatial overlap with the player and trigger combat transitions.
// ---------------------------------------------------------------------------

/** SoA storage for enemy tag. Indexed by entity ID. */
export const Enemy = {
  /** Whether this entity is a hostile enemy. */
  isActive: [] as boolean[],
  /**
   * The spawn point ID from the Tiled tilemap.
   * Used for defeated-enemy persistence across map transitions.
   *
   * Contract: C-147 Progression & Persistence
   */
  spawnId: [] as string[],
};

/**
 * Registers onSet observer for the Enemy component on the given world.
 * Must be called once per world before any entity uses Enemy.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerEnemyObservers = (world: World): void => {
  observe(world, onSet(Enemy), (eid: number, params: { isActive: boolean; spawnId?: string }) => {
    Enemy.isActive[eid] = params.isActive;
    if (params.spawnId !== undefined) {
      Enemy.spawnId[eid] = params.spawnId;
    }
  });
};
