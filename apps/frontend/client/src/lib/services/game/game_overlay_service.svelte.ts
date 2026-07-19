// apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts
/** biome-ignore-all lint/style/useNamingConvention: GameOverlayType enum-like keys use SCREAMING_SNAKE_CASE */

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
// GameOverlayService — overlay router for the game UI layer.
//
// C-332: Replaces flat active-overlay toggle with an explicit overlay stack.
// Pressing Escape always pops the top overlay — exactly one layer at a time.
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
  dialog?: string;
  personaId?: string;
};

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Entry in the overlay stack. 'NONE' is never pushed — an empty stack means no overlay. */
export type OverlayStackEntry = {
  type: GameOverlayType;
  /** Element that had focus before this overlay opened (for restore on pop). */
  previousFocus: HTMLElement | undefined;
};

/**
 * Overlay compatibility matrix — which overlay types can be pushed over
 * the current active overlay.
 *
 * Row = current active overlay, Column = overlay being opened.
 * 'allow'  = allowed
 * 'block'  = silently ignored
 * 'clear'  = clear stack first, then push (e.g. combat wipes non-combat overlays)
 */
type OverlayCompatibility = 'allow' | 'block' | 'clear';

const OVERLAY_COMPATIBILITY: Record<
  GameOverlayType,
  Partial<Record<GameOverlayType, OverlayCompatibility>>
> = {
  NONE: {
    PAUSE_MENU: 'allow',
    DIALOGUE: 'allow',
    COMBAT: 'allow',
    INVENTORY: 'allow',
    QUEST_LOG: 'allow',
    GAME_OVER: 'allow',
    CHARACTER_DASHBOARD: 'allow',
    VENDOR: 'allow',
    END_SESSION: 'allow',
  },
  PAUSE_MENU: {
    INVENTORY: 'allow',
    QUEST_LOG: 'allow',
    CHARACTER_DASHBOARD: 'allow',
    END_SESSION: 'allow',
  },
  DIALOGUE: {
    COMBAT: 'clear',
    GAME_OVER: 'clear',
  },
  COMBAT: {
    GAME_OVER: 'clear',
  },
  INVENTORY: {
    PAUSE_MENU: 'allow',
  },
  QUEST_LOG: {
    PAUSE_MENU: 'allow',
  },
  CHARACTER_DASHBOARD: {
    PAUSE_MENU: 'allow',
  },
  VENDOR: {
    PAUSE_MENU: 'allow',
  },
  GAME_OVER: {},
  END_SESSION: {},
};

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
  readonly overlayStack: readonly OverlayStackEntry[];
  readonly stackDepth: number;
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

  // ── Overlay Stack (C-332) ──

  /** Push an overlay onto the stack. Respects the compatibility matrix. */
  pushOverlay(type: GameOverlayType): void;
  /** Pop the top overlay. Restores focus to the element that had focus before. */
  popOverlay(): void;
  /** Replace the top overlay (pop then push). */
  replaceOverlay(type: GameOverlayType): void;
  /** Clear the entire overlay stack (terminal state — combat, game over). */
  clearStack(): void;
  /** Check if a given overlay type can be opened over the current state. */
  canOpenOverlay(type: GameOverlayType): boolean;
  setTransitioning(value: boolean): void;
  getDefeatedEnemies(): string[];
  /** Returns the collected item pickup spawn IDs for map-load suppression (C-331). */
  getCollectedPickups(): string[];
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
  setInteractionPrompt(options: {
    label: string;
    visible: boolean;
    targetMetadata?: { verb: string; targetName: string };
  }): void;
};

export type GameOverlayServiceOptions = BaseFrontendClassOptions;

export class GameOverlayService
  extends BaseFrontendClass<GameOverlayServiceOptions>
  implements GameOverlayServiceInterface
{
  /** Overlay stack — the top entry is the active overlay. Empty stack = no overlay. */
  overlayStack = $state<OverlayStackEntry[]>([]);
  dialogueNpc = $state<DialogueNpcData | undefined>(undefined);

  /** Derived — top of the stack, or NONE if empty. */
  get activeOverlay(): GameOverlayType {
    return this.overlayStack.length > 0
      ? this.overlayStack[this.overlayStack.length - 1].type
      : 'NONE';
  }

  /** Readable alias for backward compat — setter routes through pushOverlay/popOverlay. */
  set activeOverlay(type: GameOverlayType) {
    if (type === 'NONE') {
      this.clearStack();
      return;
    }
    this.pushOverlay(type);
  }

  get stackDepth(): number {
    return this.overlayStack.length;
  }
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
    if (type === 'NONE') {
      this.clearStack();
      return;
    }
    this.pushOverlay(type);
  }

  /** Resets overlay to NONE. */
  clearActive(): void {
    this.clearStack();
  }

  // ── Overlay Stack Operations (C-332) ─────────────────────────────

  /** @inheritdoc */
  pushOverlay(type: GameOverlayType): void {
    if (type === 'NONE') {
      return;
    }

    // Guard: check compatibility matrix
    const current = this.activeOverlay;
    const compat = OVERLAY_COMPATIBILITY[current]?.[type];

    if (compat === 'block') {
      this.debug('overlay:push:blocked', { type, current });
      return;
    }

    if (compat === 'clear') {
      this.debug('overlay:push:clear', { type, current });
      this.clearStack();
      // Fall through to push after clear
    }

    // Guard: no duplicates — pushing the same type that's already on top is a no-op
    if (this.activeOverlay === type) {
      this.debug('overlay:push:duplicate', { type });
      return;
    }

    // Capture focus before opening overlay
    const previousFocus = document.activeElement as HTMLElement | undefined;

    this.overlayStack.push({ type, previousFocus });
    this.debug('overlay:push', { type, stackDepth: this.stackDepth });
  }

  /** @inheritdoc */
  popOverlay(): void {
    if (this.overlayStack.length === 0) {
      this.debug('overlay:pop:empty');
      return;
    }

    const entry = this.overlayStack[this.overlayStack.length - 1];
    this.overlayStack.pop();
    this.debug('overlay:pop', { type: entry.type, stackDepth: this.stackDepth });

    // Restore focus to the element that was focused before this overlay opened
    this._restoreFocus(entry.previousFocus);
  }

  /** @inheritdoc */
  replaceOverlay(type: GameOverlayType): void {
    if (this.overlayStack.length > 0) {
      this.overlayStack.pop();
    }
    this.pushOverlay(type);
  }

  /** @inheritdoc */
  clearStack(): void {
    if (this.overlayStack.length === 0) {
      return;
    }
    this.debug('overlay:clearStack', { previousDepth: this.stackDepth });
    // Restore focus to the element from the bottom-most entry
    const bottomEntry = this.overlayStack[0];
    this.overlayStack = [];
    this._restoreFocus(bottomEntry.previousFocus);
  }

  /** @inheritdoc */
  canOpenOverlay(type: GameOverlayType): boolean {
    if (type === 'NONE') {
      return false;
    }
    const current = this.activeOverlay;
    const compat = OVERLAY_COMPATIBILITY[current]?.[type];
    return compat === 'allow' || compat === 'clear';
  }

  /**
   * Restores keyboard focus to a previously-focused element.
   * Falls back to the game canvas container if no element is stored.
   */
  private _restoreFocus(previousFocus: HTMLElement | undefined): void {
    // Schedule on microtask so DOM is updated after overlay removal
    queueMicrotask(() => {
      const target = previousFocus ?? document.getElementById('game-canvas-container');
      if (target instanceof HTMLElement) {
        target.focus();
      }
    });
  }

  /** Intent-driven transition state. */
  setTransitioning(value: boolean): void {
    this.isTransitioning = value;
  }

  /** Returns the current defeated enemies list. */
  getDefeatedEnemies(): string[] {
    return [...worldStateService.defeatedEnemies];
  }

  /** @inheritdoc */
  getCollectedPickups(): string[] {
    return [...worldStateService.collectedPickups];
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
  setInteractionPrompt(options: {
    label: string;
    visible: boolean;
    targetMetadata?: { verb: string; targetName: string };
  }): void {
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

    // ── Escape: always pops exactly one layer (C-332 AC-2) ──
    if (actionId === 'open_menu') {
      event.preventDefault();
      onboardingHintService.onActionPerformed('open_menu');

      // Game Over is terminal — Escape does nothing; overlay has its own controls
      if (this.activeOverlay === 'GAME_OVER') {
        return;
      }

      // Dialogue is always a leaf — close to NONE, not a prior overlay
      if (this.activeOverlay === 'DIALOGUE') {
        this.endDialogue();
        return;
      }

      // If nothing is open, open pause menu
      if (this.activeOverlay === 'NONE') {
        this._togglePauseMenu();
        return;
      }

      // Otherwise, pop exactly one layer
      // END_SESSION → PAUSE_MENU (not NONE) handled by closeEndSession
      if (this.activeOverlay === 'END_SESSION') {
        this.closeEndSession();
        return;
      }

      this.popOverlay();
      return;
    }

    // ── Overlay toggle: open_inventory ──
    if (actionId === 'open_inventory') {
      if (!this.canOpenOverlay('INVENTORY')) {
        return;
      }
      if (this.activeOverlay === 'INVENTORY') {
        event.preventDefault();
        this.closeInventory();
        onboardingHintService.onActionPerformed('open_inventory');
        return;
      }
      if (this.activeOverlay === 'NONE' || this.activeOverlay === 'PAUSE_MENU') {
        event.preventDefault();
        this.openInventory();
        onboardingHintService.onActionPerformed('open_inventory');
        return;
      }
      return;
    }

    // ── Overlay toggle: open_quest_log ──
    if (actionId === 'open_quest_log') {
      if (!this.canOpenOverlay('QUEST_LOG')) {
        return;
      }
      if (this.activeOverlay === 'QUEST_LOG') {
        event.preventDefault();
        this.closeQuestLog();
        return;
      }
      if (this.activeOverlay === 'NONE' || this.activeOverlay === 'PAUSE_MENU') {
        event.preventDefault();
        this.openQuestLog();
        return;
      }
      return;
    }

    // ── Overlay toggle: open_character ──
    if (actionId === 'open_character') {
      if (!this.canOpenOverlay('CHARACTER_DASHBOARD')) {
        return;
      }
      if (this.activeOverlay === 'CHARACTER_DASHBOARD') {
        event.preventDefault();
        this.closeCharacterDashboard();
        return;
      }
      if (this.activeOverlay === 'NONE' || this.activeOverlay === 'PAUSE_MENU') {
        event.preventDefault();
        this.openCharacterDashboard();
        return;
      }
    }

    // ── Fallthrough: notify onboarding of any recognized action that wasn't rejected ──
    if (actionId) {
      onboardingHintService.onActionPerformed(actionId);
    }
  }

  resumeGame(): void {
    this.clearStack();
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
    this.clearStack();
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
      collectedPickups: [...worldStateService.collectedPickups],
    });
  }

  async loadLastSave(): Promise<void> {
    await routerService.navigateToApp();
  }

  openVendor(options: { vendorId: string; vendorName: string; vendorInventory: string }): void {
    this.pushOverlay('VENDOR');
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
    this.vendorSessionOptions = options;
  }

  closeVendor(): void {
    this.popOverlay();
    if (this.activeOverlay === 'NONE') {
      gameModeService.setMode('EXPLORE');
      this._engineService?.resumeEngine();
    }
    this._handlers?.onVendorClose();
  }

  openInventory(): void {
    this.pushOverlay('INVENTORY');
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
    this._handlers?.onInventoryOpen();
  }

  closeInventory(): void {
    this.popOverlay();
    if (this.activeOverlay === 'NONE') {
      gameModeService.setMode('EXPLORE');
      this._engineService?.resumeEngine();
    }
    this._handlers?.onInventoryClose();
  }

  openQuestLog(): void {
    this.pushOverlay('QUEST_LOG');
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
    this._handlers?.onQuestLogOpen();
  }

  closeQuestLog(): void {
    this.popOverlay();
    if (this.activeOverlay === 'NONE') {
      gameModeService.setMode('EXPLORE');
      this._engineService?.resumeEngine();
    }
    this._handlers?.onQuestLogClose();
  }

  openCharacterDashboard(): void {
    this.pushOverlay('CHARACTER_DASHBOARD');
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
    this._handlers?.onDashboardOpen();
  }

  closeCharacterDashboard(): void {
    this.popOverlay();
    if (this.activeOverlay === 'NONE') {
      gameModeService.setMode('EXPLORE');
      this._engineService?.resumeEngine();
    }
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
    this.pushOverlay('END_SESSION');
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
  }

  /** @inheritdoc */
  closeEndSession(): void {
    // Pop END_SESSION to return to PAUSE_MENU
    this.popOverlay();
  }

  /** @inheritdoc */
  async endSession(): Promise<void> {
    await sessionService.endSession({ playtimeMinutes: 30 });
  }

  /** @inheritdoc */
  async startNewSession(): Promise<void> {
    const gameId = worldStateService.worldGenOutput?.worldName ?? 'default';
    await sessionService.startNewSession({ gameId });
    this.clearStack();
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
      this.pushOverlay('PAUSE_MENU');
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
