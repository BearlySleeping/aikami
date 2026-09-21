// apps/frontend/client/src/lib/views/game/canvas/game_canvas_view_model.svelte.ts

import type { GameCommand } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type {
  CampaignServiceInterface,
  GameBootServiceInterface,
  GameEngineServiceInterface,
  GameModeServiceInterface,
} from '$services';
import type { ActiveContextEntry, CombatantScreenState, FloatingTextInstance } from '$types';

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

/** Campaign reads the canvas boot pipeline needs. */
export type GameCanvasCampaignCapabilities = Pick<CampaignServiceInterface, 'activeCampaign'>;

/** Boot-orchestrator operations and state the canvas drives. */
export type GameCanvasBootCapabilities = Pick<
  GameBootServiceInterface,
  'bootProgress' | 'isBooting' | 'boot' | 'teardown'
>;

/** Engine state and command surface the canvas exposes. */
export type GameCanvasEngineCapabilities = Pick<
  GameEngineServiceInterface,
  | 'playerScene'
  | 'isGameReady'
  | 'gameError'
  | 'activeContexts'
  | 'playerDisplayName'
  | 'floatingTexts'
  | 'combatantScreenStates'
  | 'isShaking'
  | 'initializeEngine'
  | 'destroyEngine'
  | 'removeFloatingText'
  | 'sendCommand'
  | 'pauseEngine'
  | 'resumeEngine'
  | 'triggerResize'
  | 'loadMap'
  | 'loadSave'
>;

/** Game-mode read the canvas uses to detect combat. */
export type GameCanvasModeCapabilities = Pick<GameModeServiceInterface, 'currentMode'>;

export type GameCanvasViewModelOptions = BaseViewModelOptions & {
  /** Campaign capability. */
  campaign: GameCanvasCampaignCapabilities;
  /** Boot-orchestrator capability. */
  boot: GameCanvasBootCapabilities;
  /** Engine capability. */
  engine: GameCanvasEngineCapabilities;
  /** Game-mode capability. */
  mode: GameCanvasModeCapabilities;
};

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
  private readonly _campaign: GameCanvasCampaignCapabilities;
  private readonly _boot: GameCanvasBootCapabilities;
  private readonly _engine: GameCanvasEngineCapabilities;
  private readonly _mode: GameCanvasModeCapabilities;

  constructor(options: GameCanvasViewModelOptions) {
    super(options);
    this._campaign = options.campaign;
    this._boot = options.boot;
    this._engine = options.engine;
    this._mode = options.mode;
  }

  // ── Bindable canvas element ──

  /**
   * Canvas element bound via bind:this from the View.
   * Uses $state.raw so Svelte doesn't deep-proxy the WebGL canvas.
   * When set, triggers the boot pipeline via {@link GameBootService}.
   */
  canvasElement = $state.raw<HTMLCanvasElement | undefined>(undefined);

  // ── Reactive state (proxied from engine service) ──

  get playerScene(): string {
    return this._engine.playerScene;
  }

  get isGameReady(): boolean {
    return this._engine.isGameReady;
  }

  get gameError(): string | undefined {
    return this._boot.bootProgress.error ?? this._engine.gameError;
  }

  get activeContexts(): readonly ActiveContextEntry[] {
    return this._engine.activeContexts;
  }

  get playerDisplayName(): string {
    return this._engine.playerDisplayName;
  }

  get floatingTexts(): readonly FloatingTextInstance[] {
    return this._engine.floatingTexts;
  }

  get combatantScreenStates(): readonly CombatantScreenState[] {
    return this._engine.combatantScreenStates;
  }

  get isShaking(): boolean {
    return this._engine.isShaking;
  }

  /** Whether the combat split-screen layout (CSS Grid) is active. */
  get isCombat(): boolean {
    return this._mode.currentMode === 'COMBAT';
  }

  // ── Lifecycle ──

  /** @inheritdoc */
  async initialize(): Promise<void> {
    // Reactive canvas-binding effect: when the View binds the canvas element
    // and the boot service is idle, launch the boot orchestrator.
    //
    // The effect reads this._boot.bootProgress.stage as a dependency.
    // When resetForRetry() sets stage back to 'idle', the effect re-runs
    // and triggers a fresh boot attempt.
    this.registerEffectRoot(() => {
      $effect(() => {
        const canvas = this.canvasElement;
        const progress = this._boot.bootProgress;

        if (canvas && !this._boot.isBooting && progress.stage === 'idle') {
          // Boot service resolves campaign/persona from already-initialized services.
          // Only the canvas element is forwarded from the View.
          const contentPackId = this._campaign.activeCampaign?.contentPackId ?? 'emberwatch';
          void this._boot.boot({ canvas, contentPackId });
        }
      });
    });

    // Teardown effect: dependency-free cleanup that only runs on ViewModel destruction
    this.registerEffectRoot(() => {
      $effect(() => {
        return () => {
          // Navigation away — teardown engine resources.
          // teardown() always destroys the game world even after boot completes;
          // cancelBoot() is only effective during an active boot pipeline.
          this._boot.teardown();
          this._engine.destroyEngine();
        };
      });
    });

    // Initialize the engine bridge (register listeners).
    await this._engine.initializeEngine();

    await super.initialize();
  }

  // ── Delegated methods ──

  /** @inheritdoc */
  removeFloatingText(id: number): void {
    this._engine.removeFloatingText(id);
  }

  /** @inheritdoc */
  sendCommand(command: GameCommand): void {
    this._engine.sendCommand(command);
  }

  /** @inheritdoc */
  pauseEngine(): void {
    this._engine.pauseEngine();
  }

  /** @inheritdoc */
  resumeEngine(): void {
    this._engine.resumeEngine();
  }

  /** @inheritdoc */
  triggerResize(): void {
    this._engine.triggerResize();
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
    await this._engine.loadMap(options);
  }

  /** @inheritdoc */
  async loadSave(payload: string): Promise<void> {
    await this._engine.loadSave(payload);
  }
}

/**
 * Builds a game-canvas ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getGameCanvasViewModel` in
 * ./game_canvas_composition.ts.
 */
export const createGameCanvasViewModel = (
  options: GameCanvasViewModelOptions,
): GameCanvasViewModelInterface => GameCanvasViewModel.create(options);
