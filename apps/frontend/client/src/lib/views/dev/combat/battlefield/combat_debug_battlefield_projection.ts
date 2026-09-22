// apps/frontend/client/src/lib/views/dev/combat/battlefield/combat_debug_battlefield_projection.ts
//
// READ-ONLY projections from authoritative combat state to the engine's
// generic debug-scene vocabulary (see `@aikami/frontend/engine`
// `DebugSceneSpec`). Nothing here calculates mechanics, pathfinding, or
// outcomes: it maps `CombatState` (combatants, battlefield, environment) and
// the declarative scenario battlefield into presentation data only.
//
// The engine paints exactly what this module returns, so the synthetic tactical
// board can never disagree with `CombatState` — a divergence is a visible bug,
// not a second authority.
//
// Contract: combat debug workspace (execution prompt §3, §4, §16, §17)

import type {
  CollisionGrid,
  DebugSceneActor,
  DebugSceneObject,
  DebugSceneOverlayLayers,
  DebugSceneSpec,
} from '@aikami/frontend/engine';
import type { CombatState, GridPoint } from '@aikami/types';
import type { CombatDebugBattlefieldSource } from '../types/combat_debug_types.ts';

/**
 * Grid cell size for synthetic debug battlefields. Matches the engine's
 * default terrain tile size so `CombatState` cells, the engine's selection
 * highlight overlay and this projection all use one geometry.
 */
export const COMBAT_DEBUG_TILE_SIZE = 32;

/**
 * Default overlay layers. Selection highlights (reachable/targets) are drawn by
 * the engine's production overlay, so the debug projection leaves them off by
 * default; toggling them on echoes the same authoritative cells on top.
 */
export const DEFAULT_COMBAT_DEBUG_OVERLAY_LAYERS: DebugSceneOverlayLayers = {
  grid: true,
  coordinates: true,
  blocked: true,
  actorIds: false,
  reachable: false,
  targets: false,
  objects: true,
  worldOrigin: false,
};

/** Ordered overlay toggles for the battlefield control group. */
export const COMBAT_DEBUG_BATTLEFIELD_LAYERS = [
  { id: 'grid', label: 'Grid' },
  { id: 'coordinates', label: 'Coords' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'actorIds', label: 'IDs' },
  { id: 'reachable', label: 'Reachable' },
  { id: 'targets', label: 'Targets' },
  { id: 'objects', label: 'Objects' },
  { id: 'worldOrigin', label: 'Origin' },
] as const satisfies readonly { id: keyof DebugSceneOverlayLayers; label: string }[];

/**
 * Builds the engine collision grid a synthetic scenario needs so its declared
 * dimensions and blocked cells are AUTHORITATIVE (movement/pathfinding), not
 * merely decorative. Returns `undefined` for authored scenarios, which load
 * their real map through `loadMap`.
 */
export const buildSyntheticCollisionGrid = (
  battlefield: CombatDebugBattlefieldSource,
): CollisionGrid | undefined => {
  if (battlefield.kind !== 'synthetic') {
    return undefined;
  }
  const { width, height } = battlefield;
  const grid = new Array<boolean>(width * height).fill(false);
  for (const cell of battlefield.blockedCells) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) {
      continue;
    }
    grid[cell.y * width + cell.x] = true;
  }
  return { width, height, tileSize: COMBAT_DEBUG_TILE_SIZE, grid };
};

/** Authoritative terrain-blocked cells (not merely occupied cells). */
const terrainBlockedCells = (state: CombatState): readonly GridPoint[] => {
  const { battlefield } = state;
  const costs = battlefield.movementCost;
  if (costs === undefined) {
    return battlefield.blockedCells;
  }
  const blocked: GridPoint[] = [];
  for (let y = 0; y < battlefield.height; y++) {
    for (let x = 0; x < battlefield.width; x++) {
      if ((costs[y * battlefield.width + x] ?? 0) === 0) {
        blocked.push({ x, y });
      }
    }
  }
  return blocked;
};

/** Projects every combatant into a tactical token, deterministically ordered. */
export const projectCombatDebugActors = (options: {
  state: CombatState;
  activeCombatantId: string | undefined;
  selectedCombatantId: string | undefined;
  targetedCombatantId: string | undefined;
}): DebugSceneActor[] =>
  Object.keys(options.state.combatants)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((combatantId) => {
      const combatant = options.state.combatants[combatantId];
      if (combatant === undefined) {
        return [];
      }
      return [
        {
          id: combatant.combatantId,
          label: combatant.name,
          cell: { x: combatant.position.x, y: combatant.position.y },
          team: combatant.team,
          hp: combatant.hp,
          maxHp: combatant.maxHp,
          active: combatantId === options.activeCombatantId,
          selected:
            combatantId === options.selectedCombatantId ||
            combatantId === options.targetedCombatantId,
          downed: combatant.downed,
          defeated: combatant.defeated,
        },
      ];
    });

/** Projects live authored battlefield objects into debug scene tokens. */
export const projectCombatDebugObjects = (state: CombatState): DebugSceneObject[] =>
  Object.keys(state.environment.objects)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((objectId) => {
      const object = state.environment.objects[objectId];
      if (object === undefined) {
        return [];
      }
      return [
        {
          id: objectId,
          label: objectId,
          cell: { x: object.position.x, y: object.position.y },
          state: object.ignited ? `${object.state}+fire` : object.state,
        },
      ];
    });

export type BuildCombatDebugSceneSpecInput = {
  readonly state: CombatState | undefined;
  readonly syntheticBattlefield: CombatDebugBattlefieldSource | undefined;
  readonly layers: DebugSceneOverlayLayers;
  readonly activeCombatantId: string | undefined;
  readonly selectedCombatantId: string | undefined;
  readonly targetedCombatantId: string | undefined;
  readonly reachableCells: readonly GridPoint[];
  readonly targetCells: readonly GridPoint[];
};

/**
 * Builds the engine debug-scene spec.
 *
 * State is authoritative: dimensions and blocked cells come from
 * `CombatState.battlefield` when it exists, falling back to the declarative
 * synthetic battlefield before the first snapshot arrives. Returns `undefined`
 * when neither source declares a usable board (authored scenes render real
 * content instead).
 */
export const buildCombatDebugSceneSpec = (
  input: BuildCombatDebugSceneSpecInput,
): DebugSceneSpec | undefined => {
  const stateBattlefield = input.state?.battlefield;
  const synthetic =
    input.syntheticBattlefield?.kind === 'synthetic' ? input.syntheticBattlefield : undefined;

  const width = stateBattlefield?.width ?? synthetic?.width;
  const height = stateBattlefield?.height ?? synthetic?.height;
  if (width === undefined || height === undefined) {
    return undefined;
  }

  const blockedCells =
    input.state !== undefined ? terrainBlockedCells(input.state) : (synthetic?.blockedCells ?? []);

  return {
    width,
    height,
    tileSize: COMBAT_DEBUG_TILE_SIZE,
    blockedCells: [...blockedCells],
    reachableCells: input.layers.reachable ? [...input.reachableCells] : [],
    targetCells: input.layers.targets ? [...input.targetCells] : [],
    actors:
      input.state === undefined
        ? []
        : projectCombatDebugActors({
            state: input.state,
            activeCombatantId: input.activeCombatantId,
            selectedCombatantId: input.selectedCombatantId,
            targetedCombatantId: input.targetedCombatantId,
          }),
    objects: input.state === undefined ? [] : projectCombatDebugObjects(input.state),
    layers: input.layers,
  };
};

/** Counts authoritative combatants for render-parity diagnostics. */
export const countCombatDebugCombatants = (state: CombatState | undefined): number =>
  state === undefined ? 0 : Object.keys(state.combatants).length;
