// apps/frontend/client/src/lib/services/game/overlay_compatibility.ts
/** biome-ignore-all lint/style/useNamingConvention: GameOverlayType enum-like keys use SCREAMING_SNAKE_CASE */
//
// Declarative overlay compatibility matrix for the game overlay router.
// Split out of game_overlay_service so the routing rules are inert data with a
// single owner, and the service stays within its grandfathered size budget.

import type { GameOverlayType } from '$types';

/**
 * Which overlay types can be pushed over the current active overlay.
 *
 * Row = current active overlay, Column = overlay being opened.
 * 'allow' = allowed; 'block' = silently ignored; 'clear' = clear the stack
 * first, then push (e.g. combat wipes non-combat overlays).
 */
type OverlayCompatibility = 'allow' | 'block' | 'clear';

/** Routing policy for every (current, next) overlay pair. */
export const OVERLAY_COMPATIBILITY: Record<
  GameOverlayType,
  Partial<Record<GameOverlayType, OverlayCompatibility>>
> = {
  NONE: {
    PAUSE_MENU: 'allow',
    DIALOGUE: 'allow',
    COMBAT: 'allow',
    INVENTORY: 'allow',
    QUEST_LOG: 'allow',
    JOURNAL: 'allow',
    GAME_OVER: 'allow',
    CHARACTER_DASHBOARD: 'allow',
    VENDOR: 'allow',
    END_SESSION: 'allow',
    PARTY_ROSTER: 'allow',
    REPUTATION: 'allow',
  },
  PAUSE_MENU: {
    INVENTORY: 'allow',
    QUEST_LOG: 'allow',
    JOURNAL: 'allow',
    CHARACTER_DASHBOARD: 'allow',
    END_SESSION: 'allow',
    SETTINGS: 'allow',
    REPUTATION: 'allow',
  },
  DIALOGUE: {
    COMBAT: 'clear',
    GAME_OVER: 'clear',
  },
  COMBAT: {
    GAME_OVER: 'clear',
  },
  INVENTORY: {
    PAUSE_MENU: 'allow',
  },
  QUEST_LOG: {
    PAUSE_MENU: 'allow',
  },
  JOURNAL: {
    PAUSE_MENU: 'allow',
  },
  CHARACTER_DASHBOARD: {
    PAUSE_MENU: 'allow',
  },
  VENDOR: {
    PAUSE_MENU: 'allow',
  },
  GAME_OVER: {},
  END_SESSION: {},
  SETTINGS: {},
  PARTY_ROSTER: {
    PAUSE_MENU: 'allow',
    TALK_TO_PARTY: 'allow',
  },
  TALK_TO_PARTY: {
    PAUSE_MENU: 'allow',
  },
  REPUTATION: {
    PAUSE_MENU: 'allow',
  },
};
