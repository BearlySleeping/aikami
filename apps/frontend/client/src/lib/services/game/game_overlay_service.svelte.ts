// apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts

import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  routerService,
} from '@aikami/frontend/services';
import { aiSettingsService } from '$lib/services/settings/ai_settings.svelte';
import { logger } from '$logger';
import {
  audioService,
  GameSaveService,
  gameModeService,
  sessionService,
  worldStateService,
} from '$services';
import { setupBridgeListeners } from './bridge_listeners';
import { combatService } from './combat_service.svelte';
import { gameEngineService } from './game_engine_service.svelte';
import type { GameSaveServiceInterface } from './game_save_service.svelte.ts';
import { inputActionService } from './input_action_service.svelte.ts';
import { npcDialogueService } from './npc_dialogue_service.svelte';
import { onboardingHintService } from './onboarding_hint_service.svelte.ts';
import { timeService } from './time_service.svelte';

// ---------------------------------------------------------------------------
// GameOverlayService — overlay router for the game UI layer
// ---------------------------------------------------------------------------

export type GameOverlayType =
  | 'NONE'
  | 'PAUSE_MENU'
  | 'DIALOGUE'
  | 'COMBAT'
  | 'INVENTORY'
  | 'QUEST_LOG'
  | 'GAME_OVER'
  | 'CHARACTER_DASHBOARD'
  | 'VENDOR'
  | 'END_SESSION';

export type DialogueNpcData = {
  npcId: string;
  npcName: string;
  dialog: string;
  personaId?: string;
};

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type OverlayEventHandlers = {
  onDialogueStart(npcData: DialogueNpcData): void;
  onDialogueEnd(): void;
  onCombatStart(event: {
    enemyName: string;
    enemyHp: number;
    enemyMaxHp: number;
    participantIds: number[];
    firstTurnEntityId: number;
  }): void;
  onCombatEnd(options: { victory: boolean }): void;
  onInventoryOpen(): void;
  onInventoryClose(): void;
  onQuestLogOpen(): void;
  onQuestLogClose(): void;
  onDashboardOpen(): void;
  onDashboardClose(): void;
  onVendorOpen(options: { vendorId: string; vendorName: string; vendorInventory: string }): void;
  onVendorClose(): void;
  onCameraZoomUpdate(event: { npcScreenX?: number; npcScreenY?: number }): void;
};

export type GameOverlayServiceInterface = BaseFrontendClassInterface & {
  readonly activeOverlay: GameOverlayType;
  readonly dialogueNpc: DialogueNpcData | undefined;
  readonly isSaving: boolean;
  readonly saveMessage: string | undefined;
  readonly isTransitioning: boolean;
  readonly autoSaveStatus: AutoSaveStatus;
  readonly useOllama: boolean;
  readonly textProvider: { endpoint: string } | undefined;

  initialize(): Promise<void>;
  setEngineService(
    service: import('./game_engine_service.svelte').GameEngineServiceInterface,
  ): void;

  handleKeyDown(event: KeyboardEvent): void;
  resumeGame(): void;
  goToSettings(): Promise<void>;
  quitToMainMenu(): Promise<void>;
  endDialogue(): void;
  saveGame(): Promise<void>;
  respawnPlayer(): Promise<void>;
  loadLastSave(): Promise<void>;
  openVendor(options: { vendorId: string; vendorName: string; vendorInventory: string }): void;
  closeVendor(): void;
  openInventory(): void;
  closeInventory(): void;
  openQuestLog(): void;
  closeQuestLog(): void;
  openCharacterDashboard(): void;
  closeCharacterDashboard(): void;
  startCombat(options: { enemyName: string }): void;

  // ── Session Management (C-240) ──

  /** Opens the End Session confirmation dialog overlay. */
  openEndSession(): void;
  /** Closes the End Session overlay without ending. */
  closeEndSession(): void;
  /** Executes the end-session flow: lock chat, summarize, save. */
  endSession(): Promise<void>;
  /** Starts a new session after previous ended. */
  startNewSession(): Promise<void>;

  /** Resets onboarding hints for replay (C-327 AC-4). */
  replayOnboarding(): void;

  /** Intent-driven methods for bridge_listeners (not for general use). */
  setBridge(bridge: EngineBridge): void;
  setActive(type: GameOverlayType): void;
  clearActive(): void;
  setTransitioning(value: boolean): void;
  getDefeatedEnemies(): string[];
  setCameraZoom(options: { npcScreenX?: number; npcScreenY?: number }): void;
  onInventoryCountChange(newCount: number): void;
  onMapLoaded(): void;

  /** Internal camera zoom state (read by GameUIViewModel for dialogue spatial UI). */
  readonly _cameraZoomNpcScreenX: number | undefined;
  readonly _cameraZoomNpcScreenY: number | undefined;
  readonly vendorSessionOptions:
    | { vendorId: string; vendorName: string; vendorInventory: string }
    | undefined;
  /** Interaction prompt label (C-327 AC-2). */
  readonly interactionPromptLabel: string;
  /** Whether the interaction prompt is visible (C-327 AC-2). */
  readonly interactionPromptVisible: boolean;
  /** Sets the interaction prompt state (called by bridge_listeners). */
  setInteractionPrompt(options: { label: string; visible: boolean }): void;
};

export type GameOverlayServiceOptions = BaseFrontendClassOptions;

export class GameOverlayService
  extends BaseFrontendClass<GameOverlayServiceOptions>
  implements GameOverlayServiceInterface
{
  activeOverlay = $state<GameOverlayType>('NONE');
  dialogueNpc = $state<DialogueNpcData | undefined>(undefined);
  isSaving = $state<boolean>(false);
  saveMessage = $state<string | undefined>(undefined);
  isTransitioning = $state<boolean>(false);
  autoSaveStatus = $state<AutoSaveStatus>('idle');

  get useOllama(): boolean {
    if (!this._settingsLoaded) {
      void this._initSettings();
    }
    return this._useOllama;
  }

  get textProvider(): { endpoint: string } | undefined {
    if (!this._settingsLoaded) {
      void this._initSettings();
    }
    return { endpoint: this._textProviderEndpoint };
  }

  private _textProviderEndpoint = '';
  private _useOllama = false;
  private _settingsLoaded = false;
  private _bridge: EngineBridge | undefined;
  private _saveService: GameSaveServiceInterface | undefined;
  private _initialized = false;
  private _engineService:
    | import('./game_engine_service.svelte').GameEngineServiceInterface
    | undefined;
  private _handlers: OverlayEventHandlers | undefined;

  async initialize(): Promise<void> {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    await this._initSettings();
    await setupBridgeListeners({
      gameOverlayService: this as unknown as GameOverlayServiceInterface,
      npcDialogueService,
      gameEngineService,
      combatService,
      timeService,
      audioService,
      inputActionService,
      onboardingHintService,
    });
  }

  /** Sets the engine bridge for save operations. Called by setupBridgeListeners. */
  setBridge(bridge: EngineBridge): void {
    this._bridge = bridge;
  }

  /** Intent-driven overlay activation — called by bridge listeners only. */
  setActive(type: GameOverlayType): void {
    this.activeOverlay = type;
  }

  /** Resets overlay to NONE. */
  clearActive(): void {
    this.activeOverlay = 'NONE';
  }

  /** Intent-driven transition state. */
  setTransitioning(value: boolean): void {
    this.isTransitioning = value;
  }

  /** Returns the current defeated enemies list. */
  getDefeatedEnemies(): string[] {
    return [...worldStateService.defeatedEnemies];
  }

  /** Sets camera zoom data for dialogue spatial UI. */
  setCameraZoom(options: { npcScreenX?: number; npcScreenY?: number }): void {
    this._cameraZoomNpcScreenX = options.npcScreenX;
    this._cameraZoomNpcScreenY = options.npcScreenY;
  }

  /** Stores the last vendor session options for VM creation. */
  vendorSessionOptions = $state<
    { vendorId: string; vendorName: string; vendorInventory: string } | undefined
  >(undefined);

  /** Interaction prompt state (C-327 AC-2). */
  interactionPromptLabel = $state<string>('');
  interactionPromptVisible = $state<boolean>(false);

  /** Sets the interaction prompt label and visibility (called by bridge_listeners). */
  setInteractionPrompt(options: { label: string; visible: boolean }): void {
    this.interactionPromptLabel = options.label;
    this.interactionPromptVisible = options.visible;
  }

  /** Plays pickup SFX when inventory count increases. */
  onInventoryCountChange(newCount: number): void {
    if (newCount > this._previousInventoryCount) {
      void audioService.playSfx('/assets/audio/sfx/sfx_pickup.wav');
    }
    this._previousInventoryCount = newCount;
  }

  /** Called by bridge_listeners when a map has finished loading. */
  onMapLoaded(): void {
    if (this._firstMapLoaded) {
      void this._triggerAutoSave();
    }
    this._firstMapLoaded = true;
  }

  // Internal state (accessed via methods above, not directly)
  _previousInventoryCount = 0;
  _cameraZoomNpcScreenX: number | undefined;
  _cameraZoomNpcScreenY: number | undefined;
  private _firstMapLoaded = false;

  private async _triggerAutoSave(): Promise<void> {
    this.autoSaveStatus = 'saving';
    try {
      if (!this._saveService) {
        if (!this._bridge) {
          this.autoSaveStatus = 'error';
          return;
        }
        this._saveService = new GameSaveService({
          className: 'GameSaveService',
          bridge: this._bridge,
        });
      }
      await this._saveService.saveGame('auto-save');
      this.autoSaveStatus = 'saved';
      this.showSnackbar({ text: 'Auto-saved', type: 'success' });
      setTimeout(() => {
        if (this.autoSaveStatus === 'saved') {
          this.autoSaveStatus = 'idle';
        }
      }, 2000);
    } catch (_error) {
      this.autoSaveStatus = 'error';
      this.showSnackbar({ text: 'Auto-save failed', type: 'error' });
      setTimeout(() => {
        if (this.autoSaveStatus === 'error') {
          this.autoSaveStatus = 'idle';
        }
      }, 3000);
    }
  }

  setEngineService(
    service: import('./game_engine_service.svelte').GameEngineServiceInterface,
  ): void {
    this._engineService = service;
  }

  registerHandlers(handlers: OverlayEventHandlers): void {
    this._handlers = handlers;
  }

  handleKeyDown(event: KeyboardEvent): void {
    const actionId = inputActionService.keyToAction(event.key);
    inputActionService.onKeyDown();

    // Notify onboarding service of any recognized action (C-327 AC-3)
    if (actionId) {
      onboardingHintService.onActionPerformed(actionId);
    }

    // ── Overlay close/escape handling (binding-aware — open_menu defaults to Escape) ──
    if (actionId === 'open_menu') {
      event.preventDefault();
      if (this.activeOverlay === 'DIALOGUE') {
        this.endDialogue();
        return;
      }
      if (this.activeOverlay === 'END_SESSION') {
        this.closeEndSession();
        return;
      }
      if (this.activeOverlay === 'INVENTORY') {
        this.closeInventory();
        return;
      }
      if (this.activeOverlay === 'CHARACTER_DASHBOARD') {
        this.closeCharacterDashboard();
        return;
      }
      if (this.activeOverlay === 'VENDOR') {
        this.closeVendor();
        return;
      }
      if (this.activeOverlay === 'QUEST_LOG') {
        this.closeQuestLog();
        return;
      }
      this._togglePauseMenu();
      return;
    }

    // ── Overlay toggle: open_inventory ──
    if (actionId === 'open_inventory') {
      if (this.activeOverlay === 'INVENTORY') {
        event.preventDefault();
        this.closeInventory();
        return;
      }
      if (this.activeOverlay === 'NONE') {
        event.preventDefault();
        this.openInventory();
        return;
      }
      return;
    }

    // ── Overlay toggle: open_quest_log ──
    if (actionId === 'open_quest_log') {
      if (this.activeOverlay === 'QUEST_LOG') {
        event.preventDefault();
        this.closeQuestLog();
        return;
      }
      if (this.activeOverlay === 'NONE') {
        event.preventDefault();
        this.openQuestLog();
        return;
      }
      return;
    }

    // ── Overlay toggle: open_character ──
    if (actionId === 'open_character') {
      if (this.activeOverlay === 'CHARACTER_DASHBOARD') {
        event.preventDefault();
        this.closeCharacterDashboard();
        return;
      }
      if (this.activeOverlay === 'NONE') {
        event.preventDefault();
        this.openCharacterDashboard();
        return;
      }
    }
  }

  resumeGame(): void {
    this.activeOverlay = 'NONE';
    gameModeService.setMode('EXPLORE');
    this._engineService?.resumeEngine();
  }

  async goToSettings(): Promise<void> {
    await routerService.goToRoute('settings', {
      queryParameters: { from: 'game' },
      pathParameters: undefined,
    });
  }

  async quitToMainMenu(): Promise<void> {
    await routerService.navigateToApp();
  }

  endDialogue(): void {
    this.activeOverlay = 'NONE';
    this.dialogueNpc = undefined;
    gameModeService.setMode('EXPLORE');
    this._engineService?.resumeEngine();
    this._handlers?.onDialogueEnd();
  }

  async saveGame(): Promise<void> {
    if (this.isSaving) {
      return;
    }
    this.isSaving = true;
    this.saveMessage = undefined;
    try {
      if (!this._saveService) {
        if (!this._bridge) {
          throw new Error('Engine bridge not available for save');
        }
        this._saveService = new GameSaveService({
          className: 'GameSaveService',
          bridge: this._bridge,
        });
      }
      await this._saveService.saveGame('manual-1');
      this.saveMessage = 'Game Saved!';
    } catch (error) {
      logger.debug('GameOverlayService:saveGame:error', { error: String(error) });
      this.saveMessage = 'Save failed';
    } finally {
      this.isSaving = false;
    }
  }

  async respawnPlayer(): Promise<void> {
    this.activeOverlay = 'NONE';
    gameModeService.setMode('EXPLORE');
    void audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
    this._engineService?.resumeEngine();
    await this._engineService?.loadMap({
      mapUrl: '/game-data/maps/sandbox_zone_a.json',
      targetX: 160,
      targetY: 192,
      defeatedEnemies: [...worldStateService.defeatedEnemies],
    });
  }

  async loadLastSave(): Promise<void> {
    await routerService.navigateToApp();
  }

  openVendor(options: { vendorId: string; vendorName: string; vendorInventory: string }): void {
    this.activeOverlay = 'VENDOR';
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
    this.vendorSessionOptions = options;
  }

  closeVendor(): void {
    this.activeOverlay = 'NONE';
    gameModeService.setMode('EXPLORE');
    this._engineService?.resumeEngine();
    this._handlers?.onVendorClose();
  }

  openInventory(): void {
    this.activeOverlay = 'INVENTORY';
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
    this._handlers?.onInventoryOpen();
  }

  closeInventory(): void {
    this.activeOverlay = 'NONE';
    gameModeService.setMode('EXPLORE');
    this._engineService?.resumeEngine();
    this._handlers?.onInventoryClose();
  }

  openQuestLog(): void {
    this.activeOverlay = 'QUEST_LOG';
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
    this._handlers?.onQuestLogOpen();
  }

  closeQuestLog(): void {
    this.activeOverlay = 'NONE';
    gameModeService.setMode('EXPLORE');
    this._engineService?.resumeEngine();
    this._handlers?.onQuestLogClose();
  }

  openCharacterDashboard(): void {
    this.activeOverlay = 'CHARACTER_DASHBOARD';
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
    this._handlers?.onDashboardOpen();
  }

  closeCharacterDashboard(): void {
    this.activeOverlay = 'NONE';
    gameModeService.setMode('EXPLORE');
    this._engineService?.resumeEngine();
    this._handlers?.onDashboardClose();
  }

  startCombat(options: { enemyName: string }): void {
    combatService.startCombat({
      enemyName: options.enemyName,
      enemyHp: 60,
      enemyMaxHp: 60,
      participantIds: [1, 2],
      firstTurnEntityId: 1,
      setActive: (overlay) => {
        this.setActive(overlay);
      },
    });
  }

  // ── Session Management (C-240) ─────────────────────────────────────

  /** @inheritdoc */
  openEndSession(): void {
    this.activeOverlay = 'END_SESSION';
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
  }

  /** @inheritdoc */
  closeEndSession(): void {
    this.activeOverlay = 'PAUSE_MENU';
  }

  /** @inheritdoc */
  async endSession(): Promise<void> {
    await sessionService.endSession({ playtimeMinutes: 30 });
  }

  /** @inheritdoc */
  async startNewSession(): Promise<void> {
    const gameId = worldStateService.worldGenOutput?.worldName ?? 'default';
    await sessionService.startNewSession({ gameId });
    this.activeOverlay = 'NONE';
    gameModeService.setMode('EXPLORE');
    this._engineService?.resumeEngine();
  }

  /** Resets onboarding hints for replay (C-327 AC-4). */
  replayOnboarding(): void {
    onboardingHintService.resetOnboarding();
  }

  private _togglePauseMenu(): void {
    if (this.activeOverlay === 'PAUSE_MENU') {
      this.resumeGame();
    } else if (this.activeOverlay === 'NONE') {
      this.activeOverlay = 'PAUSE_MENU';
      gameModeService.setMode('MENU');
      this._engineService?.pauseEngine();
    }
  }

  private async _initSettings(): Promise<void> {
    if (this._settingsLoaded) {
      return;
    }
    try {
      this._textProviderEndpoint = aiSettingsService.textProvider?.endpoint ?? '';
      this._useOllama = this._textProviderEndpoint.includes('localhost');
    } catch {
      // Settings not available — keep defaults
    }
    this._settingsLoaded = true;
  }
}

export const gameOverlayService: GameOverlayServiceInterface = GameOverlayService.create({
  className: 'GameOverlayService',
}) as GameOverlayServiceInterface;
