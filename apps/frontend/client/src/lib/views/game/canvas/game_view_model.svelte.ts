// apps/frontend/client/src/lib/views/game/canvas/game_view_model.svelte.ts

import type { EngineBridge, GameCommand, GameWorld } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import {
  authService,
  consumePendingGameLoad,
  gameStateSyncService,
  routerService,
} from '$services';
import type { ActiveContextEntry } from '$types';
import { GameStateService } from '../../../services/game/game_state_service.svelte.ts';

// ---------------------------------------------------------------------------
// GameViewModel — Svelte 5 ViewModel for the game canvas
// ---------------------------------------------------------------------------

/** Active dialog state pushed from the game engine via bridge events. */
type ActiveDialog = {
  npcName: string;
  dialog: string;
};

/** Data passed to the engine for player entity initialization. */
type PlayerInitData = {
  /** The player character's name (from persona). */
  name: string;
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

  /** Whether a save operation is currently in progress. */
  readonly isSaving: boolean;

  /**
   * User feedback message for save operations.
   * Set to a success/error string after saveGame completes, cleared on next save.
   */
  readonly saveMessage: string | undefined;

  /** The currently selected save slot number (1-indexed). */
  readonly saveSlotNumber: number;

  /** The logged-in player's display name, or 'Unknown' if not available. */
  readonly playerDisplayName: string;

  /**
   * The canvas element that PixiJS renders into.
   * Set by the View via bind:this — the ViewModel reacts via $effect.
   */
  canvasElement: HTMLCanvasElement | undefined;

  /**
   * Sends a command to the game engine across the EngineBridge boundary.
   * All UI→Game communication flows through this method.
   */
  sendCommand(command: GameCommand): void;

  /** Handles global keydown events — delegates Escape to toggleOptions. */
  handleKeyDown(event: KeyboardEvent): void;

  /** Closes the options overlay and resumes the game. */
  closeOptions(): void;

  /** Toggles the options overlay and locks/unlocks game input. */
  toggleOptions(): void;

  /** Navigates back to the PWA dashboard. */
  goToDashboard(): Promise<void>;

  /**
   * Saves the current game state to the cloud.
   * Serializes the ECS world, uploads to Firebase Storage,
   * and upserts the SaveSlot metadata row.
   *
   * @param slotNumber - The save slot number (1-indexed).
   */
  saveGame(slotNumber: number): Promise<void>;

  /** Sets the selected save slot number. Called by the View on slot change. */
  setSaveSlotNumber(slotNumber: number): void;
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

  isSaving = $state<boolean>(false);

  saveMessage = $state<string | undefined>(undefined);

  saveSlotNumber = $state<number>(1);

  /**
   * Canvas element that PixiJS renders into — set by the View via bind:this.
   * A registered $effect watches this and initializes the game world when set.
   */
  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);

  /**
   * The player character's name.
   * Uses the active persona name if loaded, otherwise falls back to auth display name.
   */
  get playerDisplayName() {
    if (this._personaPlayerName) {
      return this._personaPlayerName;
    }
    return authService.currentUser?.displayName || authService.currentUser?.email || 'Unknown';
  }

  /** Player character name loaded from the active persona. */
  private _personaPlayerName = $state<string>('');

  /** Active persona data loaded during initialization. */
  private _activePersona: PersonaData | undefined;

  /** Cached bridge instance — created lazily on first use. */
  private _bridge: EngineBridge | undefined;

  /** Cached GameWorld instance — created lazily after bridge init. */
  private _gameWorld: GameWorld | undefined;

  /** Window resize handler cleanup function. */
  private _resizeCleanup: (() => void) | undefined;

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

      this._bridge = createEngineBridge();

      // Register bridge event listeners
      this._bridge.on('NPC_DIALOG_START', (event) => {
        this.activeDialog = {
          npcName: event.npcName,
          dialog: event.dialog,
        };
      });

      this._bridge.on('NPC_DIALOG_END', () => {
        this.activeDialog = undefined;
      });

      this._bridge.on('GAME_READY', () => {
        this.isGameReady = true;
      });

      this._bridge.on('GAME_ERROR', (event) => {
        this.gameError = event.message;
      });

      this._bridge.on('PLAYER_POSITION_CHANGED', (event) => {
        this.playerScene = event.scene;
      });

      this._bridge.on('SCENE_LOADED', (event) => {
        this.playerScene = event.sceneId;
      });

      // ── Spatial context events ──
      this._bridge.on('CONTEXT_ENTERED', (event) => {
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

      this._bridge.on('CONTEXT_EXITED', (event) => {
        // Update ViewModel's reactive state
        this.activeContexts = this.activeContexts.filter((ctx) => ctx.entityId !== event.entityId);
        // Persist in game state service
        this.gameStateService.removeActiveContext(event.entityId);
      });

      // ── Load active persona for player name + data ──
      await this._loadActivePersona();

      // ── Reactive canvas attachment via $effect ──
      // This replaces the old pendingCanvas pattern. When the View binds
      // the canvas element, this $effect fires and initializes the game world.
      this.registerEffectRoot(() => {
        $effect(() => {
          const canvas = this.canvasElement;
          if (canvas && this._bridge) {
            void this._attachCanvasNow(canvas);
          }
        });
      });

      await super.initialize();
    } catch (error) {
      this.debug('Failed to initialize game bridge', error);
    }
  }

  /** @inheritdoc */
  sendCommand(command: GameCommand): void {
    if (!this._bridge) {
      return;
    }

    this._bridge.send(command);
  }

  /** @inheritdoc */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.toggleOptions();
    }
  }

  /**
   * Loads the active persona (from Firestore or localStorage) so the
   * player character name and data are available for engine initialization.
   */
  private async _loadActivePersona(): Promise<void> {
    try {
      const { personaService } = await import('$lib/services/persona/persona_repository.svelte');
      const activePersona = await personaService.getActivePersona();
      if (activePersona) {
        this._activePersona = activePersona;
        this._personaPlayerName = activePersona.name || activePersona.race || '';
        this.debug('loadActivePersona', {
          name: activePersona.name,
          id: activePersona.id,
        });
        return;
      }
    } catch (error) {
      this.debug('loadActivePersona:firestore-failed', error);
    }

    // Fallback: load most recent character from localStorage
    try {
      const stored = localStorage.getItem('aikami-characters');
      if (stored) {
        const characters = JSON.parse(stored) as Array<{ persona: PersonaData }>;
        if (characters.length > 0) {
          const persona = characters[characters.length - 1].persona;
          this._activePersona = persona;
          this._personaPlayerName = persona.name || persona.race || '';
          this.debug('loadActivePersona:localStorage', {
            name: persona.name,
            id: persona.id,
          });
        }
      }
    } catch (error) {
      this.debug('loadActivePersona:localStorage-failed', error);
    }
  }

  /**
   * Internal: creates the GameWorld and attaches to the canvas.
   * Assumes this._bridge is already initialized.
   */
  private async _attachCanvasNow(canvas: HTMLCanvasElement): Promise<void> {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    try {
      const { GameWorld } = await import('@aikami/frontend/engine');

      const initialPayload = consumePendingGameLoad();

      const playerData: PlayerInitData | undefined = this._activePersona?.name
        ? { name: this._activePersona.name }
        : undefined;

      this._gameWorld = GameWorld.create({ className: 'GameWorld', bridge });
      await this._gameWorld.initialize({
        canvas,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        initialPayload,
        playerData,
      });

      // Register window resize handler — keep the PixiJS canvas filling the viewport
      const handleResize = (): void => {
        if (this._gameWorld) {
          this._gameWorld.resize(window.innerWidth, window.innerHeight);
        }
      };
      window.addEventListener('resize', handleResize);
      this._resizeCleanup = (): void => {
        window.removeEventListener('resize', handleResize);
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.gameError = message;
    }
  }

  /** @inheritdoc */
  closeOptions(): void {
    this.showOptions = false;
    if (this._gameWorld) {
      this._gameWorld.setInputLocked(false);
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
    if (this._gameWorld) {
      this._gameWorld.setInputLocked(this.showOptions);
    }
  }

  /** @inheritdoc */
  setSaveSlotNumber(slotNumber: number): void {
    this.saveSlotNumber = slotNumber;
  }

  /** @inheritdoc */
  async saveGame(slotNumber: number): Promise<void> {
    if (!this._gameWorld || this.isSaving) {
      return;
    }

    const uid = authService.uid;
    if (!uid) {
      this.saveMessage = 'You must be signed in to save.';
      return;
    }

    this.isSaving = true;
    this.saveMessage = undefined;

    try {
      const payload = await this._gameWorld.snapshotWorld();

      await gameStateSyncService.saveGame({
        uid,
        slot: slotNumber,
        payload,
        metadata: {
          lastLocationName: this.playerScene,
        },
      });

      this.saveMessage = `Game saved to slot ${slotNumber}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.saveMessage = `Save failed: ${message}`;
      this.debug('saveGame:error', { slotNumber, error: message });
    } finally {
      this.isSaving = false;
    }
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    if (this._resizeCleanup) {
      this._resizeCleanup();
      this._resizeCleanup = undefined;
    }

    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }

    this._bridge = undefined;
    this.isGameReady = false;

    await super.dispose();
  }
}

export { GameViewModel };
