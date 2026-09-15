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
import { type CombatLayout, combatSheetHeight, resolveCombatLayout } from './ui/combat_layout.ts';

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
  readonly rootFontSize: number;
  readonly combatLayout: CombatLayout;
  readonly isSplitCombat: boolean;
  readonly isSheetCombat: boolean;
  readonly hasCombatLayout: boolean;
  readonly combatShellStyle: string;
  readonly combatSheetHeight: number;
  readonly combatSheetStyle: string;
  readonly combatSurfaceTestId: string;

  handleKeyDown(event: KeyboardEvent): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class GameViewModel extends BaseViewModel<GameViewModelOptions> implements GameViewModelInterface {
  private readonly _composition: GameCompositionCapabilities;
  private readonly _createCanvasViewModel: typeof getGameCanvasViewModel;
  private readonly _createUIViewModel: typeof getGameUIViewModel;
  private _viewportWidth = $state(0);
  private _viewportHeight = $state(0);
  private _rootFontSizeProbe: HTMLElement | undefined;
  private _rootFontSizeObserver: ResizeObserver | undefined;
  private _viewportResizeListener: (() => void) | undefined;

  rootFontSize = $state(16);

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

  get combatLayout(): CombatLayout {
    return resolveCombatLayout({
      width: this._viewportWidth,
      height: this._viewportHeight,
      rootFontSize: this.rootFontSize,
    });
  }

  get isSplitCombat(): boolean {
    return this.isCombat && this.combatLayout === 'split';
  }

  get isSheetCombat(): boolean {
    return this.isCombat && this.combatLayout === 'sheet';
  }

  get hasCombatLayout(): boolean {
    return this.activeCombatViewModel !== undefined && (this.isSplitCombat || this.isSheetCombat);
  }

  get combatShellStyle(): string {
    return this.isSplitCombat
      ? 'grid-template-columns: clamp(20rem, 28vw, 32rem) minmax(0, 1fr);'
      : '';
  }

  get combatSheetStyle(): string {
    return this.isSheetCombat ? `height: ${this.combatSheetHeight}px;` : '';
  }

  get combatSheetHeight(): number {
    return combatSheetHeight(this._viewportHeight, this.rootFontSize);
  }

  get combatSurfaceTestId(): string {
    return this.isSplitCombat ? 'combat-side-rail' : 'combat-action-sheet';
  }

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    // Boot the composition root — idempotent, safe to call across remounts.
    await this._composition.initialize();

    // Initialize child ViewModels — GameCanvasViewModel starts the engine,
    // GameUIViewModel sets up overlay effects and keyboard handling
    await this.canvasViewModel.initialize();
    await this.uiViewModel.initialize();

    this._startLayoutTracking();

    await super.initialize();
  }

  // ── Delegated ──

  handleKeyDown(event: KeyboardEvent): void {
    this.uiViewModel.handleKeyDown(event);
  }

  override async dispose(): Promise<void> {
    this._stopLayoutTracking();
    await this.canvasViewModel.dispose();
    await this.uiViewModel.dispose();
    await this._composition.dispose();
    await super.dispose();
  }

  /** Keeps viewport and rem-based budgets reactive without view-owned state. */
  private _startLayoutTracking(): void {
    this._stopLayoutTracking();
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    this._viewportResizeListener = () => this._readViewport();
    window.addEventListener('resize', this._viewportResizeListener);
    this._readViewport();

    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;width:1rem;height:1px;overflow:hidden;';
    document.body.append(probe);
    this._rootFontSizeProbe = probe;
    this._readRootFontSize();

    if (typeof ResizeObserver !== 'undefined') {
      this._rootFontSizeObserver = new ResizeObserver(() => this._readRootFontSize());
      this._rootFontSizeObserver.observe(probe);
    }
  }

  private _stopLayoutTracking(): void {
    if (typeof window !== 'undefined' && this._viewportResizeListener) {
      window.removeEventListener('resize', this._viewportResizeListener);
    }
    this._viewportResizeListener = undefined;
    this._rootFontSizeObserver?.disconnect();
    this._rootFontSizeObserver = undefined;
    this._rootFontSizeProbe?.remove();
    this._rootFontSizeProbe = undefined;
  }

  private _readViewport(): void {
    this._viewportWidth = window.innerWidth;
    this._viewportHeight = window.innerHeight;
  }

  private _readRootFontSize(): void {
    const measured = this._rootFontSizeProbe?.getBoundingClientRect().width;
    this.rootFontSize = measured && Number.isFinite(measured) ? measured : 16;
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
