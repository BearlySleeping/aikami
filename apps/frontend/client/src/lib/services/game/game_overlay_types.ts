// apps/frontend/client/src/lib/services/game/game_overlay_types.ts
//
// Public contract of the overlay router, extracted from
// `game_overlay_service.svelte.ts` (C-525 R-5).
//
// `game_overlay_service.svelte.ts` is on the source-file-size guard's reviewed
// exception list, so the C-525 typed-rejection fix needed headroom: the
// declaration site moved here and the service re-exports it, so every existing
// import keeps working and behaviour is identical.
/** biome-ignore-all lint/style/useNamingConvention: GameOverlayType enum-like keys use SCREAMING_SNAKE_CASE */

import type {
  CombatEncounterParticipant,
  EngineBridge,
  InteractableStateMap,
} from '@aikami/frontend/engine';
import type {
  BaseFrontendClassInterface,
  BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { CombatEngineKind } from '@aikami/types';
import type { AutoSaveStatus, DialogueNpcData, GameOverlayType, OverlayStackEntry } from '$types';
import type { GameSaveServiceInterface } from './game_save_service.svelte.ts';

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
  openJournal(): void;
  closeJournal(): void;
  openCharacterDashboard(): void;
  closeCharacterDashboard(): void;

  // ── Party Roster (C-340) ──
  openPartyRoster(): void;
  closePartyRoster(): void;

  // ── Talk to Party (C-340) ──
  openTalkToParty(options: { npcId: string; name: string }): void;
  closeTalkToParty(): void;
  readonly talkToPartyOptions: { npcId: string; name: string } | undefined;

  // ── Reputation (C-341) ──
  openReputation(): void;
  closeReputation(): void;

  // ── World Codex (Phase 4) ──
  openWorld(): void;
  closeWorld(): void;

  /**
   * Opens the combat overlay and asks the engine to start the encounter.
   *
   * Returns a TYPED outcome: when the overlay could not be opened the call
   * reports why and dispatches no engine command at all, so a caller never
   * believes an encounter is running that the player cannot see (C-525 R-5).
   */
  startCombat(options: {
    enemyName: string;
    /** NPC id of the enemy, when combat was triggered from an NPC (C-500 portrait). */
    enemyNpcId?: string;
    /** Encounter ID so victory loot/quest triggers resolve (C-316). */
    encounterId?: string | null;
    /**
     * Authored roster resolved from the content pack on the main thread. The
     * engine solves positions and starts the encounter (C-516 AC-2).
     */
    roster?: CombatEncounterParticipant[];
    /** Deterministic encounter seed; a retry reuses it. */
    seed?: number;
    /** Pinned engine choice; defaults to the resolved `combatEngine` flag. */
    engine?: CombatEngineKind;
  }): CombatStartOutcome;
  /**
   * Dismisses an active combat overlay and restores engine input (C-500).
   * Combat entry pauses the engine, so leaving must resume it — otherwise
   * Escape would pop the overlay but leave the world paused.
   */
  closeCombat(): void;

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
  /** Returns the per-spawnId interactable state map for map-load persistence (C-342). */
  getInteractableStates(): InteractableStateMap;
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

/**
 * Why `startCombat` could not open the overlay.
 *
 * Client-side reason (the engine was never asked): the overlay router refused
 * the activation, e.g. an incompatible overlay is on screen.
 */
export type CombatStartRejection = {
  ok: false;
  reason: 'overlayUnavailable';
  messageKey: string;
};

/** The typed result of {@link GameOverlayServiceInterface.startCombat}. */
export type CombatStartOutcome = { ok: true } | CombatStartRejection;

/** i18n key for a combat start the overlay refused to open. */
export const COMBAT_START_OVERLAY_UNAVAILABLE_KEY = 'combat.start.overlay_unavailable';

export type GameOverlayServiceOptions = BaseFrontendClassOptions;
