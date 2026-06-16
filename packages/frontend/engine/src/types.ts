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
    }
  | {
      /**
       * Emitted when the combat encounter ends (all enemies defeated or party wiped).
       */
      type: 'COMBAT_ENDED';
      /** `true` if the player's party won, `false` if they lost. */
      victory: boolean;
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
      /** Target X pixel coordinate for the player on the new map. */
      targetX: number;
      /** Target Y pixel coordinate for the player on the new map. */
      targetY: number;
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
