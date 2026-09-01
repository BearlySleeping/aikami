// apps/frontend/client/src/lib/services/game/quest_overlay_service.svelte.ts
//
// QuestOverlayService — owns the persisted visibility toggle for the
// in-game active-quest mini overlay (the "quest tracker card" that mirrors
// the music player overlay). Defaults to visible; can be hidden from the
// overlay itself or toggled from Settings > Gameplay.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';

const QUEST_OVERLAY_VISIBLE_KEY = 'aikami:quest-overlay:visible';

export type QuestOverlayServiceOptions = BaseFrontendClassOptions;

export type QuestOverlayServiceInterface = BaseFrontendClassInterface & {
  /** Whether the active-quest overlay is visible (persisted). */
  readonly visible: boolean;
  /** Toggles overlay visibility. */
  toggleVisible(): void;
  /** Sets overlay visibility and persists it. */
  setVisible(visible: boolean): void;
};

class QuestOverlayService
  extends BaseFrontendClass<QuestOverlayServiceOptions>
  implements QuestOverlayServiceInterface
{
  visible = $state<boolean>(true);

  /** @inheritdoc */
  toggleVisible(): void {
    this.setVisible(!this.visible);
  }

  /** @inheritdoc */
  setVisible(visible: boolean): void {
    this.visible = visible;
    try {
      localStorage.setItem(QUEST_OVERLAY_VISIBLE_KEY, visible ? '1' : '0');
    } catch {
      // localStorage unavailable (SSR/privacy mode) — in-memory only
    }
    this.debug('setVisible', { visible });
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    // Restore persisted visibility (default: visible).
    try {
      this.visible = localStorage.getItem(QUEST_OVERLAY_VISIBLE_KEY) !== '0';
    } catch {
      // keep default
    }
  }
}

export const questOverlayService: QuestOverlayServiceInterface = QuestOverlayService.create({
  className: 'QuestOverlayService',
});
