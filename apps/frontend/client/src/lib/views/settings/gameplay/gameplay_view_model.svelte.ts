// apps/frontend/client/src/lib/views/settings/gameplay/gameplay_view_model.svelte.ts
//
// GameplayViewModel — options overview for the Basic settings tier.
// Language, region, accessibility quick-toggles, difficulty, autosave, tutorial
// hints.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/gameplay_fixtures.ts).
// Production wiring lives in ./gameplay_composition.ts.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { MOTION_PREFERENCES, type MotionPreference } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** The quest-overlay visibility capability. */
export type GameplayOverlayCapabilities = {
  readonly visible: boolean;
  toggleVisible(): void;
  setVisible(visible: boolean): void;
};

/**
 * C-527 AC-6 — the shared motion-preference capability.
 *
 * Gameplay settings and the game HUD read the SAME service, so the control in
 * Settings and the policy the HUD applies can never disagree.
 */
export type GameplayMotionCapabilities = {
  readonly preference: MotionPreference;
  setPreference(preference: MotionPreference): void;
};

// ── Types ───────────────────────────────────────────────────────────────

export type GameplayViewModelOptions = BaseViewModelOptions & {
  /** Quest-overlay visibility capability. */
  overlay: GameplayOverlayCapabilities;
  /** C-527 AC-6: motion selection capability. */
  motion: GameplayMotionCapabilities;
};

export type GameplayViewModelInterface = BaseViewModelInterface & {
  /** Whether tutorial hints are enabled. */
  readonly tutorialHints: boolean;
  /** Whether autosave is enabled. */
  readonly autosave: boolean;
  /** Selected difficulty level. */
  readonly difficulty: string;
  /** Available difficulty options. */
  readonly difficultyOptions: readonly { id: string; label: string }[];
  /** Whether the active-quest overlay HUD is visible. */
  readonly questOverlayVisible: boolean;
  /** C-527 AC-6: the player's explicit motion selection (`auto` follows the OS). */
  readonly motionPreference: MotionPreference;
  /** C-527 AC-6: the selectable motion options. */
  readonly motionOptions: readonly { id: MotionPreference; label: string }[];

  toggleTutorialHints(): void;
  toggleAutosave(): void;
  setDifficulty(id: string): void;
  toggleQuestOverlay(): void;
  /** C-527 AC-6: sets the explicit motion selection (persisted by the service). */
  setMotionPreference(preference: MotionPreference): void;
  resetDefaults(): void;
};

// ── Constants ───────────────────────────────────────────────────────────

const DIFFICULTY_OPTIONS = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
] as const;

const MOTION_OPTIONS: readonly { id: MotionPreference; label: string }[] = [
  { id: 'auto', label: 'Match system' },
  { id: 'reduce', label: 'Reduce motion' },
  { id: 'full', label: 'Full motion' },
];

const STORAGE_KEY = 'aikami_gameplay_settings';

// ── Implementation ──────────────────────────────────────────────────────

class GameplayViewModel
  extends BaseViewModel<GameplayViewModelOptions>
  implements GameplayViewModelInterface
{
  private readonly _overlay: GameplayOverlayCapabilities;
  private readonly _motion: GameplayMotionCapabilities;

  tutorialHints = $state<boolean>(true);
  autosave = $state<boolean>(true);
  difficulty = $state<string>('medium');

  constructor(options: GameplayViewModelOptions) {
    super(options);
    this._overlay = options.overlay;
    this._motion = options.motion;
  }

  get difficultyOptions(): readonly { id: string; label: string }[] {
    return DIFFICULTY_OPTIONS;
  }

  get questOverlayVisible(): boolean {
    return this._overlay.visible;
  }

  /** @inheritdoc */
  get motionPreference(): MotionPreference {
    return this._motion.preference;
  }

  /** @inheritdoc */
  get motionOptions(): readonly { id: MotionPreference; label: string }[] {
    return MOTION_OPTIONS;
  }

  override async initialize(): Promise<void> {
    this._loadFromStorage();
    await super.initialize();
  }

  toggleTutorialHints(): void {
    this.tutorialHints = !this.tutorialHints;
    this._persist();
    this.debug('toggleTutorialHints', { tutorialHints: this.tutorialHints });
  }

  toggleAutosave(): void {
    this.autosave = !this.autosave;
    this._persist();
    this.debug('toggleAutosave', { autosave: this.autosave });
  }

  toggleQuestOverlay(): void {
    this._overlay.toggleVisible();
    this.debug('toggleQuestOverlay', { visible: this._overlay.visible });
  }

  setDifficulty(id: string): void {
    // Validate that the ID exists in DIFFICULTY_OPTIONS
    const isValid = DIFFICULTY_OPTIONS.some((opt) => opt.id === id);
    if (!isValid) {
      this.debug('setDifficulty: invalid ID, ignoring', { id });
      return;
    }
    this.difficulty = id;
    this._persist();
    this.debug('setDifficulty', { difficulty: this.difficulty });
  }

  /** @inheritdoc */
  setMotionPreference(preference: MotionPreference): void {
    if (!MOTION_PREFERENCES.includes(preference)) {
      this.debug('setMotionPreference: invalid value, ignoring', { preference });
      return;
    }
    // Persistence belongs to the shared service (C-527 AC-6), so the game HUD
    // reads the same value the moment this control changes.
    this._motion.setPreference(preference);
    this.debug('setMotionPreference', { preference });
  }

  resetDefaults(): void {
    this.tutorialHints = true;
    this.autosave = true;
    this.difficulty = 'medium';
    // Restore the quest overlay to its default (visible) state.
    this._overlay.setVisible(true);
    // C-527 AC-6: `auto` is the default — the OS preference decides.
    this._motion.setPreference('auto');
    this._persist();
    this.debug('resetDefaults');
  }

  private _persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          tutorialHints: this.tutorialHints,
          autosave: this.autosave,
          difficulty: this.difficulty,
        }),
      );
    } catch {
      // localStorage may be unavailable
    }
  }

  private _loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed.tutorialHints === 'boolean') {
          this.tutorialHints = parsed.tutorialHints;
        }
        if (typeof parsed.autosave === 'boolean') {
          this.autosave = parsed.autosave;
        }
        if (typeof parsed.difficulty === 'string') {
          // Validate difficulty ID before assigning
          const isValid = DIFFICULTY_OPTIONS.some((opt) => opt.id === parsed.difficulty);
          if (isValid) {
            this.difficulty = parsed.difficulty;
          } else {
            // Reset to medium if persisted value is invalid
            this.difficulty = 'medium';
          }
        }
      }
    } catch {
      // Invalid stored data — keep defaults
    }
  }
}

/**
 * Builds a gameplay settings ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getGameplayViewModel` in ./gameplay_composition.ts.
 */
export const createGameplayViewModel = (
  options: GameplayViewModelOptions,
): GameplayViewModelInterface => GameplayViewModel.create(options);
