// apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts
/** biome-ignore-all lint/style/useNamingConvention: GameOverlayType enum-like keys use SCREAMING_SNAKE_CASE */

import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  routerService,
} from '@aikami/frontend/services';
import {
  aiSettingsService,
  audioService,
  campaignService,
  gameModeService,
  gameSaveService,
  sessionService,
  worldStateService,
} from '$services';
import { setupBridgeListeners } from './bridge_listeners';
import { combatService } from './combat_service.svelte';
import { gameEngineService } from './game_engine_service.svelte';
import type { GameSaveServiceInterface } from './game_save_service.svelte.ts';
import { GameSaveService } from './game_save_service.svelte.ts';
import { inputActionService } from './input_action_service.svelte.ts';
import { npcDialogueService } from './npc_dialogue_service.svelte';
import { onboardingHintService } from './onboarding_hint_service.svelte.ts';
import { playerStateService } from './player_state_service.svelte';
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
  | 'END_SESSION'
  | 'SETTINGS'
  | 'PARTY_ROSTER'
  | 'TALK_TO_PARTY'
  | 'REPUTATION';

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
    PARTY_ROSTER: 'allow',
    REPUTATION: 'allow',
  },
  PAUSE_MENU: {
    INVENTORY: 'allow',
    QUEST_LOG: 'allow',
    CHARACTER_DASHBOARD: 'allow',
    END_SESSION: 'allow',
    SETTINGS: 'allow',
    REPUTATION: 'allow',
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
  SETTINGS: {},
  PARTY_ROSTER: {
    PAUSE_MENU: 'allow',
  },
  TALK_TO_PARTY: {},
  REPUTATION: {
    PAUSE_MENU: 'allow',
  },
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

  // ── Party Roster (C-340) ──
  openPartyRoster(): void;
  closePartyRoster(): void;

  // ── Reputation (C-341) ──
  openReputation(): void;
  closeReputation(): void;

  startCombat(options: { enemyName: string }): void;

  // ── Auto-Save Scheduling (C-334) ──

  /** Starts the auto-save interval timer. Called after engine init. */
  startAutoSaveScheduler(): void;
  /** Stops and clears the auto-save interval timer. */
  stopAutoSaveScheduler(): void;
  /** Whether the auto-save scheduler is currently running. */
  readonly autoSaveSchedulerActive: boolean;

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

  /** Push an overlay onto the stack. Respects the compatibility matrix. Returns true if pushed successfully. */
  pushOverlay(type: GameOverlayType): boolean;
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

  /** C-334: Checks for a stale session_active marker (crash detection). Returns the campaign ID or undefined. */
  checkSessionMarker(): Promise<string | undefined>;

  /** C-334: Clears the session_active marker (e.g. from the start menu after recovery). */
  clearSessionMarker(): Promise<void>;
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
  pushOverlay(type: GameOverlayType): boolean {
    if (type === 'NONE') {
      return false;
    }

    // Guard: check compatibility matrix
    const current = this.activeOverlay;
    const compat = OVERLAY_COMPATIBILITY[current]?.[type];

    if (compat === 'block') {
      this.debug('overlay:push:blocked', { type, current });
      return false;
    }

    // Explicit 'undefined' means not in compatibility matrix — reject unless explicitly allowed
    if (compat === undefined) {
      this.debug('overlay:push:rejected', { type, current });
      return false;
    }

    if (compat === 'clear') {
      this.debug('overlay:push:clear', { type, current });
      this.clearStack();
      // Fall through to push after clear
    }

    // Guard: no duplicates — pushing the same type that's already on top is a no-op
    if (this.activeOverlay === type) {
      this.debug('overlay:push:duplicate', { type });
      return false;
    }

    // Capture focus before opening overlay
    const previousFocus = document.activeElement as HTMLElement | undefined;

    this.overlayStack.push({ type, previousFocus });
    this.debug('overlay:push', { type, stackDepth: this.stackDepth });
    return true;
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
    let previousFocusToRetain: HTMLElement | undefined;

    if (this.overlayStack.length > 0) {
      const removed = this.overlayStack.pop();
      previousFocusToRetain = removed?.previousFocus;
    }

    // If we have a previousFocus from the removed overlay, temporarily override
    if (type !== 'NONE' && previousFocusToRetain !== undefined) {
      // Push with the retained previousFocus instead of capturing current focus
      const current = this.activeOverlay;
      const compat = OVERLAY_COMPATIBILITY[current]?.[type];

      if (compat === 'block') {
        this.debug('overlay:push:blocked', { type, current });
        return;
      }

      if (compat === undefined) {
        this.debug('overlay:push:rejected', { type, current });
        return;
      }

      if (compat === 'clear') {
        this.debug('overlay:push:clear', { type, current });
        this.clearStack();
      }

      if (this.activeOverlay === type) {
        this.debug('overlay:push:duplicate', { type });
        return;
      }

      this.overlayStack.push({ type, previousFocus: previousFocusToRetain });
      this.debug('overlay:replace', { type, stackDepth: this.stackDepth });
    } else {
      // Normal flow when stack was empty or no focus to retain
      this.pushOverlay(type);
    }
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

  // ── Auto-Save Scheduler (C-334) ───────────────────────────────────

  /** Default auto-save interval in milliseconds (2 minutes). */
  private static readonly _AUTOSAVE_INTERVAL_MS = 2 * 60 * 1000;

  /** Interval timer handle. */
  private _autoSaveTimer: ReturnType<typeof setInterval> | undefined;

  /** Whether the auto-save scheduler is running. */
  autoSaveSchedulerActive = $state(false);

  /** @inheritdoc */
  startAutoSaveScheduler(): void {
    if (this._autoSaveTimer) {
      return;
    }
    this.debug('autoSave:scheduler:start', {
      intervalMs: GameOverlayService._AUTOSAVE_INTERVAL_MS,
    });
    this._autoSaveTimer = setInterval(() => {
      void this._autoSaveTick();
    }, GameOverlayService._AUTOSAVE_INTERVAL_MS);
    this.autoSaveSchedulerActive = true;
  }

  /** @inheritdoc */
  stopAutoSaveScheduler(): void {
    if (this._autoSaveTimer) {
      clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = undefined;
    }
    this.autoSaveSchedulerActive = false;
    this.debug('autoSave:scheduler:stop');
  }

  /**
   * Called on each interval tick. Gates on safe state before triggering.
   */
  private async _autoSaveTick(): Promise<void> {
    // Gate: autosave must be enabled in settings
    if (!this._isAutosaveEnabled()) {
      this.debug('autoSave:tick:disabled');
      return;
    }

    // Gate: must be in EXPLORE mode (not combat, not dialogue, not menu)
    if (this.activeOverlay !== 'NONE') {
      this.debug('autoSave:tick:unsafe-overlay', { overlay: this.activeOverlay });
      return;
    }

    // Gate: must not be transitioning
    if (this.isTransitioning) {
      this.debug('autoSave:tick:transitioning');
      return;
    }

    // Gate: must not already be saving
    if (this.isSaving) {
      this.debug('autoSave:tick:already-saving');
      return;
    }

    await this._triggerAutoSave();
  }

  /**
   * Reads the autosave toggle from localStorage (set by GameplayViewModel).
   */
  private _isAutosaveEnabled(): boolean {
    try {
      const stored = localStorage.getItem('aikami_gameplay_settings');
      if (stored) {
        const parsed = JSON.parse(stored) as { autosave?: boolean };
        if (typeof parsed.autosave === 'boolean') {
          return parsed.autosave;
        }
      }
    } catch {
      // localStorage unavailable — default to enabled
    }
    return true;
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
    // Start auto-save scheduler on first map load (C-334)
    if (!this._firstMapLoaded) {
      this.startAutoSaveScheduler();
    }

    // Debounce auto-save after map transitions: clear any pending timer
    if (this._mapTransitionDebounce) {
      clearTimeout(this._mapTransitionDebounce);
    }

    // Trigger auto-save 1s after the LAST map transition (debounced)
    this._mapTransitionDebounce = setTimeout(() => {
      if (this._firstMapLoaded) {
        // Only trigger after the very first map load — subsequent auto-saves
        // are handled by the interval scheduler
        void this._triggerAutoSave();
      }
      this._mapTransitionDebounce = undefined;
    }, 1000);

    this._firstMapLoaded = true;
  }

  // Internal state (accessed via methods above, not directly)
  _previousInventoryCount = 0;
  _cameraZoomNpcScreenX: number | undefined;
  _cameraZoomNpcScreenY: number | undefined;
  private _firstMapLoaded = false;
  private _mapTransitionDebounce: ReturnType<typeof setTimeout> | undefined;

  private async _triggerAutoSave(): Promise<void> {
    this.autoSaveStatus = 'saving';
    try {
      const saveService = this._getOrCreateSaveService();
      if (!saveService) {
        this.autoSaveStatus = 'error';
        return;
      }

      const campaignId = campaignService.activeCampaign?.id;
      const mapName = worldStateService.currentLocation?.name ?? 'World';

      await saveService.saveGame({
        slotId: 'auto-save',
        campaignId,
        mapName,
      });
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
    // When the user is typing in an input/textarea, skip game action
    // processing (wasd movement, etc.) so keystrokes reach the text field.
    // However, Escape must still be processed to allow closing overlays.
    const target = event.target as HTMLElement | null;
    const isInputField =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);

    if (isInputField && event.key !== 'Escape') {
      return;
    }

    const actionId = inputActionService.keyToAction(event.key);

    // Only record game input when NOT typing in a field (prevents wasd
    // keystrokes from moving the character while chatting with a vendor).
    if (!isInputField) {
      inputActionService.onKeyDown();
    }

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

      // Dispatch through close methods to ensure proper cleanup and resume behavior
      if (this.activeOverlay === 'END_SESSION') {
        this.closeEndSession();
        return;
      }

      if (this.activeOverlay === 'PAUSE_MENU') {
        this.resumeGame();
        return;
      }

      if (this.activeOverlay === 'INVENTORY') {
        this.closeInventory();
        return;
      }

      if (this.activeOverlay === 'QUEST_LOG') {
        this.closeQuestLog();
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

      if (this.activeOverlay === 'SETTINGS') {
        this.popOverlay();
        return;
      }

      if (this.activeOverlay === 'PARTY_ROSTER') {
        this.closePartyRoster();
        return;
      }

      // Fallback: pop overlay directly for any other types
      this.popOverlay();
      return;
    }

    // ── Overlay toggle: open_inventory ──
    if (actionId === 'open_inventory') {
      if (this.activeOverlay === 'INVENTORY') {
        event.preventDefault();
        this.closeInventory();
        onboardingHintService.onActionPerformed('open_inventory');
        return;
      }
      if (!this.canOpenOverlay('INVENTORY')) {
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
      if (this.activeOverlay === 'QUEST_LOG') {
        event.preventDefault();
        this.closeQuestLog();
        return;
      }
      if (!this.canOpenOverlay('QUEST_LOG')) {
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
      if (this.activeOverlay === 'CHARACTER_DASHBOARD') {
        event.preventDefault();
        this.closeCharacterDashboard();
        return;
      }
      if (!this.canOpenOverlay('CHARACTER_DASHBOARD')) {
        return;
      }
      if (this.activeOverlay === 'NONE' || this.activeOverlay === 'PAUSE_MENU') {
        event.preventDefault();
        this.openCharacterDashboard();
        return;
      }
    }

    // ── Overlay toggle: open_party_roster (C-340) — P key ──
    if (actionId === 'open_party_roster') {
      if (this.activeOverlay === 'PARTY_ROSTER') {
        event.preventDefault();
        this.closePartyRoster();
        return;
      }
      if (!this.canOpenOverlay('PARTY_ROSTER')) {
        return;
      }
      if (this.activeOverlay === 'NONE' || this.activeOverlay === 'PAUSE_MENU') {
        event.preventDefault();
        this.openPartyRoster();
        return;
      }
    }

    // ── Hotbar activation: keys 1-6 ──
    if (this.activeOverlay === 'NONE') {
      const key = event.key;
      if (key >= '1' && key <= '6') {
        event.preventDefault();
        const slotIndex = Number.parseInt(key, 10) - 1; // Convert to zero-based index (key "1" -> index 0)
        const featureId = playerStateService.hotbarSlots[slotIndex];
        if (featureId) {
          playerStateService.useAbility(featureId);
          this.debug('hotbar:activate', { slotIndex, featureId });
        }
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
    // Push SETTINGS overlay on top of pause menu (C-333 AC-4)
    const success = this.pushOverlay('SETTINGS');
    if (!success) {
      // Fallback: navigate to full settings page
      await routerService.goToRoute('settings', {
        queryParameters: { from: 'game' },
        pathParameters: undefined,
      });
    }
  }

  async quitToMainMenu(): Promise<void> {
    // Clear auto-save scheduler and crash-detection marker (C-334)
    this.stopAutoSaveScheduler();
    await this._clearSessionMarker();
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
      const saveService = this._getOrCreateSaveService();
      if (!saveService) {
        throw new Error('Engine bridge not available for save');
      }

      const campaignId = campaignService.activeCampaign?.id;
      const mapName = worldStateService.currentLocation?.name ?? 'World';

      await saveService.saveGame({
        slotId: 'manual-1',
        campaignId,
        mapName,
      });
      this.saveMessage = 'Game Saved!';
    } catch (error) {
      this.warn('saveGame:error', { error: String(error) });
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
    // C-334: Actually reload the last save for the active campaign
    try {
      const campaignId = campaignService.activeCampaign?.id;
      if (!campaignId) {
        this.warn('loadLastSave:no-campaign');
        await routerService.navigateToApp();
        return;
      }

      // Fetch most recent save for this campaign
      await gameSaveService.fetchAvailableSaves(campaignId);
      const saves = gameSaveService.availableSaves;

      if (saves.length === 0) {
        this.warn('loadLastSave:no-saves');
        await routerService.navigateToApp();
        return;
      }

      // Load the most recent save
      const saveService = this._getOrCreateSaveService();
      if (!saveService) {
        this.warn('loadLastSave:no-bridge');
        return;
      }

      const latestSave = saves[0];
      this.debug('loadLastSave', { slotId: latestSave.id, mapName: latestSave.mapName });
      await saveService.loadGame(latestSave.id);

      // Navigate to the game
      await routerService.goToRoute('game', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('loadLastSave:failed', { error: String(error) });
      await routerService.navigateToApp();
    }
  }

  openVendor(options: { vendorId: string; vendorName: string; vendorInventory: string }): void {
    const success = this.pushOverlay('VENDOR');
    if (!success) {
      return;
    }
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
    const success = this.pushOverlay('INVENTORY');
    if (!success) {
      return;
    }
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
    const success = this.pushOverlay('QUEST_LOG');
    if (!success) {
      return;
    }
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
    const success = this.pushOverlay('CHARACTER_DASHBOARD');
    if (!success) {
      return;
    }
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

  // ── Party Roster (C-340) ──

  openPartyRoster(): void {
    const success = this.pushOverlay('PARTY_ROSTER');
    if (!success) {
      return;
    }
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
  }

  closePartyRoster(): void {
    this.popOverlay();
    if (this.activeOverlay === 'NONE') {
      gameModeService.setMode('EXPLORE');
      this._engineService?.resumeEngine();
    }
  }

  // ── Reputation (C-341) ──

  /** @inheritdoc */
  openReputation(): void {
    this.pushOverlay('REPUTATION');
    gameModeService.setMode('MENU');
    this._engineService?.pauseEngine();
  }

  /** @inheritdoc */
  closeReputation(): void {
    this.popOverlay();
    if (this.activeOverlay === 'NONE') {
      gameModeService.setMode('EXPLORE');
      this._engineService?.resumeEngine();
    }
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
    const success = this.pushOverlay('END_SESSION');
    if (!success) {
      return;
    }
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
      const success = this.pushOverlay('PAUSE_MENU');
      if (!success) {
        return;
      }
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

  // ── Crash Detection Session Marker (C-334 AC-5) ────────────────────

  /**
   * Returns the save service instance, creating it if necessary.
   * Returns undefined if the engine bridge is not available.
   */
  private _getOrCreateSaveService(): GameSaveServiceInterface | undefined {
    if (!this._saveService) {
      if (!this._bridge) {
        return undefined;
      }
      // @ts-expect-error — Generic inference mismatch in BaseClass.create
      this._saveService = GameSaveService.create({
        className: 'GameSaveService',
        bridge: this._bridge,
      }) as unknown as GameSaveServiceInterface;
    }
    return this._saveService;
  }

  /**
   * Writes a session_active marker to the meta table on game boot.
   * Called by bridge_listeners after engine initialization.
   */
  async writeSessionMarker(): Promise<void> {
    try {
      const campaignId = campaignService.activeCampaign?.id;
      if (!campaignId) {
        return;
      }
      const { getLocalDatabase } = await import('@aikami/frontend/repositories');
      const db = await getLocalDatabase();
      await db.execute({
        sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
        args: ['session_active', campaignId],
      });
      this.debug('sessionMarker:written', { campaignId });
    } catch (error) {
      this.warn('sessionMarker:write-failed', { error: String(error) });
    }
  }

  /**
   * Clears the session_active marker from the meta table on clean shutdown.
   */
  private async _clearSessionMarker(): Promise<void> {
    try {
      const { getLocalDatabase } = await import('@aikami/frontend/repositories');
      const db = await getLocalDatabase();
      await db.execute({
        sql: 'DELETE FROM meta WHERE key = ?',
        args: ['session_active'],
      });
      this.debug('sessionMarker:cleared');
    } catch (error) {
      this.warn('sessionMarker:clear-failed', { error: String(error) });
    }
  }

  /**
   * Checks for a stale session_active marker (crash detection).
   *
   * Returns the campaign ID that was active when the crash occurred,
   * or undefined if no marker exists.
   */
  async checkSessionMarker(): Promise<string | undefined> {
    try {
      const { getLocalDatabase } = await import('@aikami/frontend/repositories');
      const db = await getLocalDatabase();
      const result = await db.query({
        sql: 'SELECT value FROM meta WHERE key = ?',
        args: ['session_active'],
      });
      if (result.rows.length > 0) {
        return result.rows[0].value as string;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Clears the session_active marker (e.g. from the start menu after recovery).
   */
  async clearSessionMarker(): Promise<void> {
    await this._clearSessionMarker();
  }
}

export const gameOverlayService: GameOverlayServiceInterface = GameOverlayService.create({
  className: 'GameOverlayService',
}) as GameOverlayServiceInterface;
