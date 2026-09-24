// apps/frontend/client/src/lib/views/game/ui/game_ui_hud_visibility.ts
//
// C-528 — thin adapters over the single pure HUD policy.
//
// C-527 put the overlay hidden-sets and the per-widget predicates here. The
// contract's Directive 11 requires ONE effective resolver for HUD settings
// everywhere (main Settings, the in-game editor, the legacy toggles), so the
// sets now live in `hud_layout_policy.ts` and these predicates forward to them.
// They stay exported until every call site migrates to the resolver.

import {
  HUD_HIDDEN_IN_MENU,
  HUD_HIDDEN_WHILE_BUSY,
  HUD_MANAGEMENT_OVERLAYS,
  isHudManagementOverlayVisible,
} from '$lib/utils/hud/hud_layout_policy.ts';
import type { GameOverlayType } from '$types';

/**
 * The management sections the HUD navigation can open.
 *
 * C-527: the seven-nav strip collapsed into five canonical sections. The
 * registry that owns them lives in `./management_sections.ts`; this alias is
 * kept so existing importers of the visibility module keep working.
 */
export type { ManagementSectionId as ManagementSection } from './management_sections.ts';
export {
  HUD_HIDDEN_IN_MENU as HIDDEN_IN_MENU,
  HUD_HIDDEN_WHILE_BUSY as HIDDEN_WHILE_BUSY,
  HUD_MANAGEMENT_OVERLAYS,
  isHudManagementOverlayVisible as isManagementOverlayVisible,
};

/** Clock: visible unless a blocking menu or the management host is open. */
export const showClockHud = (overlay: GameOverlayType): boolean => !HUD_HIDDEN_IN_MENU.has(overlay);

/** HP bar: exploration only. */
export const showHpBar = (overlay: GameOverlayType): boolean => overlay === 'NONE';

/** Quest tracker: exploration only (the full log is a Codex section). */
export const showQuestTracker = (overlay: GameOverlayType): boolean => overlay === 'NONE';

/** Autosave indicator: hidden while the world is not the focus. */
export const showAutosaveIndicator = (overlay: GameOverlayType): boolean =>
  !HUD_HIDDEN_WHILE_BUSY.has(overlay);

/** Hotbar: exploration only. */
export const showHotbar = (overlay: GameOverlayType): boolean => overlay === 'NONE';

/**
 * Management nav (the single labeled Menu entry): available in exploration and
 * during Dialogue, never during a transition.
 *
 * Dialogue is the one non-management surface that intentionally permits a
 * temporary management destination, so the player can inspect Inventory without
 * losing the active conversation.
 */
export const showManagementNav = (overlay: GameOverlayType, isTransitioning: boolean): boolean =>
  (overlay === 'NONE' || overlay === 'DIALOGUE') && !isTransitioning;

/** HP percentage, clamped to 0–100. */
export const hpPercent = (hp: number, maxHp: number): number => {
  if (maxHp <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (hp / maxHp) * 100));
};

/**
 * Health severity band (C-543 PART F).
 *
 * Policy lives here, not in the view: the HUD markup only renders the tone the
 * ViewModel projects, so "what counts as low health" has a single owner.
 */
export type HudHealthTone = 'healthy' | 'warning' | 'danger';

/** Classifies an HP percentage into a severity band. */
export const hpTone = (percent: number): HudHealthTone => {
  if (percent > 50) {
    return 'healthy';
  }
  if (percent > 25) {
    return 'warning';
  }
  return 'danger';
};

/** Human-readable severity label rendered alongside the color, never instead of it. */
export const hpToneLabel = (tone: HudHealthTone): string => {
  switch (tone) {
    case 'healthy':
      return 'Healthy';
    case 'warning':
      return 'Wounded';
    case 'danger':
      return 'Critical';
  }
};
