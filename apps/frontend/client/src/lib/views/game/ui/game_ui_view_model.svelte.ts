// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts

import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { routerService } from '$services';
import type { GameViewModelInterface } from '../canvas/game_view_model.svelte';

// ---------------------------------------------------------------------------
// GameUIViewModel — overlay router for the game UI layer
//
// Manages reactive overlay state (pause menu, dialogue, combat) and
// captures keyboard input (Escape) to toggle overlays. Lives inside
// the #game-ui-layer DOM element from C-124.
//
// Contract: C-125 Game UI Overlay Architecture & State Sync
// ---------------------------------------------------------------------------

/** Discriminated union of all possible game overlay states. */
export type GameOverlayType = 'NONE' | 'PAUSE_MENU' | 'DIALOGUE' | 'COMBAT';

/** NPC data passed to the dialogue overlay when an interaction starts. */
export type DialogueNpcData = {
  /** Unique NPC identifier from the ECS entity. */
  npcId: string;
  /** Display name shown in the dialogue UI header. */
  npcName: string;
  /** Initial greeting dialog text. */
  dialog: string;
};

export type GameUIViewModelOptions = BaseViewModelOptions & {
  /** Reference to the owning GameViewModel for engine control. */
  gameViewModel: GameViewModelInterface;
};

export type GameUIViewModelInterface = BaseViewModelInterface & {
  /** The currently active overlay. 'NONE' when no overlay is visible. */
  readonly activeOverlay: GameOverlayType;

  /** NPC data for the active dialogue overlay, or undefined. */
  readonly dialogueNpc: DialogueNpcData | undefined;

  /**
   * Handles global keydown events for overlay toggling.
   * Escape opens/closes the pause menu or ends dialogue.
   */
  handleKeyDown(event: KeyboardEvent): void;

  /** Closes the current overlay and resumes the game. */
  resumeGame(): void;

  /** Navigates to the settings page. Placeholder for full in-game settings. */
  goToSettings(): Promise<void>;

  /**
   * Quits to the main menu (Start Menu at /).
   * SvelteKit unmount triggers GameViewModel.dispose() which cleans up
   * the engine (PixiJS, worker, listeners).
   */
  quitToMainMenu(): Promise<void>;

  /**
   * Ends the active dialogue overlay and resumes the game.
   * Called by the DialogueOverlay when the player clicks "End Chat" or
   * presses Escape while the dialogue is open.
   */
  endDialogue(): void;
};

class GameUIViewModel
  extends BaseViewModel<GameUIViewModelOptions>
  implements GameUIViewModelInterface
{
  activeOverlay = $state<GameOverlayType>('NONE');

  dialogueNpc = $state<DialogueNpcData | undefined>(undefined);

  private readonly _gameViewModel: GameViewModelInterface;

  constructor(options: GameUIViewModelOptions) {
    super(options);
    this._gameViewModel = options.gameViewModel;
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    this._listenForDialogueEvents();
    await super.initialize();
  }

  /**
   * Listens for NPC interaction events from the ECS via the EngineBridge.
   * When the player enters an NPC's interaction radius, the ECS emits
   * NPC_DIALOG_START; we switch to the DIALOGUE overlay.
   */
  private async _listenForDialogueEvents(): Promise<void> {
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge: EngineBridge = createEngineBridge();

      bridge.on('NPC_DIALOG_START', (event) => {
        if (this.activeOverlay === 'NONE') {
          this.activeOverlay = 'DIALOGUE';
          this.dialogueNpc = {
            npcId: event.npcId,
            npcName: event.npcName,
            dialog: event.dialog,
          };
          this._gameViewModel.pauseEngine();
        }
      });

      bridge.on('NPC_DIALOG_END', () => {
        if (this.activeOverlay === 'DIALOGUE') {
          this.endDialogue();
        }
      });
    } catch (error) {
      this.debug('_listenForDialogueEvents:failed', error);
    }
  }

  /** @inheritdoc */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();

      if (this.activeOverlay === 'DIALOGUE') {
        this.endDialogue();
        return;
      }

      this._togglePauseMenu();
    }
  }

  /**
   * Toggles the pause menu overlay.
   *
   * When opening: pauses the game engine (stops the tick loop + locks input).
   * When closing: resumes the game engine.
   */
  private _togglePauseMenu(): void {
    if (this.activeOverlay === 'PAUSE_MENU') {
      this.resumeGame();
    } else if (this.activeOverlay === 'NONE') {
      this.activeOverlay = 'PAUSE_MENU';
      this._gameViewModel.pauseEngine();
    }
  }

  /** @inheritdoc */
  resumeGame(): void {
    this.activeOverlay = 'NONE';
    this._gameViewModel.resumeEngine();
  }

  /** @inheritdoc */
  async goToSettings(): Promise<void> {
    await routerService.goToRoute('settings', {
      queryParameters: { from: 'game' },
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  async quitToMainMenu(): Promise<void> {
    // Navigating away unmounts the GameView → BaseViewModelContainer
    // calls GameViewModel.dispose() → destroys PixiJS + worker + listeners.
    await routerService.navigateToApp();
  }

  /** @inheritdoc */
  endDialogue(): void {
    this.activeOverlay = 'NONE';
    this.dialogueNpc = undefined;
    this._gameViewModel.resumeEngine();
  }
}

export { GameUIViewModel };
