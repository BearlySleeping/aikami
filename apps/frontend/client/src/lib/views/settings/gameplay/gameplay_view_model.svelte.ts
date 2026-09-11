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

// ── Capability contracts ────────────────────────────────────────────────

/** The quest-overlay visibility capability. */
export type GameplayOverlayCapabilities = {
  readonly visible: boolean;
  toggleVisible(): void;
  setVisible(visible: boolean): void;
};

// ── Types ───────────────────────────────────────────────────────────────

export type GameplayViewModelOptions = BaseViewModelOptions & {
  /** Quest-overlay visibility capability. */
  overlay: GameplayOverlayCapabilities;
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

  toggleTutorialHints(): void;
  toggleAutosave(): void;
  setDifficulty(id: string): void;
  toggleQuestOverlay(): void;
  resetDefaults(): void;
};

// ── Constants ───────────────────────────────────────────────────────────

const DIFFICULTY_OPTIONS = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
] as const;

const STORAGE_KEY = 'aikami_gameplay_settings';

// ── Implementation ──────────────────────────────────────────────────────

class GameplayViewModel
  extends BaseViewModel<GameplayViewModelOptions>
  implements GameplayViewModelInterface
{
  private readonly _overlay: GameplayOverlayCapabilities;

  tutorialHints = $state<boolean>(true);
  autosave = $state<boolean>(true);
  difficulty = $state<string>('medium');

  constructor(options: GameplayViewModelOptions) {
    super(options);
    this._overlay = options.overlay;
  }

  get difficultyOptions(): readonly { id: string; label: string }[] {
    return DIFFICULTY_OPTIONS;
  }

  get questOverlayVisible(): boolean {
    return this._overlay.visible;
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

  resetDefaults(): void {
    this.tutorialHints = true;
    this.autosave = true;
    this.difficulty = 'medium';
    // Restore the quest overlay to its default (visible) state.
    this._overlay.setVisible(true);
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
