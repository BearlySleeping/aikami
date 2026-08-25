// packages/frontend/engine/src/serialization/ecs_serializer.ts

import { validateEcsSnapshot } from '@aikami/schemas';
import type { EcsSnapshot } from '@aikami/types';
import type { World } from 'bitecs';
import { addComponent, addEntity, getAllEntities } from 'bitecs';
import { Appearance } from '../components/appearance.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Position } from '../components/position.ts';
import { Visual } from '../components/visual.ts';

// ---------------------------------------------------------------------------
// EcsSerializer — bitECS world snapshot serialization / hydration
//
// Contract C-117: Extracts persistent component data (Position, Appearance,
// CombatStats) from active entities into a portable JSON payload. Ephemeral
// components (Velocity, DirtyGraphics, etc.) are deliberately excluded to
// keep the payload dense and safe for cloud sync. Visual.frame is included
// so prop entities can restore their atlas frame.
//
// Entity IDs are preserved across serialize/deserialize because bitECS
// recycles EIDs — restoring the same IDs prevents relational data breakage.
// ---------------------------------------------------------------------------

/**
 * Ordered list of persistent components included in every snapshot.
 *
 * Each entry maps the SoA component object to its canonical name.
 * Adding a new entry here automatically includes it in both
 * serialize and deserialize paths.
 */
const PERSISTENT_COMPONENTS: Array<[string, Record<string, Array<unknown>>]> = [
  ['Position', Position],
  // C-430: Appearance has a Map field (layers) — cast to Record for
  // serializer backward compat. The Map entries are skipped by
  // _extractComponentSlice (source[eid] on a Map returns undefined).
  ['Appearance', Appearance as unknown as Record<string, Array<unknown>>],
  ['CombatStats', CombatStats],
  ['Visual', Visual],
];

/**
 * Internal component slice type used by helpers.
 * Allows `undefined` because SoA arrays may have gaps.
 * Not exposed — the wire format uses EcsSnapshot from @aikami/types.
 */
type ComponentSlice = Record<string, Array<number | string | boolean | null | undefined>>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a slice of component data for a list of entity IDs.
 *
 * Reads raw SoA array values directly (never through bitECS `onGet`
 * observers) to avoid holding onto SharedArrayBuffer references or
 * triggering side effects during snapshot capture.
 *
 * @param component - The bitECS SoA component object (e.g., `Position`).
 * @param eids - Ordered list of active entity IDs to extract.
 * @returns A {@link ComponentSlice} keyed by field name.
 */
const _extractComponentSlice = (
  component: Record<string, Array<unknown>>,
  eids: number[],
): ComponentSlice => {
  const slice: ComponentSlice = {};

  // Special handling for Appearance.layers Map field
  if (component === (Appearance as unknown as Record<string, Array<unknown>>)) {
    const layersMap = Appearance.layers;
    const layersValues: Array<string | undefined> = [];
    for (const eid of eids) {
      const layers = layersMap.get(eid);
      // Serialize as JSON string to preserve array length beyond 6 slots
      layersValues.push(layers !== undefined ? JSON.stringify(layers) : undefined);
    }
    if (layersValues.some((v) => v !== undefined)) {
      slice.layers = layersValues;
    }
  }

  for (const field of Object.keys(component)) {
    // Skip the Map field itself (it's not enumerable anyway)
    if (field === 'layers' && component === (Appearance as unknown as Record<string, Array<unknown>>)) {
      continue;
    }
    const source = component[field] as Array<unknown>;
    const values: Array<number | string | boolean | undefined> = [];

    for (const eid of eids) {
      const value = source[eid];
      // Only serialize primitive values that JSON can handle.
      // Complex objects (PixiJS display objects, etc.) are excluded.
      if (
        value === undefined ||
        typeof value === 'number' ||
        typeof value === 'string' ||
        typeof value === 'boolean'
      ) {
        values.push(value);
      }
    }

    // Only include fields that have at least one non-undefined entry
    if (values.some((v) => v !== undefined)) {
      slice[field] = values;
    }
  }

  return slice;
};

/**
 * Restores component data from a slice onto newly-created entities.
 *
 * Iterates the entity list and assigns each field value via bitECS `set`.
 * Skips fields where the slice value is `undefined`.
 *
 * @param world - The destination bitECS world.
 * @param component - The bitECS SoA component object.
 * @param eids - Ordered list of entity IDs to assign data to.
 * @param slice - The slice data extracted during serialization.
 */
const _restoreComponentSlice = (
  world: World,
  component: Record<string, Array<unknown>>,
  eids: number[],
  slice: ComponentSlice,
): void => {
  // Special handling for Appearance.layers Map field
  if (component === (Appearance as unknown as Record<string, Array<unknown>>)) {
    const layersValues = slice.layers;
    if (layersValues) {
      for (let i = 0; i < eids.length; i++) {
        const eid = eids[i];
        const value = layersValues[i];
        if (value !== undefined && value !== null && typeof value === 'string') {
          try {
            const layers = JSON.parse(value) as readonly number[];
            // Use setAppearanceLayers to populate both Map and legacy arrays
            const { setAppearanceLayers } = require('../components/appearance.ts');
            setAppearanceLayers(world, eid, layers);
          } catch {
            // Malformed JSON — skip this entity's layers
          }
        }
      }
    }
  }

  for (const field of Object.keys(slice)) {
    // Skip the serialized layers field for Appearance (already handled above)
    if (field === 'layers' && component === (Appearance as unknown as Record<string, Array<unknown>>)) {
      continue;
    }
    const values = slice[field];
    if (!values) {
      continue;
    }

    for (let i = 0; i < eids.length; i++) {
      const eid = eids[i];
      const value = values[i];
      // Skip null/undefined — these represent gaps in sparse SoA arrays
      // (entity exists but field is not set for this entity).
      if (value === undefined || value === null) {
        continue;
      }

      // Write directly to the SoA array so the value is available
      // for subsequent `set` calls or direct reads.
      const target = component[field] as Array<unknown>;
      target[eid] = value;
    }
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serializes the persistent components of all active entities in a bitECS
 * world into a portable JSON string payload.
 *
 * Ephemeral components (Velocity, Visual, DirtyGraphics, etc.) are excluded.
 * The returned payload is safe to store locally or transmit to a cloud sync
 * endpoint.
 *
 * @param world - The bitECS world to snapshot.
 * @returns A JSON string representing the snapshot.
 */
export const serializeWorld = (world: World): string => {
  // C-378: only serialize entities that actually carry persistent state.
  // C-376 wall entities (GridPosition + SpatialLink + CollisionData) have
  // none of the persistent components — serializing them produced ~190
  // no-data entity rows in world-scope snapshots, which the legacy restore
  // then replayed as sprites (broken scene). An entity with no persistent
  // component is pure noise on the wire.
  const hasPersistentData = (eid: number): boolean =>
    PERSISTENT_COMPONENTS.some(([, component]) =>
      Object.values(component).some((arr) => arr[eid] !== undefined),
    );
  const allEids = [...getAllEntities(world)].filter(hasPersistentData);
  if (allEids.length === 0) {
    const emptySnapshot: EcsSnapshot = {
      version: '1.0.0',
      timestamp: Date.now(),
      entities: [],
      components: {},
    };
    return JSON.stringify(emptySnapshot);
  }

  const components: Record<string, ComponentSlice> = {};

  for (const [name, component] of PERSISTENT_COMPONENTS) {
    const slice = _extractComponentSlice(component, allEids);
    if (Object.keys(slice).length > 0) {
      // Cast: helper filters undefined, but return type includes it for
      // internal convenience when working with raw SoA arrays.
      components[name] = slice as Record<string, Array<number | string | boolean>>;
    }
  }

  const snapshot: EcsSnapshot = {
    version: '1.0.0',
    timestamp: Date.now(),
    entities: allEids,
    components: components as EcsSnapshot['components'],
  };

  return JSON.stringify(snapshot);
};

/**
 * Serializes ONLY the player entity's persistent components.
 *
 * The map file is the source of truth for world entities (NPCs, props,
 * portals, spawn markers) — they are re-created from Tiled data on every
 * map load. The save snapshot therefore only needs the player's own state
 * (Position, Appearance, CombatStats, Visual). Keeping the snapshot
 * player-scoped avoids restoring ghost entities (transition zones,
 * combat-statted props) that the world rebuild already replaces.
 *
 * @param world - The bitECS world to snapshot.
 * @param playerEid - The player entity ID (defaults to 1, the engine's
 *   convention for the first spawned player entity).
 * @returns A JSON string with a single-entity EcsSnapshot.
 */
export const serializePlayer = (_world: World, playerEid = 1): string => {
  const eids = [playerEid];
  const components: Record<string, ComponentSlice> = {};

  for (const [name, component] of PERSISTENT_COMPONENTS) {
    const slice = _extractComponentSlice(component, eids);
    if (Object.keys(slice).length > 0) {
      components[name] = slice as Record<string, Array<number | string | boolean>>;
    }
  }

  const snapshot: EcsSnapshot = {
    version: '1.0.0',
    timestamp: Date.now(),
    entities: eids,
    components: components as EcsSnapshot['components'],
  };

  return JSON.stringify(snapshot);
};

/**
 * Hydrates a bitECS world from a previously-serialized snapshot payload.
 *
 * Creates new entities (bitECS assigns sequential IDs) and restores all
 * persistent component data. The returned ID mapping allows callers to
 * reconcile any relational data that references old EIDs.
 *
 * Ephemeral components that were excluded during serialization are NOT
 * created on the target entities. The caller is responsible for
 * re-registering component observers on the target world before calling
 * this function for `set` operations to work correctly.
 *
 * @param world - The destination bitECS world (should be empty/fresh).
 * @param payload - A JSON string produced by {@link serializeWorld}.
 * @returns A `Map` from old entity IDs (in the snapshot) to new entity IDs
 *   (assigned by bitECS during hydration).
 * @throws If the payload is not valid JSON or the version is unrecognized.
 */
export const deserializeWorld = (world: World, payload: string): Map<number, number> => {
  // Validate shape and version before parsing.
  const validationError = validateEcsSnapshot(payload);
  if (validationError) {
    throw new Error(`EcsSerializer: ${validationError}`);
  }

  const snapshot = JSON.parse(payload) as EcsSnapshot;

  const eidMap = new Map<number, number>();

  if (snapshot.entities.length === 0) {
    return eidMap;
  }

  // Create new entities and build old→new EID mapping.
  // bitECS assigns sequential IDs starting from 1.
  const newEids: number[] = [];
  for (const oldEid of snapshot.entities) {
    const newEid = addEntity(world);
    eidMap.set(oldEid, newEid);
    newEids.push(newEid);
  }

  // Restore component data for each persistent component.
  // Components are only registered on entities that actually have a
  // concrete value in the slice — previously every entity received every
  // component, so restored props/portals carried CombatStats and matched
  // enemy/combat queries as garbage entities.
  for (const [name, component] of PERSISTENT_COMPONENTS) {
    const slice = snapshot.components[name];
    if (!slice) {
      continue;
    }

    for (let i = 0; i < newEids.length; i++) {
      const newEid = newEids[i];
      const hasValue = Object.values(slice).some(
        (values) => values[i] !== undefined && values[i] !== null,
      );
      if (hasValue) {
        addComponent(world, newEid, component);
      }
    }

    _restoreComponentSlice(world, component, newEids, slice);
  }

  return eidMap;
};
