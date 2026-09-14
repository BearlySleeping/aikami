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
  motionAttributeValue,
  resolveReducedMotion,
} from '$types';

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

  /** The OS preference query, when the platform exposes one. */
  private _osQuery: MediaQueryList | undefined;

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
    this._bindDocumentPolicy();
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
    this._syncDocumentPolicy();
    this.debug('setPreference', { preference });
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    this._restoreFromStorage();
    this._bindDocumentPolicy();
  }

  /**
   * C-527 AC-6 / Directive 11 — publishes the ONE effective motion policy on the
   * document root.
   *
   * The effective policy must reach surfaces that live OUTSIDE the game UI
   * layer: the combat sidebar is a sibling of that layer, and native/portaled
   * dialogs detach from it entirely. A single `data-motion` attribute on
   * `<html>` is therefore the one place the CSS has to look, and it lets an
   * explicit `reduce` choice act under an OS that allows motion (and an
   * explicit `full` choice act under an OS that asks for reduction).
   */
  private _bindDocumentPolicy(): void {
    if (typeof window === 'undefined') {
      return;
    }
    this._osQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this._osQuery?.removeEventListener('change', this._onOsPreferenceChange);
    this._osQuery?.addEventListener('change', this._onOsPreferenceChange);
    this._syncDocumentPolicy();
  }

  /** Writes the resolved policy to `<html data-motion>`; DOM-safe no-op otherwise. */
  private _syncDocumentPolicy(): void {
    if (typeof document === 'undefined' || !document.documentElement) {
      return;
    }
    const reducedMotion = resolveReducedMotion({
      preference: this.preference,
      osPrefersReduced: this._osQuery?.matches ?? false,
    });
    document.documentElement.dataset.motion = motionAttributeValue(reducedMotion);
  }

  /** Live OS preference changes re-resolve the effective policy. */
  private readonly _onOsPreferenceChange = (): void => {
    this._syncDocumentPolicy();
  };

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
