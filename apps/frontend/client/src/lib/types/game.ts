// apps/frontend/client/src/lib/types/game.ts
//
// PWA-only game types. For cross-project game types, see @aikami/types.

import type { NpcSuggestionChip } from '@aikami/types';

/** Overlay destinations managed by the in-game overlay router. */
export type GameOverlayType =
  | 'NONE'
  | 'PAUSE_MENU'
  | 'DIALOGUE'
  | 'COMBAT'
  | 'INVENTORY'
  | 'QUEST_LOG'
  | 'GAME_OVER'
  | 'CHARACTER_DASHBOARD'
  | 'VENDOR'
  | 'END_SESSION'
  | 'SETTINGS'
  | 'PARTY_ROSTER'
  | 'TALK_TO_PARTY'
  | 'REPUTATION';

/** NPC data displayed by the dialogue overlay. */
export type DialogueNpcData = {
  npcId: string;
  npcName: string;
  dialog?: string;
  personaId?: string;
  /** Pre-authored suggestion chips shown with the initial greeting. */
  initialSuggestions?: NpcSuggestionChip[];
};

/** Status of the most recent automatic save attempt. */
export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Entry in the overlay stack; an empty stack represents no active overlay. */
export type OverlayStackEntry = {
  type: GameOverlayType;
  /** Element that had focus before this overlay opened, for focus restoration. */
  previousFocus: HTMLElement | undefined;
};

/** A single recorded dice roll and its optional check context. */
export type DiceHistoryEntry = {
  roll: number;
  sides: number;
  modifier: number;
  total: number;
  timestamp: Date;
  /** Raw notation as typed, for example `1d20+3`. */
  notation?: string;
  /** Difficulty class the roll targeted, when applicable. */
  dc?: number;
  /** Whether the roll met or exceeded its difficulty class. */
  success?: boolean;
  /** Natural-20 critical-success flag for a single d20. */
  isCriticalSuccess?: boolean;
  /** Natural-1 critical-failure flag for a single d20. */
  isCriticalFailure?: boolean;
  /** Optional human-readable roll label. */
  label?: string;
};

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
