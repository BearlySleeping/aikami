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
import { gameEngineService, gameModeService } from '$services';
import type { ActiveContextEntry } from '$types';

// ---------------------------------------------------------------------------
// GameViewViewModel — thin bridge between the game canvas view and
// the GameEngineService. Follows the Svelte 5 ViewModel pattern.
//
// All engine lifecycle, bridge events, and game state live in
// GameEngineService. This ViewModel exposes reactive state to the
// View and keeps the View free of engine imports.
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
 * Thin ViewModel bridge to {@link GameEngineService}.
 *
 * All reactive state is read directly from the singleton service's
 * `$state` fields. The only logic here is the canvas-binding `$effect`
 * that connects the View's `<canvas bind:this>` to the engine.
 */
class GameCanvasViewModel
  extends BaseViewModel<GameCanvasViewModelOptions>
  implements GameCanvasViewModelInterface
{
  // ── Bindable canvas element (owned here, forwarded to service) ──

  /**
   * Canvas element bound via bind:this from the View.
   * Uses $state.raw so Svelte doesn't deep-proxy the WebGL canvas.
   * When set, forwarded to {@link GameEngineService} for engine boot.
   */
  canvasElement = $state.raw<HTMLCanvasElement | undefined>(undefined);

  // ── Reactive state (proxied from service) ──

  get playerScene(): string {
    return gameEngineService.playerScene;
  }

  get isGameReady(): boolean {
    return gameEngineService.isGameReady;
  }

  get gameError(): string | undefined {
    return gameEngineService.gameError;
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
    // Set up the reactive canvas binding: when the View binds
    // canvasElement (via bind:this), forward it to the service
    // and boot/destroy the engine.
    this.registerEffectRoot(() => {
      $effect(() => {
        const canvas = this.canvasElement;
        if (canvas) {
          gameEngineService.canvasElement = canvas;
          void gameEngineService.bootWithCanvas(canvas);
        }

        return () => {
          gameEngineService.canvasElement = undefined;
          gameEngineService.destroyEngine();
        };
      });
    });

    // Initialize the engine bridge (register listeners, load persona).
    await gameEngineService.initializeEngine();

    // If canvas was already bound when the $effect fired, bootWithCanvas
    // may have returned early because the bridge wasn't initialized yet.
    // Retry now that the bridge is guaranteed to be available.
    if (this.canvasElement) {
      void gameEngineService.bootWithCanvas(this.canvasElement);
    }

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
 * Factory function for creating a GameViewViewModel.
 *
 * Follows the Svelte 5 `getXViewModel` pattern — see
 * {@link getPersonaListViewModel} for reference.
 */
export const getGameCanvasViewModel = (
  options: GameCanvasViewModelOptions,
): GameCanvasViewModelInterface => GameCanvasViewModel.create(options);
