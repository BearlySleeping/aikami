// apps/frontend/client/src/lib/services/settings/motion_preference_service.svelte.ts
//
// MotionPreferenceService — the ONE owner of the player's explicit motion
// selection (C-527 AC-6, Directive 11).
//
// Before this service, "reduced motion" was only ever read from the OS media
// query at each call site, so an explicit player choice had nowhere to live and
// two consumers could disagree about what "reduced" meant. The preference has
// exactly three values — `auto` (follow the OS), `reduce`, `full` — and is
// persisted with the same localStorage pattern the other UI preferences use.
//
// Only the *selection* is stored here; turning a selection plus the OS
// preference into an effective policy stays in the pure `resolveReducedMotion`
// resolver, so there is still a single place that answers "is motion reduced".

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { isMotionPreference, type MotionPreference } from '$types';

const MOTION_PREFERENCE_KEY = 'aikami:motion:preference';

export type MotionPreferenceServiceOptions = BaseFrontendClassOptions;

export type MotionPreferenceServiceInterface = BaseFrontendClassInterface & {
  /** The player's explicit selection; `auto` (the default) follows the OS. */
  readonly preference: MotionPreference;
  /** Sets and persists the selection. Unknown values are ignored. */
  setPreference(preference: MotionPreference): void;
  /** Re-reads the persisted selection (idempotent). */
  initialize(): Promise<void>;
};

class MotionPreferenceService
  extends BaseFrontendClass<MotionPreferenceServiceOptions>
  implements MotionPreferenceServiceInterface
{
  preference = $state<MotionPreference>('auto');

  constructor(options: MotionPreferenceServiceOptions) {
    super(options);
    // 🔴 Restore at construction, NOT only in an explicit `initialize()`.
    //
    // This preference is read by two independent entry points — the game boot
    // (`game_composition_root`) and the Settings page (`/settings`) — and when
    // the restore lived only in `initialize()` the second one silently showed
    // the in-memory default on every visit: the value was stored and honoured
    // in-game, but /settings displayed `auto` after a reload. Owning the
    // restore here makes the class of bug impossible: there is no entry point
    // to forget. `initialize()` is kept for an explicit re-read.
    this._restoreFromStorage();
  }

  /** @inheritdoc */
  setPreference(preference: MotionPreference): void {
    if (!isMotionPreference(preference)) {
      this.debug('setPreference:ignored', { preference: String(preference) });
      return;
    }
    this.preference = preference;
    try {
      localStorage.setItem(MOTION_PREFERENCE_KEY, preference);
    } catch {
      // localStorage unavailable (SSR/privacy mode) — in-memory only
    }
    this.debug('setPreference', { preference });
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    this._restoreFromStorage();
  }

  /**
   * Reads the persisted selection.
   *
   * A stale or hand-edited value degrades to `auto` rather than throwing or
   * silently forcing motion on a player who asked for it at the OS level.
   */
  private _restoreFromStorage(): void {
    try {
      const stored = localStorage.getItem(MOTION_PREFERENCE_KEY);
      this.preference = isMotionPreference(stored) ? stored : 'auto';
    } catch {
      // localStorage unavailable — keep the current value
    }
  }
}

export const motionPreferenceService: MotionPreferenceServiceInterface =
  MotionPreferenceService.create({ className: 'MotionPreferenceService' });
