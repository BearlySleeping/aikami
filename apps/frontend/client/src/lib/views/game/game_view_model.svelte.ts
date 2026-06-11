// apps/frontend/client/src/lib/views/game/game_view_model.svelte.ts

import type { EngineBridge, GameCommand, GameWorld } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { authService, routerService } from '$services';
import type { ActiveContextEntry } from '$types';
import { GameStateService } from '../../services/game/game_state_service.svelte.ts';

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
   * Array of active spatial contexts — entities the player is currently
   * within proximity of. Updated reactively via bridge events.
   */
  readonly activeContexts: ActiveContextEntry[];

  /** Whether the options overlay is visible. */
  readonly showOptions: boolean;

  /** The logged-in player's display name, or 'Unknown' if not available. */
  readonly playerDisplayName: string;

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

  /** Closes the options overlay and resumes the game. */
  closeOptions(): void;

  /** Toggles the options overlay and locks/unlocks game input. */
  toggleOptions(): void;

  /** Navigates back to the PWA dashboard. */
  goToDashboard(): Promise<void>;
};

/**
 * ViewModel for the `/game` route.
 *
 * Follows the Svelte 5 ViewModel pattern: all reactive state lives here
 * via `$state` runes. The View (.svelte) is a thin wrapper.
 *
 * **Critical boundary rule**: This ViewModel NEVER imports PixiJS, bitECS,
 * or any game-internal types. All communication with the game engine goes
 * through the typed {@link import('@aikami/frontend/engine').EngineBridge}.
 */
class GameViewModel extends BaseViewModel<GameViewModelOptions> implements GameViewModelInterface {
  activeDialog = $state<ActiveDialog | undefined>(undefined);

  playerScene = $state<string>('unknown');

  isGameReady = $state<boolean>(false);

  gameError = $state<string | undefined>(undefined);

  activeContexts: ActiveContextEntry[] = $state([]);

  showOptions = $state<boolean>(false);

  /**
   * The logged-in player's display name.
   * Derived from authService — updates reactively when auth state changes.
   */
  get playerDisplayName() {
    return authService.currentUser?.displayName || authService.currentUser?.email || 'Unknown';
  }

  /** Cached bridge instance — created lazily on first use. */
  private bridge: EngineBridge | undefined;

  /** Cached GameWorld instance — created lazily after bridge init. */
  private gameWorld: GameWorld | undefined;

  /**
   * Canvas element passed in before the bridge finished initializing.
   * When the bridge becomes ready, auto-attach to this canvas.
   */
  private pendingCanvas: HTMLCanvasElement | undefined;

  /** Singleton game state service for persisting context data. */
  private readonly gameStateService = GameStateService.create({
    uid: 'game-viewmodel',
    className: 'GameStateService',
  });

  /** @inheritdoc */
  async initialize(): Promise<void> {
    try {
      // Lazy-import game modules — PixiJS is SSR-incompatible.
      // `BaseViewModelContainer` ensures `initialize()` runs only client-side.
      const { createEngineBridge } = await import('@aikami/frontend/engine');

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

      // ── Spatial context events ──
      this.bridge.on('CONTEXT_ENTERED', (event) => {
        const entry: ActiveContextEntry = {
          entityId: event.entityId,
          npcId: event.contextPayload.npcId,
          npcName: event.contextPayload.npcName,
          dialog: event.contextPayload.dialog,
          interactionRadius: event.contextPayload.interactionRadius,
        };
        // Update ViewModel's reactive state
        this.activeContexts = [...this.activeContexts, entry];
        // Persist in game state service
        this.gameStateService.addActiveContext(entry);
      });

      this.bridge.on('CONTEXT_EXITED', (event) => {
        // Update ViewModel's reactive state
        this.activeContexts = this.activeContexts.filter((ctx) => ctx.entityId !== event.entityId);
        // Persist in game state service
        this.gameStateService.removeActiveContext(event.entityId);
      });

      // ── Auto-attach if canvas arrived before bridge was ready ──
      if (this.pendingCanvas) {
        const canvas = this.pendingCanvas;
        this.pendingCanvas = undefined;
        await this.attachCanvasNow(canvas);
      }
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
    // Bridge not ready yet — store canvas and attach when initialize completes
    if (!this.bridge) {
      this.pendingCanvas = canvas;
      return;
    }

    await this.attachCanvasNow(canvas);
  }

  /**
   * Internal: creates the GameWorld and attaches to the canvas.
   * Assumes this.bridge is already initialized.
   */
  private async attachCanvasNow(canvas: HTMLCanvasElement): Promise<void> {
    const bridge = this.bridge;
    if (!bridge) {
      return;
    }

    try {
      const { GameWorld } = await import('@aikami/frontend/engine');

      this.gameWorld = GameWorld.create({ className: 'GameWorld', bridge });
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
  closeOptions(): void {
    this.showOptions = false;
    if (this.gameWorld) {
      this.gameWorld.setInputLocked(false);
    }
  }

  /** @inheritdoc */
  async goToDashboard(): Promise<void> {
    await routerService.navigateToApp();
  }

  /**
   * Toggles the options overlay and locks/unlocks game input.
   * Called when the user presses Escape.
   */
  toggleOptions(): void {
    this.showOptions = !this.showOptions;
    if (this.gameWorld) {
      this.gameWorld.setInputLocked(this.showOptions);
    }
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    if (this.gameWorld) {
      this.gameWorld.destroy();
      this.gameWorld = undefined;
    }

    this.bridge = undefined;
    this.pendingCanvas = undefined;
    this.isGameReady = false;

    await super.dispose();
  }
}

export { GameViewModel };
