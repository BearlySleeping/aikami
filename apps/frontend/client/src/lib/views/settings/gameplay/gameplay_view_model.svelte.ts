// apps/frontend/client/src/lib/views/settings/gameplay/gameplay_view_model.svelte.ts
//
// GameplayViewModel — options overview for the Basic settings tier.
// Language, region, accessibility quick-toggles, difficulty, autosave, tutorial hints.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GameplayViewModelInterface = BaseViewModelInterface & {
  /** Whether tutorial hints are enabled. */
  readonly tutorialHints: boolean;
  /** Whether autosave is enabled. */
  readonly autosave: boolean;
  /** Selected difficulty level. */
  readonly difficulty: string;
  /** Available difficulty options. */
  readonly difficultyOptions: readonly { id: string; label: string }[];

  toggleTutorialHints(): void;
  toggleAutosave(): void;
  setDifficulty(id: string): void;
  resetDefaults(): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type GameplayViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIFFICULTY_OPTIONS = [
  { id: 'story', label: 'Story' },
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Hard' },
] as const;

const STORAGE_KEY = 'aikami_gameplay_settings';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class GameplayViewModel
  extends BaseViewModel<GameplayViewModelOptions>
  implements GameplayViewModelInterface
{
  tutorialHints = $state<boolean>(true);
  autosave = $state<boolean>(true);
  difficulty = $state<string>('normal');

  get difficultyOptions(): readonly { id: string; label: string }[] {
    return DIFFICULTY_OPTIONS;
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

  setDifficulty(id: string): void {
    this.difficulty = id;
    this._persist();
    this.debug('setDifficulty', { difficulty: this.difficulty });
  }

  resetDefaults(): void {
    this.tutorialHints = true;
    this.autosave = true;
    this.difficulty = 'normal';
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
          this.difficulty = parsed.difficulty;
        }
      }
    } catch {
      // Invalid stored data — keep defaults
    }
  }
}

export const getGameplayViewModel = (
  options: GameplayViewModelOptions,
): GameplayViewModelInterface => GameplayViewModel.create(options);
