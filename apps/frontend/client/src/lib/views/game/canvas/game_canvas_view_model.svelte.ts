// apps/frontend/client/src/lib/views/game/canvas/game_canvas_view_model.svelte.ts

import type { GameCommand } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type {
  CombatantScreenState,
  FloatingTextInstance,
} from '$lib/services/game/game_engine_service.svelte.ts';
import { gameBootService, gameEngineService, gameModeService } from '$services';
import type { ActiveContextEntry } from '$types';

// ---------------------------------------------------------------------------
// GameCanvasViewModel — thin bridge between the game canvas view and
// the game engine/boot services. Follows the Svelte 5 ViewModel pattern.
//
// Contract: C-326 — Cancellable staged boot orchestrator
//
// The ViewModel owns the canvas element binding and triggers the boot
// service when the canvas element arrives. Engine lifecycle state (bridge
// events, game state) remain in GameEngineService.
// ---------------------------------------------------------------------------

export type GameCanvasViewModelOptions = BaseViewModelOptions;

export type GameCanvasViewModelInterface = BaseViewModelInterface & {
  readonly playerScene: string;
  readonly isGameReady: boolean;
  readonly gameError: string | undefined;
  readonly activeContexts: readonly ActiveContextEntry[];
  readonly playerDisplayName: string;
  readonly floatingTexts: readonly FloatingTextInstance[];
  readonly combatantScreenStates: readonly CombatantScreenState[];
  readonly isShaking: boolean;

  /** Whether the combat split-screen layout is active. */
  readonly isCombat: boolean;

  /** Canvas element bound via bind:this from the View. */
  canvasElement: HTMLCanvasElement | undefined;

  removeFloatingText(id: number): void;
  sendCommand(command: GameCommand): void;
  pauseEngine(): void;
  resumeEngine(): void;
  triggerResize(): void;
  loadMap(options: {
    mapUrl: string;
    targetX: number;
    targetY: number;
    defeatedEnemies?: string[];
    targetSpawnHash?: number;
    disableClamping?: boolean;
  }): Promise<void>;
  loadSave(payload: string): Promise<void>;
};

/**
 * Thin ViewModel bridge to the boot service and engine service.
 *
 * All reactive game state is read directly from the game engine service's
 * `$state` fields. Boot orchestration is delegated to the boot service.
 * The sole logic here is the canvas-binding `$effect` that triggers the
 * boot pipeline exactly once per route entry, with cancellation on teardown.
 */
class GameCanvasViewModel
  extends BaseViewModel<GameCanvasViewModelOptions>
  implements GameCanvasViewModelInterface
{
  // ── Bindable canvas element ──

  /**
   * Canvas element bound via bind:this from the View.
   * Uses $state.raw so Svelte doesn't deep-proxy the WebGL canvas.
   * When set, triggers the boot pipeline via {@link GameBootService}.
   */
  canvasElement = $state.raw<HTMLCanvasElement | undefined>(undefined);

  /** Tracks whether boot has been triggered for this lifecycle. */
  private _booted = false;

  // ── Reactive state (proxied from engine service) ──

  get playerScene(): string {
    return gameEngineService.playerScene;
  }

  get isGameReady(): boolean {
    return gameEngineService.isGameReady;
  }

  get gameError(): string | undefined {
    return gameBootService.bootProgress.error ?? gameEngineService.gameError;
  }

  get activeContexts(): readonly ActiveContextEntry[] {
    return gameEngineService.activeContexts;
  }

  get playerDisplayName(): string {
    return gameEngineService.playerDisplayName;
  }

  get floatingTexts(): readonly FloatingTextInstance[] {
    return gameEngineService.floatingTexts;
  }

  get combatantScreenStates(): readonly CombatantScreenState[] {
    return gameEngineService.combatantScreenStates;
  }

  get isShaking(): boolean {
    return gameEngineService.isShaking;
  }

  /** Whether the combat split-screen layout (CSS Grid) is active. */
  get isCombat(): boolean {
    return gameModeService.currentMode === 'COMBAT';
  }

  // ── Lifecycle ──

  /** @inheritdoc */
  async initialize(): Promise<void> {
    // Single reactive effect: when the View binds the canvas element,
    // launch the boot orchestrator. On cleanup, cancel and teardown.
    this.registerEffectRoot(() => {
      $effect(() => {
        const canvas = this.canvasElement;
        if (canvas && !this._booted) {
          this._booted = true;

          // Boot service resolves campaign/persona from already-initialized services.
          // Only the canvas element is forwarded from the View.
          void gameBootService.boot({ canvas, contentPackId: 'emberwatch' });
        }

        return () => {
          // Navigation away — cancel in-flight boot and teardown
          gameBootService.cancelBoot();
          gameEngineService.destroyEngine();
          this._booted = false;
        };
      });
    });

    // Initialize the engine bridge (register listeners).
    await gameEngineService.initializeEngine();

    await super.initialize();
  }

  // ── Delegated methods ──

  /** @inheritdoc */
  removeFloatingText(id: number): void {
    gameEngineService.removeFloatingText(id);
  }

  /** @inheritdoc */
  sendCommand(command: GameCommand): void {
    gameEngineService.sendCommand(command);
  }

  /** @inheritdoc */
  pauseEngine(): void {
    gameEngineService.pauseEngine();
  }

  /** @inheritdoc */
  resumeEngine(): void {
    gameEngineService.resumeEngine();
  }

  /** @inheritdoc */
  triggerResize(): void {
    gameEngineService.triggerResize();
  }

  /** @inheritdoc */
  async loadMap(options: {
    mapUrl: string;
    targetX: number;
    targetY: number;
    defeatedEnemies?: string[];
    targetSpawnHash?: number;
    disableClamping?: boolean;
  }): Promise<void> {
    await gameEngineService.loadMap(options);
  }

  /** @inheritdoc */
  async loadSave(payload: string): Promise<void> {
    await gameEngineService.loadSave(payload);
  }
}

/**
 * Factory function for creating a GameCanvasViewModel.
 */
export const getGameCanvasViewModel = (
  options: GameCanvasViewModelOptions,
): GameCanvasViewModelInterface => GameCanvasViewModel.create(options);
