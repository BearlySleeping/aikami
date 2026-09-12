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
} from '@aikami/frontend/services/base';
import type { CombatViewModelInterface } from '$views/combat/combat_view_model.svelte';
import type { getGameCanvasViewModel } from '$views/game/canvas/game_canvas_composition.ts';
import type { GameCanvasViewModelInterface } from '$views/game/canvas/game_canvas_view_model.svelte';
import type { getGameUIViewModel } from '$views/game/ui/game_ui_composition.ts';
import type { GameUIViewModelInterface } from '$views/game/ui/game_ui_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The composition-root lifecycle the game ViewModel drives. */
export type GameCompositionCapabilities = {
  initialize(): Promise<void>;
  dispose(): Promise<void>;
};

export type GameViewModelOptions = BaseViewModelOptions & {
  /** Runtime composition root. */
  composition: GameCompositionCapabilities;
  /** Canvas sub-ViewModel factory. */
  createCanvasViewModel: typeof getGameCanvasViewModel;
  /** UI sub-ViewModel factory. */
  createUIViewModel: typeof getGameUIViewModel;
};

export type GameViewModelInterface = BaseViewModelInterface & {
  readonly isCombat: boolean;
  readonly activeCombatViewModel: CombatViewModelInterface | undefined;
  readonly canvasViewModel: GameCanvasViewModelInterface;
  readonly uiViewModel: GameUIViewModelInterface;

  handleKeyDown(event: KeyboardEvent): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class GameViewModel extends BaseViewModel<GameViewModelOptions> implements GameViewModelInterface {
  private readonly _composition: GameCompositionCapabilities;
  private readonly _createCanvasViewModel: typeof getGameCanvasViewModel;
  private readonly _createUIViewModel: typeof getGameUIViewModel;

  /** Canvas ViewModel — created eagerly in constructor, no async init needed. */
  readonly canvasViewModel: GameCanvasViewModelInterface;

  /** UI overlay ViewModel — created eagerly in constructor. */
  readonly uiViewModel: GameUIViewModelInterface;

  constructor(options: GameViewModelOptions) {
    super(options);
    this._composition = options.composition;
    this._createCanvasViewModel = options.createCanvasViewModel;
    this._createUIViewModel = options.createUIViewModel;

    this.canvasViewModel = this._createCanvasViewModel({
      className: 'GameCanvasViewModel',
    });
    this.uiViewModel = this._createUIViewModel({ className: 'GameUIViewModel' });
  }

  get isCombat(): boolean {
    return this.canvasViewModel.isCombat;
  }

  get activeCombatViewModel(): CombatViewModelInterface | undefined {
    if (!this.isCombat) {
      return undefined;
    }
    return this.uiViewModel.combatViewModel;
  }

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    // Boot the composition root — idempotent, safe to call across remounts.
    await this._composition.initialize();

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
    await this.canvasViewModel.dispose();
    await this.uiViewModel.dispose();
    await this._composition.dispose();
    await super.dispose();
  }
}

/**
 * Builds the game ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getGameViewModel` in ./game_composition.ts.
 */
export const createGameViewModel = (options: GameViewModelOptions): GameViewModelInterface =>
  GameViewModel.create(options);
