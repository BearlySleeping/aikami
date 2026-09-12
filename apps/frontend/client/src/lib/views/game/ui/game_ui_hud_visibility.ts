// apps/frontend/client/src/lib/views/game/ui/game_ui_hud_visibility.ts
//
// Pure HUD visibility policy for the game UI layer. Extracted from the
// overlay-router ViewModel so the rules are testable on their own and the
// ViewModel stays within its grandfathered size budget.

import type { GameOverlayType } from '$types';

/** HUD chrome hidden while a blocking menu or terminal surface is open. */
const HIDDEN_IN_MENU: ReadonlySet<GameOverlayType> = new Set([
  'PAUSE_MENU',
  'GAME_OVER',
  'END_SESSION',
]);

/** HUD chrome hidden whenever the world is not the focus (menus or scene-locking surfaces). */
const HIDDEN_WHILE_BUSY: ReadonlySet<GameOverlayType> = new Set([
  'PAUSE_MENU',
  'GAME_OVER',
  'END_SESSION',
  'COMBAT',
  'DIALOGUE',
]);

/** The management sections the HUD navigation can open. */
export type ManagementSection =
  | 'character'
  | 'inventory'
  | 'journal'
  | 'quests'
  | 'party'
  | 'reputation';

/** Clock: visible unless a blocking menu is open. */
export const showClockHud = (overlay: GameOverlayType): boolean => !HIDDEN_IN_MENU.has(overlay);

/** HP bar: exploration only. */
export const showHpBar = (overlay: GameOverlayType): boolean => overlay === 'NONE';

/** Quest tracker: exploration only (the full log is a Codex section). */
export const showQuestTracker = (overlay: GameOverlayType): boolean => overlay === 'NONE';

/** Autosave indicator: hidden while the world is not the focus. */
export const showAutosaveIndicator = (overlay: GameOverlayType): boolean =>
  !HIDDEN_WHILE_BUSY.has(overlay);

/** Hotbar: exploration only. */
export const showHotbar = (overlay: GameOverlayType): boolean => overlay === 'NONE';

/** Management nav: exploration only, and never during a transition. */
export const showManagementNav = (overlay: GameOverlayType, isTransitioning: boolean): boolean =>
  overlay === 'NONE' && !isTransitioning;

/** HP percentage, clamped to 0–100. */
export const hpPercent = (hp: number, maxHp: number): number => {
  if (maxHp <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (hp / maxHp) * 100));
};
