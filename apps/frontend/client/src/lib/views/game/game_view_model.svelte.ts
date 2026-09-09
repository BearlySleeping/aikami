// apps/frontend/client/src/lib/views/game/game_view_model.svelte.ts
//
// Main game ViewModel — owns the composition root lifecycle, creates
// all sub-ViewModels, and exposes reactive state to the View.
//
// Contract: C-314 — Production game composition root

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gameCompositionRoot, gameOverlayService, memoryRetrievalService } from '$services';
import type { CombatViewModelInterface } from '../combat/combat_view_model.svelte';
import type { GameCanvasViewModelInterface } from './canvas/game_canvas_view_model.svelte';
import { getGameCanvasViewModel } from './canvas/game_canvas_view_model.svelte';
import type { GameUIViewModelInterface } from './ui/game_ui_view_model.svelte';
import { getGameUIViewModel } from './ui/game_ui_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GameViewModelOptions = BaseViewModelOptions;

export type GameViewModelInterface = BaseViewModelInterface & {
  readonly isCombat: boolean;
  readonly combatViewModel: CombatViewModelInterface | undefined;
  readonly canvasViewModel: GameCanvasViewModelInterface;
  readonly uiViewModel: GameUIViewModelInterface;
  /** True once the post-hydration boot hook has initialised the memory index (C-492 AC-2). */
  readonly memoryReady: boolean;

  handleKeyDown(event: KeyboardEvent): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class GameViewModel extends BaseViewModel<GameViewModelOptions> implements GameViewModelInterface {
  /** Canvas ViewModel — created eagerly in constructor, no async init needed. */
  canvasViewModel = $state<GameCanvasViewModelInterface>(
    getGameCanvasViewModel({ className: 'GameCanvasViewModel' }),
  );

  /** UI overlay ViewModel — created eagerly in constructor. */
  uiViewModel = $state<GameUIViewModelInterface>(
    getGameUIViewModel({ className: 'GameUIViewModel' }),
  );

  /**
   * Bound handler for the `aikami:quick-save` E2E hook (C-492 AC-3). Assigned
   * in initialize(), cleared in dispose(); null while no listener is registered.
   */
  private _quickSaveHandler: (() => void) | null = null;

  get isCombat(): boolean {
    return this.canvasViewModel.isCombat;
  }

  get combatViewModel(): CombatViewModelInterface | undefined {
    return this.uiViewModel.combatViewModel;
  }

  /** True once the post-hydration boot hook has initialised the memory index (C-492 AC-2). */
  get memoryReady(): boolean {
    return memoryRetrievalService.isReady;
  }

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    // E2E save hook (C-492 AC-3): a document-level `aikami:quick-save` event
    // drives the real persistence path so tests can save+reload the campaign
    // without UI chrome. Inert in normal play.
    this._quickSaveHandler = () => {
      void gameOverlayService.saveGame();
    };
    window.addEventListener('aikami:quick-save', this._quickSaveHandler);

    // Boot the composition root — idempotent, safe to call across remounts.
    await gameCompositionRoot.initialize();

    // Initialize child ViewModels — GameCanvasViewModel starts the engine,
    // GameUIViewModel sets up overlay effects and keyboard handling
    await this.canvasViewModel.initialize();
    await this.uiViewModel.initialize();

    await super.initialize();
  }

  // ── Delegated ──

  handleKeyDown(event: KeyboardEvent): void {
    this.uiViewModel.handleKeyDown(event);
  }

  override async dispose(): Promise<void> {
    if (this._quickSaveHandler) {
      window.removeEventListener('aikami:quick-save', this._quickSaveHandler);
      this._quickSaveHandler = null;
    }
    await this.canvasViewModel.dispose();
    await this.uiViewModel.dispose();
    await gameCompositionRoot.dispose();
    await super.dispose();
  }
}

export const getGameViewModel = (options: GameViewModelOptions): GameViewModelInterface =>
  GameViewModel.create(options);
