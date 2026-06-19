// packages/frontend/engine/src/systems/entity_spawner.ts
//
// Entity Spawner — digests SpawnPoint arrays from Tiled object
// layers and creates NPC and prop entities in the ECS world.
//
// Contract C-136 Task 3, C-138 Task 1

import type { World } from 'bitecs';
import { addComponent, addEntity, set } from 'bitecs';
import { logger } from '$logger';
import { resolveNpcTexture, resolvePropTexture } from '../assets/lpc_asset_catalog.ts';
import type { SpawnPoint, TransitionZone } from '../assets/map_loader.ts';
import { Appearance, setAppearanceLayers } from '../components/appearance.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Enemy } from '../components/enemy.ts';
import { Interactable } from '../components/interactable.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import { Position } from '../components/position.ts';
import { Sprite } from '../components/sprite.ts';
import { Transition } from '../components/transition.ts';
import { TurnOrder } from '../components/turn_order.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result entry returned by {@link spawnEntities} for each
 * successfully created entity.
 */
export type SpawnResult = {
  /** Entity type ('npc' or 'prop'). */
  type: string;
  /** bitECS entity ID assigned during creation. */
  eid: number;
  /** The SpawnPoint that generated this entity. */
  spawnPoint: SpawnPoint;
};

/**
 * Options for the entity spawner.
 */
export type SpawnEntitiesOptions = {
  /** The bitECS world to create entities in. */
  world: World;
  /** Spawn points extracted from Tiled object layers. */
  spawnPoints: SpawnPoint[];
  /**
   * Spawn point IDs of enemies that have already been defeated.
   * Enemies matching these IDs are skipped during spawn.
   *
   * Contract: C-147 Progression & Persistence
   */
  defeatedEnemies?: string[];
};

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

/** Default interaction radius for NPCs in pixels. */
const DEFAULT_INTERACTION_RADIUS = 50;

/** Default NPC dialog text if no dialogueKey property is set. */
const DEFAULT_DIALOG = 'Hello, traveler!';

/** Default tint for props (white = no tint). */
const PROP_TINT = 0xffffff;

/** Default Appearance layer IDs for NPCs (standard body + guide hair + robe + pants + shoes). */
const NPC_APPEARANCE_LAYERS: [number, number, number, number, number] = [10, 11, 12, 13, 14];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates ECS entities from an array of SpawnPoints.
 *
 * - `type === 'npc'`: Creates an entity with Position, Sprite, Appearance,
 *   and NPCDialog components. The `npcId` and `dialogueKey` properties
 *   from Tiled are used to populate NPCDialog fields.
 * - `type === 'prop'`: Creates a static entity with Position and Sprite
 *   components. No interaction components are attached (props are
 *   decorative until a future interaction system wires them up).
 * - `type === 'item'`: Creates a pickup item with Position, Sprite,
 *   and Interactable components. The `itemId` and `quantity` Tiled
 *   properties define what the player receives on pickup.
 *
 * @param options - World and spawn points.
 * @returns Array of results with entity IDs and metadata.
 */
export const spawnEntities = (options: SpawnEntitiesOptions): SpawnResult[] => {
  const { world, spawnPoints, defeatedEnemies } = options;
  const results: SpawnResult[] = [];
  const defeatedSet = new Set(defeatedEnemies ?? []);

  for (const spawnPoint of spawnPoints) {
    // Skip enemies that have already been defeated (C-147)
    if (spawnPoint.type === 'enemy' && defeatedSet.has(spawnPoint.id)) {
      continue;
    }

    if (spawnPoint.type === 'npc') {
      const eid = _spawnNpc(world, spawnPoint);
      results.push({ type: 'npc', eid, spawnPoint });
    } else if (spawnPoint.type === 'prop') {
      const eid = _spawnProp(world, spawnPoint);
      results.push({ type: 'prop', eid, spawnPoint });
    } else if (spawnPoint.type === 'item') {
      const eid = _spawnItem(world, spawnPoint);
      results.push({ type: 'item', eid, spawnPoint });
    } else if (spawnPoint.type === 'enemy') {
      const eid = _spawnEnemy(world, spawnPoint);
      results.push({ type: 'enemy', eid, spawnPoint });
    }
    // Unknown types are silently skipped — they carry no spawn logic
  }

  return results;
};

/**
 * Options for spawning transition zone entities.
 */
export type SpawnTransitionOptions = {
  /** The bitECS world to create entities in. */
  world: World;
  /** Transition zones extracted from Tiled object layers. */
  transitionZones: TransitionZone[];
};

/**
 * Creates invisible ECS trigger entities from an array of TransitionZones.
 *
 * Each entity gets Position (center of the zone rectangle) and Transition
 * (with target map + coordinates). These entities are queried by the
 * zoning system each tick to detect player overlap.
 *
 * @param options - World and transition zones.
 * @returns Array of created entity IDs.
 */
export const spawnTransitionEntities = (options: SpawnTransitionOptions): number[] => {
  const { world, transitionZones } = options;
  const eids: number[] = [];

  for (const zone of transitionZones) {
    const eid = addEntity(world);

    // Center the entity at the middle of the zone rectangle
    const centerX = zone.x + zone.width / 2;
    const centerY = zone.y + zone.height / 2;

    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: centerX, y: centerY }));

    addComponent(world, eid, Transition);
    addComponent(
      world,
      eid,
      set(Transition, {
        targetMap: zone.targetMap,
        targetX: zone.targetX,
        targetY: zone.targetY,
        width: zone.width,
        height: zone.height,
        triggered: false,
      }),
    );

    eids.push(eid);
  }

  return eids;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Creates an NPC entity from a spawn point.
 */
const _spawnNpc = (world: World, spawnPoint: SpawnPoint): number => {
  const eid = addEntity(world);

  const npcId = _getStringProperty(spawnPoint.properties, 'npcId', spawnPoint.id);
  const npcName = _getStringProperty(spawnPoint.properties, 'npcName', `NPC ${spawnPoint.id}`);
  const dialog = _getStringProperty(spawnPoint.properties, 'dialogueKey', DEFAULT_DIALOG);
  const interactionRadius = _getNumberProperty(
    spawnPoint.properties,
    'interactionRadius',
    DEFAULT_INTERACTION_RADIUS,
  );
  const isVendor = _getBoolProperty(spawnPoint.properties, 'isVendor', false);
  const vendorInventory = _getStringProperty(spawnPoint.properties, 'vendorInventory', '');
  const textureKey = resolveNpcTexture(spawnPoint.properties);

  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: spawnPoint.x, y: spawnPoint.y }));

  addComponent(world, eid, Sprite);
  addComponent(
    world,
    eid,
    set(Sprite, {
      textureKey,
      tint: 0xffcc00, // gold tint for NPCs
      displayObject: undefined,
    }),
  );

  addComponent(world, eid, Appearance);
  setAppearanceLayers(world, eid, NPC_APPEARANCE_LAYERS);

  addComponent(world, eid, NPCDialog);
  addComponent(
    world,
    eid,
    set(NPCDialog, {
      npcId,
      npcName,
      dialog,
      interactionRadius,
      playerInRange: false,
      isVendor,
      vendorInventory,
    }),
  );

  if (isVendor) {
    logger.debug('[entity_spawner] Spawned VENDOR NPC:', {
      eid,
      npcId,
      npcName,
      isVendor,
      vendorInventory,
    });
  }

  return eid;
};

/**
 * Creates an item pickup entity from a spawn point.
 *
 * Item entities use the Interactable component with `type: 'item'`
 * so the interaction system can distinguish them from NPCs.
 */
const _spawnItem = (world: World, spawnPoint: SpawnPoint): number => {
  const eid = addEntity(world);

  const itemId = _getStringProperty(spawnPoint.properties, 'itemId', `item_${spawnPoint.id}`);
  const quantity = _getNumberProperty(spawnPoint.properties, 'quantity', 1);
  const textureKey = resolvePropTexture(spawnPoint.properties);

  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: spawnPoint.x, y: spawnPoint.y }));

  addComponent(world, eid, Sprite);
  addComponent(
    world,
    eid,
    set(Sprite, {
      textureKey,
      tint: PROP_TINT,
      displayObject: undefined,
    }),
  );

  addComponent(world, eid, Interactable);
  addComponent(
    world,
    eid,
    set(Interactable, {
      type: 'item',
      itemId,
      quantity,
    }),
  );

  return eid;
};

/**
 * Creates an enemy entity from a spawn point.
 *
 * Enemies get Position, Sprite, CombatStats (HP/Attack/Defense),
 * Enemy tag, and TurnOrder components. Custom properties like
 * `npcName`, `hp`, `maxHp`, and `initiative` from Tiled define
 * combat attributes.
 *
 * Contract: C-144 Combat Encounter Integration
 */
const _spawnEnemy = (world: World, spawnPoint: SpawnPoint): number => {
  const eid = addEntity(world);

  const hp = _getNumberProperty(spawnPoint.properties, 'hp', 50);
  const maxHp = _getNumberProperty(spawnPoint.properties, 'maxHp', hp);
  const initiative = _getNumberProperty(spawnPoint.properties, 'initiative', 10);
  const attack = _getNumberProperty(spawnPoint.properties, 'attack', 3);
  const defense = _getNumberProperty(spawnPoint.properties, 'defense', 10);
  const accuracy = _getNumberProperty(spawnPoint.properties, 'accuracy', 2);
  const evasion = _getNumberProperty(spawnPoint.properties, 'evasion', 10);

  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: spawnPoint.x, y: spawnPoint.y }));

  addComponent(world, eid, Sprite);
  addComponent(
    world,
    eid,
    set(Sprite, {
      textureKey: '',
      tint: 0xff4444, // red tint for hostile enemies
      displayObject: undefined,
    }),
  );

  addComponent(world, eid, CombatStats);
  addComponent(
    world,
    eid,
    set(CombatStats, {
      health: hp,
      maxHealth: maxHp,
      initiative,
      attack,
      defense,
      accuracy,
      evasion,
    }),
  );

  addComponent(world, eid, Enemy);
  addComponent(world, eid, set(Enemy, { isActive: true, spawnId: spawnPoint.id }));

  addComponent(world, eid, TurnOrder);
  addComponent(
    world,
    eid,
    set(TurnOrder, {
      currentTurn: false,
      initiativeValue: initiative,
      isActive: true,
    }),
  );

  return eid;
};

/**
 * Creates a prop entity from a spawn point.
 */
const _spawnProp = (world: World, spawnPoint: SpawnPoint): number => {
  const eid = addEntity(world);

  const textureKey = resolvePropTexture(spawnPoint.properties);

  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: spawnPoint.x, y: spawnPoint.y }));

  addComponent(world, eid, Sprite);
  addComponent(
    world,
    eid,
    set(Sprite, {
      textureKey,
      tint: PROP_TINT,
      displayObject: undefined,
    }),
  );

  return eid;
};

/**
 * Extracts a boolean property from a spawn point's properties map.
 *
 * Accepts boolean true, or string 'true'/'1'.
 * Falls back to `defaultValue` otherwise.
 */
const _getBoolProperty = (
  properties: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
): boolean => {
  const value = properties[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  return defaultValue;
};

// ---------------------------------------------------------------------------
// Property extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a string property from a spawn point's properties map.
 *
 * Falls back to `defaultValue` when the property is missing or not a string.
 */
const _getStringProperty = (
  properties: Record<string, unknown>,
  key: string,
  defaultValue: string,
): string => {
  const value = properties[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return defaultValue;
};

/**
 * Extracts a numeric property from a spawn point's properties map.
 *
 * Falls back to `defaultValue` when the property is missing or not a number.
 */
const _getNumberProperty = (
  properties: Record<string, unknown>,
  key: string,
  defaultValue: number,
): number => {
  const value = properties[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return defaultValue;
};
