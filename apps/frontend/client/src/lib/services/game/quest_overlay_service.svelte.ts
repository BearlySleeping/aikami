// apps/frontend/client/src/lib/services/game/quest_overlay_service.svelte.ts
//
// QuestOverlayService — owns the persisted visibility toggle for the expanded
// form of the in-game objective card. C-527 Directive 7 makes the COMPACT
// objective the exploration default, so this expanded density is OFF for a new
// player; an explicit stored choice (Settings > Gameplay, or the card's own
// hide action) is preserved and restores the expanded form.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';

const QUEST_OVERLAY_VISIBLE_KEY = 'aikami:quest-overlay:visible';

export type QuestOverlayServiceOptions = BaseFrontendClassOptions;

export type QuestOverlayServiceInterface = BaseFrontendClassInterface & {
  /** Whether the expanded active-quest card is visible (persisted). */
  readonly visible: boolean;
  /** Toggles overlay visibility. */
  toggleVisible(): void;
  /** Sets overlay visibility and persists it. */
  setVisible(visible: boolean): void;
  /** Re-reads the persisted visibility (idempotent). */
  initialize(): Promise<void>;
};

class QuestOverlayService
  extends BaseFrontendClass<QuestOverlayServiceOptions>
  implements QuestOverlayServiceInterface
{
  visible = $state<boolean>(false);

  constructor(options: QuestOverlayServiceOptions) {
    super(options);
    // 🔴 Restore at construction. The service always had an `initialize()` that
    // read the stored value, but nothing ever called it, so a player who hid the
    // quest card got it back on every reload — the preference was written and
    // never read. Reading it here removes the forgotten-call-site failure mode
    // entirely; `initialize()` remains for an explicit re-read.
    this._restoreFromStorage();
  }

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
    this._restoreFromStorage();
  }

  /** Restores persisted visibility. Missing value means "compact" (off). */
  private _restoreFromStorage(): void {
    try {
      this.visible = localStorage.getItem(QUEST_OVERLAY_VISIBLE_KEY) === '1';
    } catch {
      // localStorage unavailable — keep the default (off)
    }
  }
}

export const questOverlayService: QuestOverlayServiceInterface = QuestOverlayService.create({
  className: 'QuestOverlayService',
});
