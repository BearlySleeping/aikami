// apps/frontend/client/src/lib/services/game/game_overlay_hotbar_shortcut.ts
//
// Hotbar keyboard shortcut after the overlay toggles.

import type { GameOverlayServiceInterface } from './game_overlay_types.ts';
import { playerStateService } from './player_state_service.svelte';

/** Consumes number keys for the hotbar only while the game has no overlay. */
export const handleHotbarShortcut = (options: {
  event: KeyboardEvent;
  activeOverlay: GameOverlayServiceInterface['activeOverlay'];
  onActivate: (activation: { slotIndex: number; featureId: string }) => void;
}): boolean => {
  const { event, activeOverlay, onActivate } = options;
  if (activeOverlay !== 'NONE' || event.key < '1' || event.key > '6') {
    return false;
  }
  event.preventDefault();
  const slotIndex = Number.parseInt(event.key, 10) - 1;
  const featureId = playerStateService.hotbarSlots[slotIndex];
  if (featureId) {
    playerStateService.useAbility(featureId);
    onActivate({ slotIndex, featureId });
  }
  return true;
};
