// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts

import { OllamaClient } from '@aikami/frontend/api-core';
import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { aiSettingsService } from '$lib/services/settings/ai_settings.svelte';
import {
  GameSaveService,
  type GameSaveServiceInterface,
  gameStateService,
  routerService,
} from '$services';
import { CombatViewModel } from '../../combat/combat_view_model.svelte.ts';
import { InventoryViewModel } from '../../inventory/inventory_view_model.svelte';
import { QuestViewModel } from '../../quest/quest_view_model.svelte.ts';
import type { GameViewModelInterface } from '../canvas/game_view_model.svelte';
import { DialogueOverlayViewModel } from './overlays/dialogue/dialogue_overlay_view_model.svelte';

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
export type GameOverlayType =
  | 'NONE'
  | 'PAUSE_MENU'
  | 'DIALOGUE'
  | 'COMBAT'
  | 'INVENTORY'
  | 'QUEST_LOG'
  | 'GAME_OVER';

/** NPC data passed to the dialogue overlay when an interaction starts. */
export type DialogueNpcData = {
  /** Unique NPC identifier from the ECS entity. */
  npcId: string;
  /** Display name shown in the dialogue UI header. */
  npcName: string;
  /** Initial greeting dialog text. */
  dialog: string;
  /** AI persona template ID for contextual prompt injection. */
  personaId?: string;
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

  /** Whether a save operation is currently in progress. */
  readonly isSaving: boolean;

  /** Feedback message shown after a save completes (e.g., 'Saved!'). */
  readonly saveMessage: string | undefined;

  /** Active text provider config (used to detect Ollama vs OpenRouter). */
  readonly textProvider: { endpoint: string } | undefined;

  /** Whether Ollama (localhost) is the active text provider. */
  readonly useOllama: boolean;

  /** The active DialogueOverlayViewModel, or undefined when dialogue is closed. */
  readonly dialogueViewModel:
    | import('./overlays/dialogue/dialogue_overlay_view_model.svelte').DialogueOverlayViewModel
    | undefined;

  readonly inventoryViewModel: InventoryViewModel | undefined;

  /** The active QuestViewModel, or undefined when the quest log is closed. */
  readonly questViewModel: QuestViewModel | undefined;

  /** The active CombatViewModel, or undefined when no combat is in progress. */
  readonly combatViewModel: CombatViewModel | undefined;

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

  /**
   * Saves the current game state to IndexedDB.
   *
   * Captures an ECS snapshot via the engine bridge and persists it
   * under the 'manual-1' slot. Shows a temporary feedback message.
   */
  saveGame(): Promise<void>;

  /** Whether a map transition is currently in progress (fade overlay visible). */
  readonly isTransitioning: boolean;

  /** Respawns the player after defeat (reloads current map). */
  respawnPlayer(): Promise<void>;

  /** Loads the last save after defeat (quits to main menu). */
  loadLastSave(): Promise<void>;
};

class GameUIViewModel
  extends BaseViewModel<GameUIViewModelOptions>
  implements GameUIViewModelInterface
{
  activeOverlay = $state<GameOverlayType>('NONE');

  dialogueNpc = $state<DialogueNpcData | undefined>(undefined);

  isSaving = $state<boolean>(false);

  saveMessage = $state<string | undefined>(undefined);

  isTransitioning = $state<boolean>(false);

  dialogueViewModel = $state<DialogueOverlayViewModel | undefined>(undefined);

  inventoryViewModel = $state<InventoryViewModel | undefined>(undefined);

  questViewModel = $state<QuestViewModel | undefined>(undefined);

  combatViewModel = $state<CombatViewModel | undefined>(undefined);

  /** Whether Ollama (localhost) is the active text provider (vs OpenRouter). */
  readonly useOllama: boolean;

  /** @inheritdoc */
  get textProvider(): { endpoint: string } | undefined {
    return { endpoint: this._textProviderEndpoint };
  }

  private readonly _gameViewModel: GameViewModelInterface;

  /** Lazily-created save service (requires engine bridge from the game). */
  private _saveService: GameSaveServiceInterface | undefined;

  /** Cached bridge instance shared with the game ViewModel. */
  private _bridge: EngineBridge | undefined;

  /** Cached text provider endpoint — read once to avoid reactive re-renders. */
  private readonly _textProviderEndpoint: string;

  constructor(options: GameUIViewModelOptions) {
    super(options);
    this._gameViewModel = options.gameViewModel;
    this._textProviderEndpoint = aiSettingsService.textProvider?.endpoint ?? '';
    this.useOllama = this._textProviderEndpoint.includes('localhost');
    // Register bridge listeners eagerly — _listenForDialogueEvents is
    // normally called from initialize() but the consumer may render
    // GameUIView without a BaseViewModelContainer wrapper.
    void this._listenForDialogueEvents();
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
      this._bridge = bridge;

      bridge.on('NPC_DIALOG_START', () => {
        // Proximity event — not used in the game UI view.
        // The dialogue opens exclusively via NPC_INTERACTED (manual E/Enter).
      });

      bridge.on('NPC_INTERACTED', (event) => {
        if (this.activeOverlay === 'NONE') {
          this.activeOverlay = 'DIALOGUE';
          gameStateService.setMode('DIALOGUE');
          this.dialogueNpc = {
            npcId: event.npcId,
            npcName: event.npcName,
            dialog: event.dialog,
            personaId: event.personaId,
          };
          this.dialogueViewModel = new DialogueOverlayViewModel({
            className: 'DialogueOverlayViewModel',
            npcData: this.dialogueNpc,
            onEndChat: () => this.endDialogue(),
            ollamaClient: this.useOllama ? new OllamaClient() : undefined,
          });
          this._gameViewModel.pauseEngine();
        }
      });

      bridge.on('NPC_DIALOG_END', () => {
        if (this.activeOverlay === 'DIALOGUE') {
          this.endDialogue();
        }
      });

      // Listen for ZONE_TRIGGERED events to show the transition overlay
      // and trigger the actual map load with defeated enemy persistence.
      bridge.on('ZONE_TRIGGERED', (event) => {
        this.isTransitioning = true;
        void this._gameViewModel.loadMap(
          event.targetMap,
          event.targetX,
          event.targetY,
          gameStateService.defeatedEnemies as string[],
        );
      });

      // Listen for GAME_READY to hide the transition overlay after load completes
      bridge.on('GAME_READY', () => {
        this.isTransitioning = false;
      });

      // Listen for COMBAT_STARTED to mount the combat overlay
      bridge.on('COMBAT_STARTED', (event) => {
        if (this.activeOverlay !== 'NONE' && this.activeOverlay !== 'COMBAT') {
          return;
        }
        this.activeOverlay = 'COMBAT';
        gameStateService.setMode('COMBAT');
        this._gameViewModel.pauseEngine();
        this.combatViewModel = new CombatViewModel({
          className: 'CombatViewModel',
        });
        // Initialize the combat view model so it registers bridge listeners
        void this.combatViewModel.initialize();
        // Feed the enemy data into the combat VM after bridge listeners are registered
        if (this.combatViewModel) {
          this.combatViewModel.enemyName = event.enemyName ?? 'Unknown Enemy';
          this.combatViewModel.enemyHp = event.enemyHp ?? 80;
          this.combatViewModel.enemyMaxHp = event.enemyMaxHp ?? 80;
          this.combatViewModel.activeEntities = event.participantIds;
          this.combatViewModel.currentTurnEntity = event.firstTurnEntityId;
          this.combatViewModel.totalParticipants = event.participantIds.length;
          this.combatViewModel.isPlayerTurn = true;
        }
      });

      // Listen for COMBAT_ENDED to dismiss the combat overlay or show game over.
      // Victory: brief delay then dismiss. Defeat: show GAME_OVER overlay.
      bridge.on('COMBAT_ENDED', (event) => {
        if (this.activeOverlay === 'COMBAT') {
          if (event.victory) {
            // Give the CombatViewModel 2.5 seconds to show the victory banner
            // before dismissing the overlay.
            setTimeout(() => {
              this._endCombat();
            }, 2500);
          } else {
            // Player was defeated — show Game Over
            this._showGameOver();
          }
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

      if (this.activeOverlay === 'INVENTORY') {
        this._closeInventory();
        return;
      }

      if (this.activeOverlay === 'QUEST_LOG') {
        this._closeQuestLog();
        return;
      }

      this._togglePauseMenu();
      return;
    }

    if (event.key === 'i' || event.key === 'I') {
      event.preventDefault();

      if (this.activeOverlay === 'INVENTORY') {
        this._closeInventory();
      } else if (this.activeOverlay === 'NONE') {
        this._openInventory();
      }
      return;
    }

    if (event.key === 'q' || event.key === 'Q') {
      event.preventDefault();

      if (this.activeOverlay === 'QUEST_LOG') {
        this._closeQuestLog();
      } else if (this.activeOverlay === 'NONE') {
        this._openQuestLog();
      }
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
      gameStateService.setMode('MENU');
      this._gameViewModel.pauseEngine();
    }
  }

  /** @inheritdoc */
  resumeGame(): void {
    this.activeOverlay = 'NONE';
    gameStateService.setMode('EXPLORE');
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
    this.dialogueViewModel = undefined;
    gameStateService.setMode('EXPLORE');
    this._gameViewModel.resumeEngine();
  }

  /** @inheritdoc */
  async saveGame(): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.saveMessage = undefined;

    try {
      if (!this._saveService) {
        const bridge = this._bridge;
        if (!bridge) {
          throw new Error('Engine bridge not available for save');
        }
        this._saveService = new GameSaveService({
          className: 'GameSaveService',
          bridge,
        });
      }

      await this._saveService.saveGame('manual-1');
      this.saveMessage = 'Game Saved!';
    } catch (error) {
      this.debug('saveGame:error', { error: String(error) });
      this.saveMessage = 'Save failed';
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Opens the inventory overlay.
   *
   * Locks the game in MENU mode (movement disabled) and creates the
   * InventoryViewModel that reads from GameStateService.inventory.
   */
  private _openInventory(): void {
    this.activeOverlay = 'INVENTORY';
    gameStateService.setMode('MENU');
    this._gameViewModel.pauseEngine();
    this.inventoryViewModel = new InventoryViewModel({
      className: 'InventoryViewModel',
      onClose: () => this._closeInventory(),
    });
  }

  /**
   * Closes the inventory overlay.
   *
   * Restores EXPLORE mode and disposes the InventoryViewModel.
   */
  private _closeInventory(): void {
    this.activeOverlay = 'NONE';
    gameStateService.setMode('EXPLORE');
    this._gameViewModel.resumeEngine();
    this.inventoryViewModel = undefined;
  }

  /**
   * Opens the quest log overlay.
   *
   * Sets game mode to MENU (locking player movement) and instantiates
   * a QuestViewModel that reads quest data from GameStateService.
   *
   * Contract: C-143 Quest Log Sync
   */
  private _openQuestLog(): void {
    this.activeOverlay = 'QUEST_LOG';
    gameStateService.setMode('MENU');
    this._gameViewModel.pauseEngine();
    this.questViewModel = new QuestViewModel({
      className: 'QuestViewModel',
    });
  }

  /**
   * Closes the quest log overlay.
   *
   * Restores EXPLORE mode and disposes the QuestViewModel.
   */
  private _closeQuestLog(): void {
    this.activeOverlay = 'NONE';
    gameStateService.setMode('EXPLORE');
    this._gameViewModel.resumeEngine();
    this.questViewModel = undefined;
  }

  /**
   * Ends the combat overlay and restores EXPLORE mode.
   *
   * Called when COMBAT_ENDED is received from the engine bridge or
   * when the player chooses to flee.
   */
  private _endCombat(): void {
    this.activeOverlay = 'NONE';
    gameStateService.setMode('EXPLORE');
    this._gameViewModel.resumeEngine();
    void this.combatViewModel?.dispose();
    this.combatViewModel = undefined;
  }

  /**
   * Shows the Game Over overlay after player defeat.
   *
   * Switches to GAME_OVER overlay type and disposes the combat VM.
   * The game remains paused — the player must choose Respawn or Load Last Save.
   *
   * Contract: C-147 Progression & Persistence
   */
  private _showGameOver(): void {
    this.activeOverlay = 'GAME_OVER';
    gameStateService.setMode('MENU');
    void this.combatViewModel?.dispose();
    this.combatViewModel = undefined;
  }

  /** @inheritdoc */
  async respawnPlayer(): Promise<void> {
    // Reload the default starting map — defeated enemies are already tracked
    // in GameStateService and will be filtered out during map load.
    this.activeOverlay = 'NONE';
    gameStateService.setMode('EXPLORE');
    this._gameViewModel.resumeEngine();
    await this._gameViewModel.loadMap(
      '/assets/maps/sandbox_zone_a.json',
      160,
      192,
      gameStateService.defeatedEnemies as string[],
    );
  }

  /** @inheritdoc */
  async loadLastSave(): Promise<void> {
    // Quit to main menu so the player can use the "Continue" button
    // which reads from the save system's IndexedDB slot.
    await routerService.navigateToApp();
  }
}

export { GameUIViewModel };
