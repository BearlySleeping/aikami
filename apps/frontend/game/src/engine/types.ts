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
  /** Dialog text triggered on interaction. */
  dialog: string;
  /**
   * Interaction radius in pixels. The player must be within this distance
   * from the NPC to trigger dialog.
   */
  interactionRadius: number;
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
      type: 'MOVE_PLAYER';
      direction: 'up' | 'down' | 'left' | 'right';
    }
  | {
      type: 'STOP_PLAYER';
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
