// apps/frontend/client/src/lib/views/game/boot/game_boot_view_model.svelte.ts
//
// ViewModel for the stage-aware game boot loading/error view. Exposes reactive
// boot progress from the injected boot capability and provides retry /
// return-to-menu actions.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/game_boot_fixtures.ts).
// Production wiring lives in ./game_boot_composition.ts.
//
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

// ── Capability contracts ────────────────────────────────────────────────

/** The boot progress snapshot the view reads (reactively). */
export type GameBootProgress = {
  readonly stage: string;
  readonly stageIndex: number;
  readonly stageCount: number;
  readonly detail?: string;
  readonly error?: string;
};

/** The boot pipeline operations and observable state. */
export type GameBootCapabilities = {
  readonly bootProgress: GameBootProgress;
  readonly isBooting: boolean;
  resetForRetry(): void;
  teardown(): void;
};

/** The navigation capability used to return to the main menu. */
export type GameBootRouterCapabilities = {
  goToHref(href: string): Promise<void>;
};

// ── Types ───────────────────────────────────────────────────────────────

export type GameBootViewModelOptions = BaseViewModelOptions & {
  /** Boot pipeline capability. */
  boot: GameBootCapabilities;
  /** Navigation capability. */
  router: GameBootRouterCapabilities;
};

export type GameBootViewModelInterface = BaseViewModelInterface & {
  readonly stageLabel: string;
  readonly stageIndex: number;
  readonly stageCount: number;
  readonly detail: string | undefined;
  readonly isFailed: boolean;
  readonly bootErrorMessage: string;
  readonly isBooting: boolean;
  readonly isReady: boolean;

  /** Retry the boot pipeline from stage 0. */
  retryBoot(): void;
  /** Navigate back to the main menu with full teardown. */
  returnToMenu(): void;
};

// ── Implementation ──────────────────────────────────────────────────────

class GameBootViewModel
  extends BaseViewModel<GameBootViewModelOptions>
  implements GameBootViewModelInterface
{
  private readonly _boot: GameBootCapabilities;
  private readonly _router: GameBootRouterCapabilities;

  constructor(options: GameBootViewModelOptions) {
    super(options);
    this._boot = options.boot;
    this._router = options.router;
  }

  // ── Computed from boot capability ──

  get stageLabel(): string {
    return this._boot.bootProgress.detail ?? this._boot.bootProgress.stage;
  }

  get stageIndex(): number {
    return this._boot.bootProgress.stageIndex;
  }

  get stageCount(): number {
    return this._boot.bootProgress.stageCount;
  }

  get detail(): string | undefined {
    return this._boot.bootProgress.detail;
  }

  get isFailed(): boolean {
    return this._boot.bootProgress.stage === 'failed';
  }

  get bootErrorMessage(): string {
    return this._boot.bootProgress.error ?? 'An unknown error occurred during boot.';
  }

  get isBooting(): boolean {
    return this._boot.isBooting;
  }

  get isReady(): boolean {
    return this._boot.bootProgress.stage === 'ready';
  }

  // ── Actions ──

  /** @inheritdoc */
  retryBoot(): void {
    this.debug('retryBoot');
    this._boot.resetForRetry();
    // The canvas ViewModel's $effect will re-trigger when the boot state resets
    // and the canvas element is already bound.
  }

  /** @inheritdoc */
  returnToMenu(): void {
    this.debug('returnToMenu');
    this._boot.teardown();
    void this._router.goToHref('/');
  }
}

/**
 * Builds a game-boot ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getGameBootViewModel` in ./game_boot_composition.ts.
 */
export const createGameBootViewModel = (
  options: GameBootViewModelOptions,
): GameBootViewModelInterface => GameBootViewModel.create(options);
