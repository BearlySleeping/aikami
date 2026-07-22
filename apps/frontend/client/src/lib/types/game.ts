// apps/frontend/client/src/lib/types/game.ts
//
// PWA-only game types. For cross-project game types, see @aikami/types.

/** Event emitted by the game state service to listeners. */
export type GameStateEvent = {
  type:
    | 'location_changed'
    | 'variable_updated'
    | 'npc_added'
    | 'npc_removed'
    | 'event_triggered'
    | 'session_ended';
  payload: Record<string, unknown>;
  timestamp: string;
};

/** Listener callback for game state events. */
export type GameStateListener = (event: GameStateEvent) => void;

/** A single spatial context entry — an entity the player is near. */
export type ActiveContextEntry = {
  entityId: string;
  npcId: string;
  npcName: string;
  dialog: string;
  interactionRadius: number;
};

/** Options for constructing a GameStateService. */
export type GameStateOptions = {
  uid: string;
};

/**
 * Centralized game mode state machine.
 *
 * EXPLORE — free movement, interaction allowed
 * DIALOGUE — locked into conversation, movement disabled
 * MENU — paused in overlay, all game input disabled
 */
export type GameMode = 'EXPLORE' | 'DIALOGUE' | 'MENU' | 'COMBAT';

/** IndexedDB save slot metadata displayed in the start menu. */
export type SaveSlotInfo = {
  /** Unique slot identifier (e.g., 'auto-save', 'manual-1'). */
  id: string;
  /** Unix timestamp (ms) when the save was created. */
  timestamp: number;
  /** Display name of the map/location where the save was made. */
  mapName: string;
  /** The campaign ID this save belongs to (C-334). */
  campaignId?: string;
};
