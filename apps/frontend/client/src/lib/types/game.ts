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
