// apps/frontend/game/src/engine/types.ts

/**
 * Data required to spawn an NPC entity in the game world.
 */
export type NPCSpawnData = {
  /** Unique identifier for the NPC. */
  npcId: string;
  /** Display name shown in dialog boxes. */
  npcName: string;
  /** Spawn position in world coordinates. */
  x: number;
  y: number;
  /** Texture key loaded via PixiJS Assets. */
  textureKey: string;
  /** Dialog text triggered on interaction (fallback greeting). */
  dialog: string;
  /**
   * Interaction radius in pixels. The player must be within this distance
   * from the NPC to trigger dialog.
   */
  interactionRadius: number;
  /** AI persona template ID for prompt injection. */
  personaId?: string;
  /** Dynamic relationship value (-100 to 100). */
  relationshipValue?: number;
};

// ---------------------------------------------------------------------------
// GameCommand — UI → Game Engine
// ---------------------------------------------------------------------------

/**
 * A command sent from the UI layer to the game engine.
 *
 * All payloads are plain serializable objects — no PixiJS or bitECS types.
 */
export type GameCommand =
  | {
      type: 'STOP_PLAYER';
    }
  | {
      type: 'SET_PLAYER_VELOCITY';
      velocity: { x: number; y: number };
    }
  | {
      /**
       * Sets the 2D velocity for an arbitrary entity by its ECS entity ID.
       * The movement system will apply this velocity with collision detection
       * on the next tick. Set to {x: 0, y: 0} to stop movement.
       *
       * Contract: C-212 Party Follow System
       */
      type: 'SET_ENTITY_VELOCITY';
      /** The entity ID in the bitECS world (must have Position component). */
      entityId: number;
      /** Velocity vector in pixels per second. */
      velocity: { x: number; y: number };
    }
  | {
      type: 'INTERACT';
      targetEntityId: string;
    }
  | {
      type: 'OPEN_MENU';
      menuId: string;
    }
  | {
      type: 'CLOSE_MENU';
    }
  | {
      type: 'SPAWN_NPC';
      npcData: NPCSpawnData;
    }
  | {
      type: 'LOAD_SCENE';
      sceneId: string;
    }
  | {
      type: 'PAUSE_GAME';
    }
  | {
      type: 'RESUME_GAME';
    }
  | {
      /**
       * Sets the global game mode state machine.
       *
       * EXPLORE — free movement, interaction allowed.
       * DIALOGUE — locked into conversation, movement disabled.
       * MENU — paused in overlay, all game input disabled.
       */
      type: 'SET_GAME_MODE';
      mode: 'EXPLORE' | 'DIALOGUE' | 'MENU' | 'COMBAT';
    }
  | {
      /** Slash command from the parser (e.g. /roll, /move). */
      type: 'EXECUTE_COMMAND';
      command: string;
      args: string[];
    }
  | {
      /** Macro from the parser (e.g. {{anim:attack}}). */
      type: 'TRIGGER_MACRO';
      macro: string;
      args: string[];
      /** Entity ID of the character the macro applies to. */
      entityId?: number;
    }
  | {
      /**
       * Combat action from the UI (Attack, Flee, Defend).
       * Routed to the turn_manager_system in the ECS worker.
       *
       * Contract: C-145 Turn-Based Combat Loop
       * Contract: C-146 Freeform AI Combat Actions
       */
      type: 'COMBAT_ACTION';
      action: 'ATTACK' | 'FLEE' | 'DEFEND';
      /** Target entity ID (defaults to the first enemy if omitted). */
      targetId?: number;
      /** When true, roll 2d20 and take the higher for the hit check (C-146). */
      advantage?: boolean;
      /** Extra damage added to the final damage roll (0–5, C-146). */
      bonusDamage?: number;
    }
  | {
      type: 'COMBAT_ACTION_ANIMATE';
    }
  | {
      /**
       * Updates the player entity's Appearance component layers based on
       * current equipment state. Sent by the InventoryViewModel after equip
       * or unequip resolves.
       *
       * Contract: C-163 Visceral Feedback Juice
       */
      type: 'UPDATE_PLAYER_APPEARANCE';
      /** Item ID of the equipped weapon, or undefined if none. */
      weapon?: string;
      /** Item ID of the equipped armor, or undefined if none. */
      armor?: string;
    }
  | {
      /**
       * Configures the environment system at runtime (time scale, weather).
       * Used by dev sandboxes to test diurnal cycles and weather overlays.
       *
       * Contract: C-213 Environment, Time, and Weather Core System
       */
      type: 'SET_ENVIRONMENT_CONFIG';
      /** Time scale: game seconds per real second. */
      timeScale?: number;
      /** Wind velocity (−1.0 to 1.0). */
      windVelocity?: number;
      /** Rain intensity (0.0 to 1.0). */
      rainIntensity?: number;
      /** Starting game hour (0–24). */
      startHour?: number;
    };

// ---------------------------------------------------------------------------
// GameEvent — Game Engine → UI
// ---------------------------------------------------------------------------

/**
 * An event emitted from the game engine to the UI layer.
 *
 * Emitted AT MOST at UI-relevant intervals (dialog triggers, health changes,
 * scene transitions — NOT per-frame position updates). All payloads are plain
 * serializable objects.
 */
export type GameEvent =
  | {
      type: 'NPC_DIALOG_START';
      npcId: string;
      npcName: string;
      dialog: string;
      personaId?: string;
    }
  | {
      /** Emitted when map transition completes — UI dismisses fade overlay. */
      type: 'MAP_LOADED';
    }
  | {
      type: 'NPC_INTERACTED';
      npcId: string;
      npcName: string;
      dialog: string;
      personaId?: string;
    }
  | {
      /**
       * Emitted when the player interacts with a vendor NPC.
       * Carries the vendor's item inventory list for the trading UI.
       *
       * Contract: C-154 AI Vendors Economy
       */
      type: 'VENDOR_INTERACTED';
      npcId: string;
      npcName: string;
      dialog: string;
      /** Comma-separated list of item IDs sold by this vendor. */
      vendorInventory: string;
    }
  | {
      type: 'NPC_DIALOG_END';
      npcId: string;
    }
  | {
      type: 'PLAYER_POSITION_CHANGED';
      x: number;
      y: number;
      scene: string;
    }
  | {
      type: 'ITEM_ACQUIRED';
      itemId: string;
      itemName: string;
    }
  | {
      /**
       * Emitted when the player's inventory changes (pickup or removal).
       * Contains the complete inventory array for reactive UI sync.
       *
       * Contract: C-142 Inventory Item Pickups
       */
      type: 'INVENTORY_UPDATED';
      inventory: Array<{ itemId: string; quantity: number }>;
    }
  | {
      type: 'SCENE_LOADED';
      sceneId: string;
    }
  | {
      type: 'GAME_READY';
    }
  | {
      type: 'GAME_ERROR';
      message: string;
    }
  | {
      type: 'CONTEXT_ENTERED';
      entityId: string;
      contextPayload: {
        npcId: string;
        npcName: string;
        dialog: string;
        interactionRadius: number;
      };
    }
  | {
      type: 'CONTEXT_EXITED';
      entityId: string;
    }
  | {
      /** Emitted when an entity's Appearance component layers change. */
      type: 'APPEARANCE_CHANGED';
      eid: number;
      /** The new layer IDs (all 5 layers) for dirty-check comparison. */
      layerIds: number[];
    }
  | {
      /**
       * Emitted when the closest interactable target changes (entering range,
       * switching targets, leaving range). Dirty-checked — only emitted when
       * the selection actually changes, not every tick.
       *
       * Contract: C-327 AC-2
       */
      type: 'INTERACTION_TARGET_CHANGED';
      /** undefined when no interactable is in range. */
      targetEntityId?: number;
      targetType?: 'npc' | 'item';
      /** Display name for the prompt (NPC name or item id). */
      targetName?: string;
    }
  | {
      /**
       * Emitted when the turn manager system advances combat to the next entity.
       * The UI (CombatViewModel) listens for this event to update health bars,
       * turn order displays, and status effects.
       */
      type: 'TURN_CHANGED';
      /** The entity ID that now has the active turn. */
      currentEntityId: number;
      /** All entity IDs currently participating in combat (alive + active). */
      activeEntities: number[];
    }
  | {
      /**
       * Emitted when combat is first initialized.
       * Carries the initial turn entity and full participant list.
       */
      type: 'COMBAT_STARTED';
      /** All entity IDs participating in the combat encounter. */
      participantIds: number[];
      /** The entity ID that has the first turn. */
      firstTurnEntityId: number;
      /** The enemy entity ID that triggered the encounter. */
      enemyId?: number;
      /** Display name of the enemy (e.g. "Goblin"). */
      enemyName?: string;
      /** Current hit points of the enemy that triggered the encounter. */
      enemyHp?: number;
      /** Maximum hit points of the enemy that triggered the encounter. */
      enemyMaxHp?: number;
    }
  | {
      /**
       * Emitted when the combat encounter ends (all enemies defeated or party wiped).
       */
      type: 'COMBAT_ENDED';
      /** `true` if the player's party won, `false` if they lost. */
      victory: boolean;
      /** The spawn point ID of the defeated enemy (only set on victory). */
      defeatedEnemyId?: string;
    }
  | {
      /**
       * Emitted when the player steps into a map transition zone.
       *
       * The UI should start a fade-out transition while the engine loads
       * the new map. Movement is locked until the transition completes.
       *
       * Contract: C-138 Map Transitions
       */
      type: 'ZONE_TRIGGERED';
      /** Target map filename or ID to load. */
      targetMap: string;
      /** Target X pixel coordinate for the player on the new map (legacy — use targetSpawnHash). */
      targetX: number;
      /** Target Y pixel coordinate for the player on the new map (legacy — use targetSpawnHash). */
      targetY: number;
      /** Numeric hash of the target spawn point ID on the destination map (C-172). */
      targetSpawnHash: number;
    }
  | {
      /**
       * Emitted when a combat action resolves (hit/miss, damage, status).
       * The CombatViewModel listens for this to populate the scrolling battle log.
       *
       * Contract: C-145 Turn-Based Combat Loop
       */
      type: 'COMBAT_LOG';
      /** Human-readable log entry (e.g. "Player rolls 14 to hit. Hits for 4 damage!"). */
      message: string;
      /** Source entity ID that performed the action. */
      sourceId: number;
      /** Target entity ID that received the action. */
      targetId: number;
      /** Remaining HP of the target after the action resolved. */
      targetRemainingHp: number;
      /** Maximum HP of the target. */
      targetMaxHp: number;
    }
  | {
      /**
       * Emitted when an entity's CombatStats change (HP, status).
       * The CombatViewModel listens for this to reactively update HP bars.
       */
      type: 'COMBAT_STATE_UPDATE';
      /** Map of entity ID → current HP. */
      entityHpMap: Record<number, number>;
      /** Map of entity ID → max HP. */
      entityMaxHpMap: Record<number, number>;
      /**
       * Map of entity ID → screen-space X coordinate for diegetic HP bars.
       * Only populated during combat when the combat stage is active.
       *
       * Contract: C-166 Diegetic Combat Stage
       */
      entityScreenX?: Record<number, number>;
      /** Map of entity ID → screen-space Y coordinate for diegetic HP bars. */
      entityScreenY?: Record<number, number>;
      /** Which entity currently has the active turn. */
      activeTurnEntity?: number;
    }
  | {
      /**
       * Emitted when quest data changes in the ECS (quest added, progressed, or completed).
       * The UI quest log listens for this to keep the displayed quest list in sync.
       *
       * Contract: C-143 Quest Log Sync
       */
      type: 'QUESTS_UPDATED';
      quests: QuestData[];
    }
  | {
      /**
       * Emitted when the player levels up after gaining enough XP.
       * Carries the new level, stat gains, and updated XP progress.
       *
       * Contract: C-147 Progression & Persistence
       */
      type: 'PLAYER_LEVELED_UP';
      /** The level the player just reached. */
      newLevel: number;
      /** New max HP after level-up. */
      maxHp: number;
      /** New base attack after level-up. */
      attack: number;
      /** New base defense after level-up. */
      defense: number;
      /** XP threshold for the next level (scaled up). */
      xpToNextLevel: number;
    }
  | {
      /**
       * Emitted every tick during dialogue zoom to carry the current camera
       * zoom factor and the active NPC's screen-space coordinates.
       *
       * The DialogueOverlay uses these to position a speech bubble directly
       * over the NPC's rendered PixiJS sprite.
       *
       * Only emitted while `isDialogueZooming` is true (dialogue active).
       *
       * Contract: C-161 Spatial UI Camera
       */
      type: 'CAMERA_ZOOM_UPDATE';
      /** Current lerped zoom factor (1.0–1.5). */
      zoom: number;
      /** NPC screen-space X coordinate (CSS pixels), or undefined. */
      npcScreenX?: number;
      /** NPC screen-space Y coordinate (CSS pixels), or undefined. */
      npcScreenY?: number;
    }
  | {
      /**
       * Emitted when damage is applied to a combat participant.
       * The UI uses this to spawn floating damage text and screen shake.
       *
       * Contract: C-163 Visceral Feedback Juice
       */
      type: 'DAMAGE_DEALT';
      /** Entity ID that took the damage. */
      entityId: number;
      /** Amount of damage dealt. */
      amount: number;
      /** Whether this was a critical hit. */
      isCritical: boolean;
      /** Screen-space X coordinate for floating text placement. */
      screenX: number;
      /** Screen-space Y coordinate for floating text placement. */
      screenY: number;
    }
  | {
      /**
       * Emitted every tick with the current environment state (time, weather).
       * The clock HUD and weather overlay consume this for reactive updates.
       *
       * Contract: C-213 Environment, Time, and Weather Core System
       */
      type: 'ENVIRONMENT_UPDATED';
      /** Game hour (0–24). */
      gameHour: number;
      /** Game minute (0–59). */
      gameMinute: number;
      /** Game time in seconds since epoch. */
      gameTimeSeconds: number;
      /** Wind velocity (−1.0 to 1.0). */
      windVelocity: number;
      /** Rain intensity (0.0 to 1.0). */
      rainIntensity: number;
    };

// ---------------------------------------------------------------------------
// Quest data (shared between ECS and UI)
// ---------------------------------------------------------------------------

/** A single objective within a quest, as tracked by the ECS. */
export type QuestObjectiveData = {
  readonly label: string;
  current: number;
  readonly max: number;
};

/** Quest status values emitted by the ECS. */
export type QuestStatus = 'active' | 'completed' | 'failed';

/** Quest data emitted from ECS to UI via QUESTS_UPDATED. */
export type QuestData = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  status: QuestStatus;
  objectives: QuestObjectiveData[];
};

// ---------------------------------------------------------------------------
// Helper types for discriminated union extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the union member of `GameCommand` whose `type` field equals `T`.
 */
export type GameCommandOfType<T extends GameCommand['type']> = Extract<GameCommand, { type: T }>;

/**
 * Extracts the union member of `GameEvent` whose `type` field equals `T`.
 */
export type GameEventOfType<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;

// ---------------------------------------------------------------------------
// Internal system types — used only inside engine/, never exported to UI
// ---------------------------------------------------------------------------

/** 2D position in world-space pixels. */
export type Position = {
  x: number;
  y: number;
};

/** 2D velocity in pixels per second. */
export type Velocity = {
  x: number;
  y: number;
};

/** Direction enum matching movement key bindings. */
export type Direction = 'up' | 'down' | 'left' | 'right';
