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
       * Combat action from the UI (Attack, Flee, Defend, Ability, Support, Revive).
       * Routed to the turn_manager_system in the ECS worker.
       *
       * Contract: C-145 Turn-Based Combat Loop
       * Contract: C-146 Freeform AI Combat Actions
       * Contract: C-338 Deepen Turn-Based Combat
       */
      type: 'COMBAT_ACTION';
      /** Action discriminator — expanded for C-338 action economy. */
      action: 'ATTACK' | 'FLEE' | 'DEFEND' | 'ABILITY' | 'SUPPORT' | 'REVIVE';
      /** Target entity ID (single-target actions). */
      targetId?: number;
      /** Target entity IDs (multi-target abilities). */
      targetIds?: number[];
      /** When true, roll 2d20 and take the higher for the hit check (C-146). */
      advantage?: boolean;
      /** Extra damage added to the final damage roll (0–5, C-146). */
      bonusDamage?: number;
      /** Damage type key for resistance checks (C-338). Default: 'slashing'. */
      damageType?: string;
      /** For ABILITY actions: the ability ID being used. */
      abilityId?: string;
      /** For SUPPORT actions: 'heal' or 'buff'. */
      supportKind?: 'heal' | 'buff';
      /** For SUPPORT heal: the amount to heal. */
      healAmount?: number;
      /** For SUPPORT buff: the status effect ID to apply. */
      buffEffectId?: string;
    }
  | {
      type: 'COMBAT_ACTION_ANIMATE';
    }
  | {
      /**
       * Retry the last combat encounter with the preserved seed for
       * deterministic replay. Sent by the game-over ViewModel when the
       * player clicks "Retry Encounter".
       *
       * The engine resets turn tracking, reinitializes combat with the
       * preserved seed, and emits COMBAT_STARTED. The existing bridge
       * listener handles the COMBAT_STARTED response.
       *
       * Contract: C-330 AC-5 — Deterministic retry
       */
      type: 'RETRY_ENCOUNTER';
      /** Combat seed from the original encounter (32-bit integer). */
      combatSeed: number;
      /** Encounter ID for content pack resolution tracking. */
      encounterId?: string | null;
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
       * Heals the player entity by the given amount, clamped at max HP.
       * Sent by the client when an out-of-combat consumable (potion) is used.
       *
       * Contract: C-331 Integrate Inventory, Equipment, Loot, and Vendor
       */
      type: 'HEAL_PLAYER';
      /** HP restored (positive integer). */
      amount: number;
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
      targetType?:
        | 'npc'
        | 'item'
        | 'door'
        | 'chest'
        | 'lever'
        | 'pressure_plate'
        | 'container'
        | 'readable'
        | 'trap';
      /** Display name for the prompt. */
      targetName?: string;
    }
  | {
      /**
       * Emitted when a door opens.
       * Contract: C-342
       */
      type: 'DOOR_OPENED';
      spawnId: string;
    }
  | {
      /**
       * Emitted when a door closes.
       * Contract: C-342
       */
      type: 'DOOR_CLOSED';
      spawnId: string;
    }
  | {
      /**
       * Emitted when a lever is toggled.
       * Contract: C-342
       */
      type: 'LEVER_TOGGLED';
      spawnId: string;
      isToggled: boolean;
    }
  | {
      /**
       * Emitted when loot is generated from a chest or container.
       * Carries the per-item delta list for inventory processing.
       * Contract: C-342
       */
      type: 'LOOT_GENERATED';
      spawnId: string;
      items: Array<{ itemId: string; quantity: number }>;
    }
  | {
      /**
       * Emitted when a trap is triggered.
       * Contract: C-342
       */
      type: 'TRAP_TRIGGERED';
      spawnId: string;
      damage: number;
    }
  | {
      /**
       * Emitted when a readable signpost/book is inspected.
       * Contract: C-342
       */
      type: 'READABLE_INTERACTED';
      spawnId: string;
      textDialogueKey: string;
    }
  | {
      /**
       * Emitted when a puzzle is solved (all activation conditions met).
       * Contract: C-342
       */
      type: 'PUZZLE_SOLVED';
      puzzleId: string;
      solvedDialogueKey: string;
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
      /** Combat seed for deterministic replay (C-330 AC-1). */
      combatSeed?: number;
      /** Content pack encounter ID (null for ad-hoc encounters). */
      encounterId?: string | null;
      /** Whether non-combat resolution is available. */
      allowNonCombatResolution?: boolean;
      /** Non-combat skill check definition (if allowNonCombatResolution). */
      nonCombatSkillCheck?: {
        skill: string;
        dc: number;
        statModifier: 'strength' | 'dexterity' | 'intelligence' | 'charisma' | 'wisdom';
        successDialogueKey: string;
        failureDialogueKey: string;
      };
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
       * Contract: C-338 Deepen Turn-Based Combat
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
      /** Status effect ID if this log is about a status effect (C-338). */
      statusEffectId?: string;
      /** Damage type used in this action (C-338). */
      damageType?: string;
      /** Whether this action targeted multiple entities (C-338). */
      isMultiTarget?: boolean;
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
       * Emitted when a status effect is applied to a combat participant (C-338 AC-2).
       */
      type: 'STATUS_APPLIED';
      effectId: string;
      targetId: number;
      sourceId: number;
      duration: number;
      turnNumber: number;
    }
  | {
      /**
       * Emitted when a status effect expires from a combat participant (C-338 AC-2).
       */
      type: 'STATUS_EXPIRED';
      effectId: string;
      targetId: number;
    }
  | {
      /**
       * Emitted when a status effect ticks (damage/heal applied, C-338 AC-2).
       */
      type: 'STATUS_TICK';
      effectId: string;
      targetId: number;
      amount: number;
      isDamage: boolean;
    }
  | {
      /**
       * Emitted when the action economy changes for an entity (C-338 AC-1).
       */
      type: 'ACTION_ECONOMY_CHANGED';
      entityId: number;
      actionAvailable: boolean;
      bonusActionAvailable: boolean;
      reactionAvailable: boolean;
    }
  | {
      /**
       * Emitted when an entity enters the downed state (C-338 AC-5).
       */
      type: 'ENTITY_DOWNED';
      entityId: number;
    }
  | {
      /**
       * Emitted when a death save is rolled for a downed entity (C-338 AC-5).
       */
      type: 'DEATH_SAVE_ROLLED';
      entityId: number;
      roll: number;
      cumulativeSuccesses: number;
      cumulativeFailures: number;
    }
  | {
      /**
       * Emitted when a downed entity is revived (C-338 AC-5).
       */
      type: 'ENTITY_REVIVED';
      entityId: number;
      revivedByEntityId: number;
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
       * Carries the new level, stat gains, unlocked features, and updated XP progress.
       *
       * Contract: C-147 Progression & Persistence
       * Contract: C-337 Class Progression — featuresUnlocked added
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
      /** Feature IDs unlocked at this level (C-337). */
      featuresUnlocked: string[];
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
       * Contract: C-338 Deepen Turn-Based Combat
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
      /** Damage type used (C-338). */
      damageType?: string;
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
    }
  | {
      /**
       * Emitted when a quest is accepted by the player.
       * Contract: C-329 Integrate the Demo Quest from Offer Through Reward
       */
      type: 'QUEST_ACCEPTED';
      questId: string;
      questName: string;
    }
  | {
      /**
       * Emitted when a quest objective progresses.
       * Contract: C-329 Integrate the Demo Quest from Offer Through Reward
       */
      type: 'QUEST_PROGRESSED';
      questId: string;
      objectiveIndex: number;
      current: number;
      max: number;
    }
  | {
      /**
       * Emitted when a quest is completed.
       * Contract: C-329 Integrate the Demo Quest from Offer Through Reward
       */
      type: 'QUEST_COMPLETED';
      questId: string;
      endingId?: string;
    }
  | {
      /**
       * Emitted when quest rewards are delivered to the player.
       * Contract: C-329 Integrate the Demo Quest from Offer Through Reward
       */
      type: 'QUEST_REWARD_GRANTED';
      questId: string;
      rewards: Array<{ type: 'item' | 'gold' | 'xp'; itemId?: string; amount?: number }>;
    }
  | {
      /**
       * Emitted when the player enters a new map.
       * The QuestStateService listens for this to advance map-enter objectives.
       * Contract: C-329 Integrate the Demo Quest from Offer Through Reward
       */
      type: 'MAP_ENTERED';
      /** The map URL that was loaded (resolved via content pack loader). */
      mapUrl: string;
    }
  | {
      /**
       * Emitted when an encounter completes (combat victory or non-combat resolution).
       * The QuestStateService listens for this to advance encounter-complete objectives.
       * Contract: C-329 Integrate the Demo Quest from Offer Through Reward
       */
      type: 'ENCOUNTER_COMPLETED';
      encounterId: string;
      victory: boolean;
    }
  | {
      /**
       * Emitted when the player picks up an item from the world.
       * Carries the per-item delta (never the full inventory array) so the
       * client inventory service can apply additive stacking.
       * Contract: C-329 (event), C-331 (quantity + spawnId delta extension)
       */
      type: 'ITEM_PICKED_UP';
      itemId: string;
      /** Stack quantity picked up (defaults to 1 for legacy emitters). */
      quantity?: number;
      /**
       * Tiled spawn-point ID for respawn suppression. Absent for
       * programmatic/dev spawns — those pickups are never suppressed.
       */
      spawnId?: string;
    }
  | {
      /**
       * Emitted when an item pickup is rejected because the inventory has
       * no free slot. The map entity remains in the world.
       * Contract: C-331 AC-2 — "inventory full" feedback
       */
      type: 'INVENTORY_FULL';
      itemId: string;
    };

// ---------------------------------------------------------------------------
// Quest data (shared between ECS and UI)
// ---------------------------------------------------------------------------

/** A single objective within a quest, as tracked by the ECS. */
export type QuestObjectiveData = {
  readonly label: string;
  current: number;
  readonly max: number;
  /** Per-objective status (C-339). */
  readonly status?: 'locked' | 'active' | 'completed' | 'failed' | 'skipped' | 'expired';
  /** Whether the objective is hidden until revealed (C-339). */
  readonly hidden?: boolean;
  /** Whether the objective has been revealed (C-339). */
  readonly hiddenRevealed?: boolean;
  /** Whether the objective is optional (C-339). */
  readonly optional?: boolean;
  /** Wall-clock timestamp when objective became active (for timed objectives) (C-339). */
  readonly activeSince?: number;
  /** Wall-clock seconds until expiry (for timed objectives) (C-339). */
  readonly timeLimitSeconds?: number;
};

/** Quest status values emitted by the ECS. */
export type QuestStatus = 'active' | 'completed' | 'failed';

/** Quest data emitted from QuestStateService to UI via QUESTS_UPDATED. */
export type QuestData = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  status: QuestStatus;
  objectives: QuestObjectiveData[];
  /** Ending-specific narration (set when quest completes with an ending). */
  readonly endingNarration?: string;
  /** Rewards granted for this quest (for journal display). */
  readonly rewards?: Array<{ type: string; label: string }>;
  /** Whether the quest is repeatable (C-339). */
  readonly repeatable?: boolean;
  /** Quest chain ID for journal grouping (C-339). */
  readonly questChainId?: string;
  /** Display order within the chain (C-339). */
  readonly chainOrder?: number;
};

/**
 * A journal entry for a completed or failed quest.
 * Used by QuestJournalService to maintain a persistent narrative record.
 * Contract: C-339
 */
export type QuestJournalEntry = {
  /** Quest ID from content pack. */
  questId: string;
  /** Quest display name (cached from content pack). */
  title: string;
  /** Final status — completed or failed. */
  status: 'completed' | 'failed';
  /** Timestamp of completion/failure. */
  timestamp: number;
  /** Ending ID chosen (if applicable). */
  endingId?: string;
  /** Ending title (if applicable). */
  endingTitle?: string;
  /** Authored narration text from the ending. */
  narration: string;
  /** Objectives with their final status for the journal record. */
  objectiveResults: Array<{
    label: string;
    status: 'locked' | 'active' | 'completed' | 'failed' | 'skipped' | 'expired';
    /** If hidden, when it was revealed. */
    revealedAt?: number;
  }>;
  /** Rewards received. */
  rewards: Array<{ type: string; label: string }>;
  /** World-state flags set by this quest completion. */
  worldStateFlags: string[];
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
