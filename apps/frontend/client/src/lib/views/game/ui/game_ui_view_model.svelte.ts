// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { routerService } from '$services';
import type { GameViewModelInterface } from '../canvas/game_view_model.svelte';

// ---------------------------------------------------------------------------
// GameUIViewModel — overlay router for the game UI layer
//
// Manages reactive overlay state (pause menu, dialogue, combat) and
// captures keyboard input (Escape) to toggle overlays. Lives inside
// the #game-ui-layer DOM element from C-124.
//
// Contract: C-125 Game UI Overlay Architecture & State Sync
// ---------------------------------------------------------------------------

/** Discriminated union of all possible game overlay states. */
export type GameOverlayType = 'NONE' | 'PAUSE_MENU' | 'DIALOGUE' | 'COMBAT';

export type GameUIViewModelOptions = BaseViewModelOptions & {
  /** Reference to the owning GameViewModel for engine control. */
  gameViewModel: GameViewModelInterface;
};

export type GameUIViewModelInterface = BaseViewModelInterface & {
  /** The currently active overlay. 'NONE' when no overlay is visible. */
  readonly activeOverlay: GameOverlayType;

  /**
   * Handles global keydown events for overlay toggling.
   * Escape opens/closes the pause menu.
   */
  handleKeyDown(event: KeyboardEvent): void;

  /** Closes the current overlay and resumes the game. */
  resumeGame(): void;

  /** Navigates to the settings page. Placeholder for full in-game settings. */
  goToSettings(): Promise<void>;

  /**
   * Quits to the main menu (Start Menu at /).
   * SvelteKit unmount triggers GameViewModel.dispose() which cleans up
   * the engine (PixiJS, worker, listeners).
   */
  quitToMainMenu(): Promise<void>;
};

class GameUIViewModel
  extends BaseViewModel<GameUIViewModelOptions>
  implements GameUIViewModelInterface
{
  activeOverlay = $state<GameOverlayType>('NONE');

  private readonly _gameViewModel: GameViewModelInterface;

  constructor(options: GameUIViewModelOptions) {
    super(options);
    this._gameViewModel = options.gameViewModel;
  }

  /** @inheritdoc */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this._togglePauseMenu();
    }
  }

  /**
   * Toggles the pause menu overlay.
   *
   * When opening: pauses the game engine (stops the tick loop + locks input).
   * When closing: resumes the game engine.
   */
  private _togglePauseMenu(): void {
    if (this.activeOverlay === 'PAUSE_MENU') {
      this.resumeGame();
    } else if (this.activeOverlay === 'NONE') {
      this.activeOverlay = 'PAUSE_MENU';
      this._gameViewModel.pauseEngine();
    }
  }

  /** @inheritdoc */
  resumeGame(): void {
    this.activeOverlay = 'NONE';
    this._gameViewModel.resumeEngine();
  }

  /** @inheritdoc */
  async goToSettings(): Promise<void> {
    await routerService.goToRoute('settings', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  async quitToMainMenu(): Promise<void> {
    // Navigating away unmounts the GameView → BaseViewModelContainer
    // calls GameViewModel.dispose() → destroys PixiJS + worker + listeners.
    await routerService.navigateToApp();
  }
}

export { GameUIViewModel };
