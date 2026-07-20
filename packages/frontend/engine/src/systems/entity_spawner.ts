// packages/frontend/engine/src/systems/entity_spawner.ts
//
// Entity Spawner — digests SpawnPoint arrays from Tiled object
// layers and creates NPC and prop entities in the ECS world.
//
// Contract C-136 Task 3, C-138 Task 1

import type { World } from 'bitecs';
import { addComponent, addEntity, set } from 'bitecs';
import { logger } from '$logger';
import type { SpawnPoint, TransitionZone } from '../assets/map_loader.ts';
import { djb2Hash } from '../assets/map_loader.ts';
import { Appearance, setAppearanceLayers } from '../components/appearance.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Companion } from '../components/companion.ts';
import { Enemy } from '../components/enemy.ts';
import { Interactable } from '../components/interactable.ts';
import { InteractableState } from '../components/interactable_state.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import { Position } from '../components/position.ts';
import { SpawnPoint as SpawnPointComp } from '../components/spawn_point.ts';
import { Transition } from '../components/transition.ts';
import { TurnOrder } from '../components/turn_order.ts';
import { AssetAlias, Visual } from '../components/visual.ts';

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
  /**
   * Spawn point IDs of map items that have already been collected.
   * Item pickups matching these IDs are skipped during spawn.
   *
   * Contract: C-331 AC-2 — collected-pickup respawn suppression
   */
  collectedPickups?: string[];
  /**
   * Per-spawnId interactable state for persistence across map revisits.
   * Maps spawnId → { isOpen?, isLocked?, isLooted?, isToggled?, isTriggered? }.
   *
   * Contract: C-342 — interactable state persistence
   */
  interactableStates?: Record<
    string,
    {
      isOpen?: boolean;
      isLocked?: boolean;
      isLooted?: boolean;
      isToggled?: boolean;
      isTriggered?: boolean;
    }
  >;
};

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

/** Default interaction radius for NPCs in pixels. */
const DEFAULT_INTERACTION_RADIUS = 50;

/** Default NPC dialog text if no dialogueKey property is set. */
const DEFAULT_DIALOG = 'Hello, traveler!';

/** Default companion approval score at spawn time. */
const DEFAULT_COMPANION_APPROVAL = 0;

/** Default tint for props (white = no tint). */
const PROP_TINT = 0xffffff;

/** Default Appearance layer IDs for NPCs — 6-layer stack (body, hair, torso, legs, feet, head). */
const NPC_APPEARANCE_LAYERS: readonly number[] = [10, 11, 14, 12, 15, 13];

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
  const { world, spawnPoints, defeatedEnemies, collectedPickups, interactableStates } = options;
  const results: SpawnResult[] = [];
  const defeatedSet = new Set(defeatedEnemies ?? []);
  const collectedSet = new Set(collectedPickups ?? []);
  const stateMap = interactableStates ?? {};

  for (const spawnPoint of spawnPoints) {
    // Skip enemies that have already been defeated (C-147)
    if (spawnPoint.type === 'enemy' && defeatedSet.has(spawnPoint.id)) {
      continue;
    }

    // Skip item pickups that have already been collected (C-331)
    if (spawnPoint.type === 'item' && collectedSet.has(spawnPoint.id)) {
      continue;
    }

    // Skip looted chests and containers if they don't respawn (C-342)
    const savedState = stateMap[spawnPoint.id];
    if ((spawnPoint.type === 'chest' || spawnPoint.type === 'container') && savedState?.isLooted) {
      // Check if respawns — stored in properties
      const respawns = _getBoolProperty(spawnPoint.properties, 'respawns', false);
      if (!respawns) {
        continue;
      }
    }

    // Skip triggered traps that don't re-arm
    if (spawnPoint.type === 'trap' && savedState?.isTriggered) {
      const reArms = _getBoolProperty(spawnPoint.properties, 'reArms', false);
      if (!reArms) {
        continue;
      }
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
    } else if (
      spawnPoint.type === 'door' ||
      spawnPoint.type === 'chest' ||
      spawnPoint.type === 'lever' ||
      spawnPoint.type === 'pressure_plate' ||
      spawnPoint.type === 'container' ||
      spawnPoint.type === 'readable' ||
      spawnPoint.type === 'trap'
    ) {
      const eid = _spawnInteractable(world, spawnPoint, savedState);
      results.push({ type: spawnPoint.type, eid, spawnPoint });
    }
    // Unknown types are silently skipped — they carry no spawn logic
  }

  return results;
};

/**
 * Options for spawning map spawn point marker entities (C-172).
 */
export type SpawnPointSpawnOptions = {
  /** The bitECS world to create entities in. */
  world: World;
  /** Spawn point entities extracted from Tiled object layers. */
  spawnPointEntities: import('../assets/map_loader.ts').SpawnPointEntity[];
};

/**
 * Creates invisible ECS spawn point marker entities.
 *
 * Each entity gets Position (pixel coordinates) and SpawnPoint
 * (hashed string identifier). These entities are queried during
 * map transitions to resolve portal targetSpawnHash → coordinates.
 *
 * @param options - World and spawn point entities.
 * @returns Array of created entity IDs.
 */
export const spawnSpawnPointEntities = (options: SpawnPointSpawnOptions): number[] => {
  const { world, spawnPointEntities } = options;
  const eids: number[] = [];

  for (const sp of spawnPointEntities) {
    const eid = addEntity(world);

    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: sp.x, y: sp.y }));

    addComponent(world, eid, SpawnPointComp);
    addComponent(world, eid, set(SpawnPointComp, { spawnHash: sp.spawnHash }));

    eids.push(eid);
  }

  return eids;
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
        targetSpawnHash: zone.targetSpawnId ? djb2Hash(zone.targetSpawnId) : 0,
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

  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: spawnPoint.x, y: spawnPoint.y }));

  addComponent(world, eid, Visual);
  addComponent(
    world,
    eid,
    set(Visual, {
      assetIndex: AssetAlias.NPC,
      tint: 0xffcc00, // gold tint for NPCs
      visible: 1,
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

  // ── Companion attachment (C-340) ──
  const isCompanion = _getBoolProperty(spawnPoint.properties, 'isCompanion', false);
  const companionClassId = _getStringProperty(spawnPoint.properties, 'companionClassId', '');
  const initialApproval = _getNumberProperty(
    spawnPoint.properties,
    'initialApproval',
    DEFAULT_COMPANION_APPROVAL,
  );

  if (isCompanion) {
    addComponent(world, eid, Companion);
    addComponent(
      world,
      eid,
      set(Companion, {
        npcId,
        approval: initialApproval,
        recruited: false,
      }),
    );

    // Attach CombatStats for companions so they can participate in combat
    if (companionClassId) {
      addComponent(world, eid, CombatStats);
      addComponent(
        world,
        eid,
        set(CombatStats, {
          health: 30,
          maxHealth: 30,
          initiative: 12,
          attack: 4,
          defense: 12,
          accuracy: 2,
          evasion: 11,
          xp: 0,
          level: 1,
          xpToNextLevel: 100,
          classId: companionClassId,
        }),
      );

      addComponent(world, eid, TurnOrder);
      addComponent(
        world,
        eid,
        set(TurnOrder, {
          currentTurn: false,
          initiativeValue: 12,
          isActive: false, // inactive until recruited
        }),
      );
    }

    logger.debug('[entity_spawner] Spawned COMPANION NPC:', {
      eid,
      npcId,
      npcName,
      companionClassId,
      initialApproval,
    });
  }

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

  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: spawnPoint.x, y: spawnPoint.y }));

  addComponent(world, eid, Visual);
  addComponent(
    world,
    eid,
    set(Visual, {
      assetIndex: AssetAlias.ITEM,
      tint: PROP_TINT,
      visible: 1,
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
      spawnId: spawnPoint.id,
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

  addComponent(world, eid, Visual);
  addComponent(
    world,
    eid,
    set(Visual, {
      assetIndex: AssetAlias.ENEMY,
      tint: 0xff4444, // red tint for hostile enemies
      visible: 1,
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

  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: spawnPoint.x, y: spawnPoint.y }));

  addComponent(world, eid, Visual);
  addComponent(
    world,
    eid,
    set(Visual, {
      assetIndex: AssetAlias.PROP_CHEST,
      tint: PROP_TINT,
      visible: 1,
    }),
  );

  return eid;
};

/**
 * Creates an interactable entity (door, chest, lever, pressure_plate, container,
 * readable, trap) from a spawn point. Uses the saved state for persistence.
 *
 * Contract: C-342
 */
const _spawnInteractable = (
  world: World,
  spawnPoint: SpawnPoint,
  savedState?: {
    isOpen?: boolean;
    isLocked?: boolean;
    isLooted?: boolean;
    isToggled?: boolean;
    isTriggered?: boolean;
  },
): number => {
  const eid = addEntity(world);

  const spawnType = spawnPoint.type;

  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: spawnPoint.x, y: spawnPoint.y }));

  addComponent(world, eid, InteractableState);

  // Resolve AssetAlias and set default state based on type
  let assetIndex: number;
  const isOpen = savedState?.isOpen ?? _getBoolProperty(spawnPoint.properties, 'startsOpen', false);
  const isLocked =
    savedState?.isLocked ?? _getBoolProperty(spawnPoint.properties, 'lockedByDefault', false);
  const isLooted = savedState?.isLooted ?? false;
  const isToggled =
    savedState?.isToggled ?? _getBoolProperty(spawnPoint.properties, 'startsToggled', false);
  const isTriggered = savedState?.isTriggered ?? false;
  const lootTableKey = _getStringProperty(spawnPoint.properties, 'lootTableKey', '');

  switch (spawnType) {
    case 'door':
      assetIndex = isOpen ? AssetAlias.PROP_DOOR_OPEN : AssetAlias.PROP_DOOR_CLOSED;
      break;
    case 'chest':
      assetIndex = AssetAlias.PROP_CHEST;
      break;
    case 'lever':
      assetIndex = isToggled ? AssetAlias.PROP_LEVER_ON : AssetAlias.PROP_LEVER_OFF;
      break;
    case 'pressure_plate':
      assetIndex = AssetAlias.PROP_PRESSURE_PLATE;
      break;
    case 'container':
      assetIndex = AssetAlias.PROP_CONTAINER;
      break;
    case 'readable':
      assetIndex = AssetAlias.PROP_READABLE;
      break;
    case 'trap':
      assetIndex = AssetAlias.PROP_TRAP;
      break;
    default:
      assetIndex = AssetAlias.PLACEHOLDER;
      break;
  }

  addComponent(world, eid, Visual);
  addComponent(
    world,
    eid,
    set(Visual, {
      assetIndex,
      tint: PROP_TINT,
      visible: 1,
    }),
  );

  // Build Interactable data with puzzle fields
  const requiredItemId = _getStringProperty(spawnPoint.properties, 'requiredItemId', '');
  const activatedBySpawnIds = _getStringProperty(spawnPoint.properties, 'activatedBySpawnIds', '');
  const textDialogueKey = _getStringProperty(spawnPoint.properties, 'textDialogueKey', '');
  const damageDice = _getStringProperty(spawnPoint.properties, 'damageDice', '1d6');

  addComponent(world, eid, Interactable);
  addComponent(
    world,
    eid,
    set(Interactable, {
      type: spawnType,
      itemId: spawnType === 'readable' ? textDialogueKey : spawnType === 'trap' ? '' : lootTableKey,
      quantity: 0,
      spawnId: spawnPoint.id,
      requiredItemId: spawnType === 'trap' ? damageDice : requiredItemId,
      activatesOnSpawnIds: activatedBySpawnIds,
    }),
  );

  // Set saved state on InteractableState
  InteractableState.isOpen[eid] = isOpen ? 1 : 0;
  InteractableState.isLocked[eid] = isLocked ? 1 : 0;
  InteractableState.isLooted[eid] = isLooted ? 1 : 0;
  InteractableState.isToggled[eid] = isToggled ? 1 : 0;
  InteractableState.isTriggered[eid] = isTriggered ? 1 : 0;
  InteractableState.lootTableKey[eid] = 0; // Resolved by content pack loader

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
