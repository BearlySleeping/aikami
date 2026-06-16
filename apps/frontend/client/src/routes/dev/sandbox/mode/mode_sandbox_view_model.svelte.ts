// apps/frontend/client/src/routes/dev/sandbox/mode/mode_sandbox_view_model.svelte.ts

import type { EngineBridge, GameWorld } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gameStateService } from '$services';

// ---------------------------------------------------------------------------
// ModeSandboxViewModel — isolated dev sandbox for C-140 mode system
//
// Initializes a minimal GameWorld with a dummy player entity so the
// mode toggle buttons can be verified: pressing WASD should NOT move
// the character when mode is DIALOGUE or MENU.
// ---------------------------------------------------------------------------

export type ModeSandboxViewModelOptions = BaseViewModelOptions;

export type ModeSandboxViewModelInterface = BaseViewModelInterface & {
  /** Whether the game engine is initialized and rendering. */
  readonly isReady: boolean;

  /** Last error message from the engine, if any. */
  readonly engineError: string | undefined;

  /**
   * Canvas element that PixiJS renders into.
   * Set by the View via bind:this — the ViewModel reacts via $effect.
   */
  canvasElement: HTMLCanvasElement | undefined;

  /** Sets game mode to EXPLORE (free movement). */
  setExploreMode(): void;

  /** Sets game mode to DIALOGUE (movement locked, dialogue overlay shown). */
  setDialogueMode(): void;

  /** Sets game mode to MENU (movement locked, menu overlay shown). */
  setMenuMode(): void;
};

class ModeSandboxViewModel
  extends BaseViewModel<ModeSandboxViewModelOptions>
  implements ModeSandboxViewModelInterface
{
  isReady = $state<boolean>(false);

  engineError = $state<string | undefined>(undefined);

  /**
   * Canvas element for PixiJS — uses $state.raw because WebGL contexts
   * cannot survive Svelte's Proxy wrapper.
   */
  canvasElement = $state.raw<HTMLCanvasElement | undefined>(undefined);

  /** Cached engine bridge — created lazily on first use. */
  private _bridge: EngineBridge | undefined;

  /** Cached GameWorld instance. */
  private _gameWorld: GameWorld | undefined;

  constructor(options: ModeSandboxViewModelOptions) {
    super(options);
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      this._bridge = createEngineBridge();

      this._bridge.on('GAME_READY', () => {
        this.isReady = true;
      });

      this._bridge.on('GAME_ERROR', (event) => {
        this.engineError = event.message;
      });

      // Reactive canvas attachment — when the View binds the canvas
      // element, initialize the game engine.
      this.registerEffectRoot(() => {
        $effect(() => {
          const canvas = this.canvasElement;
          if (canvas && this._bridge) {
            void this._initializeEngine(canvas);
          }

          return () => {
            this._destroyEngine();
          };
        });
      });

      await super.initialize();
    } catch (error) {
      this.engineError = error instanceof Error ? error.message : String(error);
    }
  }

  /** @inheritdoc */
  setExploreMode(): void {
    gameStateService.setMode('EXPLORE');
    if (this._gameWorld) {
      this._gameWorld.setInputLocked(false);
    }
  }

  /** @inheritdoc */
  setDialogueMode(): void {
    gameStateService.setMode('DIALOGUE');
    if (this._gameWorld) {
      this._gameWorld.setInputLocked(true);
    }
  }

  /** @inheritdoc */
  setMenuMode(): void {
    gameStateService.setMode('MENU');
    if (this._gameWorld) {
      this._gameWorld.setInputLocked(true);
    }
  }

  /**
   * Initializes a minimal GameWorld with a dummy player entity.
   * No full game state — just enough to verify the mode/movement gate.
   */
  private async _initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    try {
      const { GameWorld } = await import('@aikami/frontend/engine');

      this._gameWorld = (GameWorld.create as (opts: Record<string, unknown>) => GameWorld)({
        className: 'ModeSandboxGameWorld',
        bridge,
      });

      await this._gameWorld.initialize({
        canvas,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        playerData: { name: 'Sandbox Player' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.engineError = message;
    }
  }

  /**
   * Destroys the game engine and resets state.
   * Called by the $effect cleanup and dispose().
   */
  private _destroyEngine(): void {
    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }
    this.isReady = false;
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    this._destroyEngine();
    this._bridge = undefined;
    await super.dispose();
  }
}

/** Factory for instantiating the sandbox ViewModel in route pages. */
export const getModeSandboxViewModel = (
  options: ModeSandboxViewModelOptions,
): ModeSandboxViewModel => {
  return new ModeSandboxViewModel(options);
};

export { ModeSandboxViewModel };
