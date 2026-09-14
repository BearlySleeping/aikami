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
import {
  isMotionPreference,
  type MotionPreference,
} from '$types';

const MOTION_PREFERENCE_KEY = 'aikami:motion:preference';

export type MotionPreferenceServiceOptions = BaseFrontendClassOptions;

export type MotionPreferenceServiceInterface = BaseFrontendClassInterface & {
  /** The player's explicit selection; `auto` (the default) follows the OS. */
  readonly preference: MotionPreference;
  /** Sets and persists the selection. Unknown values are ignored. */
  setPreference(preference: MotionPreference): void;
  /** Restores the persisted selection. Called by the composition root at boot. */
  initialize(): Promise<void>;
};

class MotionPreferenceService
  extends BaseFrontendClass<MotionPreferenceServiceOptions>
  implements MotionPreferenceServiceInterface
{
  preference = $state<MotionPreference>('auto');

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
    try {
      const stored = localStorage.getItem(MOTION_PREFERENCE_KEY);
      // A stale or hand-edited value degrades to `auto` rather than throwing or
      // silently forcing motion on a player who asked for it at the OS level.
      this.preference = isMotionPreference(stored) ? stored : 'auto';
    } catch {
      // keep default
    }
  }
}

export const motionPreferenceService: MotionPreferenceServiceInterface =
  MotionPreferenceService.create({ className: 'MotionPreferenceService' });
