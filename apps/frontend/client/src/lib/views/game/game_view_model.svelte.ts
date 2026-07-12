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
import { getGameCompositionRoot } from '$lib/services/game/game_composition_root.svelte';
import { authService } from '$services';
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

  handleKeyDown(event: KeyboardEvent): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class GameViewModel extends BaseViewModel<GameViewModelOptions> implements GameViewModelInterface {
  /** Tracks whether composition root initialization has been attempted. */
  private _compositionRootInitialized = false;

  /** Canvas ViewModel — created eagerly in constructor, no async init needed. */
  canvasViewModel = $state<GameCanvasViewModelInterface>(
    getGameCanvasViewModel({ className: 'GameCanvasViewModel' }),
  );

  /** UI overlay ViewModel — created eagerly in constructor. */
  uiViewModel = $state<GameUIViewModelInterface>(
    getGameUIViewModel({ className: 'GameUIViewModel' }),
  );

  get isCombat(): boolean {
    return this.canvasViewModel.isCombat;
  }

  get combatViewModel(): CombatViewModelInterface | undefined {
    return this.uiViewModel.combatViewModel;
  }

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    // Boot the composition root (idempotent — safe across remounts)
    await this._ensureCompositionRootBoot();

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

  // ── Private ──

  /**
   * Boots the game composition root exactly once.
   * The composition root handles idempotency internally —
   * calling initialize() twice returns the already-initialized state.
   */
  private async _ensureCompositionRootBoot(): Promise<void> {
    if (this._compositionRootInitialized) {
      return;
    }
    this._compositionRootInitialized = true;

    const compositionRoot = getGameCompositionRoot({
      className: 'GameCompositionRoot',
      uid: authService.uid ?? 'anonymous',
    });
    await compositionRoot.initialize();
  }
}

export const getGameViewModel = (options: GameViewModelOptions): GameViewModelInterface =>
  GameViewModel.create(options);
