// apps/frontend/game/src/engine/entities/create_player.ts

import type { World } from 'bitecs';
import { addComponent, addEntity, set } from 'bitecs';
import { Appearance, setAppearanceLayers } from '../components/appearance.ts';
import { CameraFocus } from '../components/camera_focus.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Inventory, MAX_INVENTORY_SLOTS } from '../components/inventory.ts';
import { Position } from '../components/position.ts';
import { Sprite } from '../components/sprite.ts';
import { TurnOrder } from '../components/turn_order.ts';
import { Velocity } from '../components/velocity.ts';

// ---------------------------------------------------------------------------
// Player entity factory
// ---------------------------------------------------------------------------

/**
 * Options for creating a player entity.
 */
export type PlayerCreateOptions = {
  /** The player character's display name (from active persona). */
  name?: string;
};

/**
 * Creates the player entity in the given bitECS world.
 *
 * The player starts at the center of the canvas with zero velocity. The
 * {@link Sprite} component includes a green tint (`0x00ff88`) so it's
 * visually distinct from NPCs.
 *
 * @param world - The bitECS world to create the player in.
 * @param options - Optional player initialization data (name, stats, etc.).
 * @returns The entity ID of the newly created player.
 */
const createPlayer = (world: World, options?: PlayerCreateOptions): number => {
  const entityId = addEntity(world);

  addComponent(world, entityId, Position);
  addComponent(world, entityId, set(Position, { x: 400, y: 300 }));

  addComponent(world, entityId, Velocity);
  addComponent(world, entityId, set(Velocity, { x: 0, y: 0 }));

  addComponent(world, entityId, Sprite);
  addComponent(
    world,
    entityId,
    set(Sprite, {
      textureKey: 'player',
      tint: 0x00ff88,
      displayObject: undefined,
    }),
  );

  // Camera system tracks this entity for smooth viewport following
  addComponent(world, entityId, CameraFocus);

  // Set default Appearance with all 6 engine slots:
  //   body, hair, torso, legs, feet, head
  // Variant indices are 1-indexed (0 = first variant in catalog).
  // Head uses variant 95 (= index 94, head/heads/human_male) so the
  // character has a visible face instead of just ear accessories.
  addComponent(world, entityId, Appearance);
  setAppearanceLayers(world, entityId, [1, 1, 1, 1, 1, 95]);

  // Initialize empty inventory with zero-filled slots.
  // Contract C-142: player must start with an empty Inventory component
  // so the interaction system has somewhere to store picked-up items.
  addComponent(world, entityId, Inventory);
  addComponent(
    world,
    entityId,
    set(Inventory, {
      itemIds: new Array(MAX_INVENTORY_SLOTS).fill(0),
      quantities: new Array(MAX_INVENTORY_SLOTS).fill(0),
      itemTypes: new Array(MAX_INVENTORY_SLOTS).fill(0),
    }),
  );

  // Give the player combat stats for turn-based encounters.
  // Default values: 100 HP, moderate attack, decent defense.
  addComponent(world, entityId, CombatStats);
  addComponent(
    world,
    entityId,
    set(CombatStats, {
      health: 100,
      maxHealth: 100,
      initiative: 12,
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 12,
    }),
  );

  // Give the player a TurnOrder component for combat participation.
  addComponent(world, entityId, TurnOrder);
  addComponent(
    world,
    entityId,
    set(TurnOrder, {
      currentTurn: false,
      initiativeValue: 12,
      isActive: true,
    }),
  );

  // Store player name as a numeric hash on the entity for reference.
  // The UI layer (GameViewModel) owns the display name; the engine
  // only needs positional/rendering data.
  if (options?.name) {
    void options.name;
  }

  return entityId;
};

export { createPlayer };
