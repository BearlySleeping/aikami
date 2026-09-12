// apps/frontend/client/src/lib/services/game/overlay_combat_mode.ts
//
// Overlay → game-mode transition policy (C-500).
//
// Combat is a mode-gated surface: the production shell mounts the split-screen
// combat sidebar/portrait stage only while the engine reports COMBAT. The
// overlay router owns that transition so every entry funnel (dialogue combat
// chip, worker encounter) and exit funnel (closeCombat, defeat → GAME_OVER)
// converges here.
//
// Extracted from game_overlay_service so the grandfathered service stays
// within its source-file-size baseline, following the same pattern as
// overlay_compatibility.ts and game_ui_hud_visibility.ts.

import type { GameOverlayType } from '$types';
import type { GameModeServiceInterface } from './game_mode_service.svelte';

/** Minimal mode-service surface this policy needs. */
type OverlayModeCapability = Pick<GameModeServiceInterface, 'currentMode' | 'setMode'>;

/**
 * Applies the game-mode transition for an overlay activation.
 *
 * - `COMBAT` → `COMBAT`: mounts the mode-gated combat surface.
 * - `GAME_OVER` while in `COMBAT` → `EXPLORE`: collapses the split-screen on
 *   defeat so the world returns to its normal layout.
 * - Anything else leaves the current mode untouched.
 *
 * @param options.type - The overlay being activated.
 * @param options.modeService - The game-mode service to read/update.
 */
export const applyOverlayModeTransition = (options: {
  type: GameOverlayType;
  modeService: OverlayModeCapability;
}): void => {
  const { type, modeService } = options;
  if (type === 'COMBAT') {
    modeService.setMode('COMBAT');
    return;
  }
  if (type === 'GAME_OVER' && modeService.currentMode === 'COMBAT') {
    modeService.setMode('EXPLORE');
  }
};
