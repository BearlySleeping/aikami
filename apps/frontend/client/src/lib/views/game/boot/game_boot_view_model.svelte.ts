// apps/frontend/client/src/lib/views/game/boot/game_boot_view_model.svelte.ts
//
// ViewModel for the stage-aware game boot loading/error view.
// Exposes reactive boot progress from the boot service and
// provides retry / return-to-menu actions.
//
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gameBootService, routerService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GameBootViewModelOptions = BaseViewModelOptions;

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

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class GameBootViewModel
  extends BaseViewModel<GameBootViewModelOptions>
  implements GameBootViewModelInterface
{
  // ── Computed from boot service ──

  get stageLabel(): string {
    return gameBootService.bootProgress.detail ?? gameBootService.bootProgress.stage;
  }

  get stageIndex(): number {
    return gameBootService.bootProgress.stageIndex;
  }

  get stageCount(): number {
    return gameBootService.bootProgress.stageCount;
  }

  get detail(): string | undefined {
    return gameBootService.bootProgress.detail;
  }

  get isFailed(): boolean {
    return gameBootService.bootProgress.stage === 'failed';
  }

  get bootErrorMessage(): string {
    return gameBootService.bootProgress.error ?? 'An unknown error occurred during boot.';
  }

  get isBooting(): boolean {
    return gameBootService.isBooting;
  }

  get isReady(): boolean {
    return gameBootService.bootProgress.stage === 'ready';
  }

  // ── Actions ──

  /** @inheritdoc */
  retryBoot(): void {
    this.debug('retryBoot');
    gameBootService.resetForRetry();
    // The canvas ViewModel's $effect will re-trigger when the boot state resets
    // and the canvas element is already bound.
  }

  /** @inheritdoc */
  returnToMenu(): void {
    this.debug('returnToMenu');
    gameBootService.teardown();
    void routerService.goToHref('/');
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getGameBootViewModel = (
  options: GameBootViewModelOptions,
): GameBootViewModelInterface => GameBootViewModel.create(options);
