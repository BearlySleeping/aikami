// apps/frontend/pwa/src/lib/views/game/game-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { GameCommand } from '$game/types';

// ---------------------------------------------------------------------------
// GameViewModel — Svelte 5 ViewModel for the game canvas
// ---------------------------------------------------------------------------

/** Active dialog state pushed from the game engine via bridge events. */
type ActiveDialog = {
  npcName: string;
  dialog: string;
};

export type GameViewModelOptions = BaseViewModelOptions;

export type GameViewModelInterface = BaseViewModelInterface & {
  /** Currently active NPC dialog, or undefined when no dialog is open. */
  readonly activeDialog: ActiveDialog | undefined;

  /** The player's current scene name. */
  readonly playerScene: string;

  /** Whether the PixiJS game engine has initialized and is running. */
  readonly isGameReady: boolean;

  /** Last error message from the game engine, if any. */
  readonly gameError: string | undefined;

  /**
   * Sends a command to the game engine across the EngineBridge boundary.
   * All UI→Game communication flows through this method.
   */
  sendCommand(command: GameCommand): void;

  /**
   * Attaches the GameWorld to a canvas element and starts the engine.
   * Called by the View after the canvas element is mounted.
   */
  attachCanvas(canvas: HTMLCanvasElement): Promise<void>;
};

/**
 * ViewModel for the `/game` route.
 *
 * Follows the Svelte 5 ViewModel pattern: all reactive state lives here
 * via `$state` runes. The View (.svelte) is a thin wrapper.
 *
 * **Critical boundary rule**: This ViewModel NEVER imports PixiJS, bitECS,
 * or any game-internal types. All communication with the game engine goes
 * through the typed {@link import('$game/engine-bridge').EngineBridge}.
 */
class GameViewModel extends BaseViewModel<GameViewModelOptions> implements GameViewModelInterface {
  activeDialog = $state<ActiveDialog | undefined>(undefined);

  playerScene = $state<string>('unknown');

  isGameReady = $state<boolean>(false);

  gameError = $state<string | undefined>(undefined);

  /** Cached bridge instance — created lazily on first use. */
  private bridge: import('$game/engine-bridge').EngineBridge | undefined;

  /** Cached GameWorld instance — created lazily after bridge init. */
  private gameWorld: import('$game/game-world').GameWorld | undefined;

  /** @inheritdoc */
  async initialize(): Promise<void> {
    this.debug('initialize');

    try {
      // Lazy-import game modules — PixiJS is SSR-incompatible.
      // `BaseViewModelContainer` ensures `initialize()` runs only client-side.
      const { createEngineBridge } = await import('$game/engine-bridge');

      this.bridge = createEngineBridge();

      // Register bridge event listeners
      this.bridge.on('NPC_DIALOG_START', (event) => {
        this.activeDialog = {
          npcName: event.npcName,
          dialog: event.dialog,
        };
      });

      this.bridge.on('NPC_DIALOG_END', () => {
        this.activeDialog = undefined;
      });

      this.bridge.on('GAME_READY', () => {
        this.isGameReady = true;
      });

      this.bridge.on('GAME_ERROR', (event) => {
        this.gameError = event.message;
      });

      this.bridge.on('PLAYER_POSITION_CHANGED', (event) => {
        this.playerScene = event.scene;
      });

      this.bridge.on('SCENE_LOADED', (event) => {
        this.playerScene = event.sceneId;
      });
    } catch (error) {
      this.debug('Failed to initialize game bridge', error);
    }
  }

  /** @inheritdoc */
  sendCommand(command: GameCommand): void {
    if (!this.bridge) {
      return;
    }

    this.bridge.send(command);
  }

  /**
   * Attaches the GameWorld to a canvas element and starts the engine.
   *
   * Called by the View after the canvas element is mounted in the DOM.
   * This method is NOT part of the public interface — it is called
   * exclusively by the GameView.svelte via the internal reference.
   *
   * @param canvas - The HTML canvas element for PixiJS to render into.
   */
  async attachCanvas(canvas: HTMLCanvasElement): Promise<void> {
    this.debug('attachCanvas');

    if (!this.bridge) {
      this.gameError = 'Game bridge not initialized';
      return;
    }

    try {
      const { GameWorld } = await import('$game/game-world');

      this.gameWorld = new GameWorld(this.bridge);
      await this.gameWorld.initialize({
        canvas,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.gameError = message;
    }
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    if (this.gameWorld) {
      this.gameWorld.destroy();
      this.gameWorld = undefined;
    }

    this.bridge = undefined;
    this.isGameReady = false;

    await super.dispose();
  }
}

export { GameViewModel };
