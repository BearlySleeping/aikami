// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { untrack } from 'svelte';
import type { GameEngineServiceInterface, NpcDialogueServiceInterface } from '$services';
import type { AutoSaveStatus, DialogueNpcData, GameOverlayType, OverlayStackEntry } from '$types';
import type { getCombatViewModel } from '$views/combat/combat_composition.ts';
import type {
  CombatViewModel,
  CombatViewModelInterface,
} from '$views/combat/combat_view_model.svelte';
import type { getCharacterSheetViewModel } from '$views/game/dashboard/character_sheet_composition.ts';
import type { CharacterSheetViewModelInterface } from '$views/game/dashboard/character_sheet_view_model.svelte';
import type { getDialogueOverlayViewModel } from '$views/game/ui/overlays/dialogue/dialogue_overlay_composition.ts';
import type { DialogueOverlayViewModelInterface } from '$views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte';
import type { getEndSessionViewModel } from '$views/game/ui/overlays/end_session/end_session_composition.ts';
import type { EndSessionViewModelInterface } from '$views/game/ui/overlays/end_session/end_session_view_model.svelte';
import type { getGameOverViewModel } from '$views/game/ui/overlays/game_over/game_over_composition.ts';
import type { GameOverViewModelInterface } from '$views/game/ui/overlays/game_over/game_over_view_model.svelte';
import type { getPartyRosterViewModel } from '$views/game/ui/overlays/party_roster/party_roster_composition.ts';
import type { PartyRosterViewModelInterface } from '$views/game/ui/overlays/party_roster/party_roster_view_model.svelte';
import type { getPauseMenuViewModel } from '$views/game/ui/overlays/pause_menu/pause_menu_composition.ts';
import type { PauseMenuViewModelInterface } from '$views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte';
import type { getReputationViewModel } from '$views/game/ui/overlays/reputation/reputation_composition.ts';
import type { ReputationViewModelInterface } from '$views/game/ui/overlays/reputation/reputation_view_model.svelte';
import type { getSettingsOverlayViewModel } from '$views/game/ui/overlays/settings/settings_overlay_composition.ts';
import type { SettingsOverlayViewModelInterface } from '$views/game/ui/overlays/settings/settings_overlay_view_model.svelte';
import type { getTalkToPartyViewModel } from '$views/game/ui/overlays/talk_to_party/talk_to_party_composition.ts';
import type { TalkToPartyViewModelInterface } from '$views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte';
import type { getQuestTrackerViewModel } from '$views/game/ui/quest_tracker_composition.ts';
import type { QuestTrackerViewModelInterface } from '$views/game/ui/quest_tracker_view_model.svelte';
import type { getInventoryViewModel } from '$views/inventory/inventory_composition.ts';
import type { InventoryViewModelInterface } from '$views/inventory/inventory_view_model.svelte';
import type { getJournalViewModel } from '$views/journal/journal_composition.ts';
import type {
  JournalTab,
  JournalViewModelInterface,
} from '$views/journal/journal_view_model.svelte';
import type { getQuestViewModel } from '$views/quest/quest_composition.ts';
import type { QuestViewModelInterface } from '$views/quest/quest_view_model.svelte.ts';
import type { getVendorViewModel } from '$views/vendor/vendor_composition.ts';
import type { VendorViewModelInterface } from '$views/vendor/vendor_view_model.svelte';
import type { getWorldViewModel } from '$views/world/world_composition.ts';
import type { WorldTab, WorldViewModelInterface } from '$views/world/world_view_model.svelte';
import {
  hpPercent,
  showAutosaveIndicator,
  showClockHud,
  showHotbar,
  showHpBar,
  showManagementNav,
  showQuestTracker,
} from './game_ui_hud_visibility.ts';
import type {
  GameUIChatCapabilities,
  GameUICombatStateCapabilities,
  GameUIConfigCapabilities,
  GameUIInputActionCapabilities,
  GameUIOnboardingCapabilities,
  GameUIOverlayCapabilities,
  GameUIPlayerStateCapabilities,
  GameUIQuestOverlayCapabilities,
  GameUIRuntimeConfigCapabilities,
  GameUISessionCapabilities,
  GameUITimeCapabilities,
  GameUIMotionCapabilities,
} from './game_ui_view_model_types.ts';
import {
  DEFAULT_MENU_LOCATION,
  isManagementOverlay,
  type ManagementLocation,
  type ManagementSectionId,
  managementLocationFromOverlay,
  managementOverlayFor,
  normalizeManagementLocation,
} from './management_sections.ts';
import {
  type MotionPreference,
  motionAttributeValue,
  resolveReducedMotion,
} from '$types';

const LOCAL_TEXT_PROVIDERS = new Set(['ollama', 'llamacpp', 'ooba']);

/**
 * C-527: section subview → the owning feature view's OWN tab id.
 *
 * The management registry speaks navigation (a section plus a canonical
 * subview); the feature views speak their own tab vocabulary. `world` lands on
 * the World view's real default tab, because 'codex' names the section's
 * content, not one of `WorldTab` — feeding it straight to `setActiveTab` would
 * put the view in an invalid tab and throw on the next read.
 *
 * A subview with no entry here leaves the view on its own default.
 */
const JOURNAL_TAB_BY_SUBVIEW: Readonly<Record<string, JournalTab>> = {
  quests: 'quests',
  notes: 'notes',
  recaps: 'recaps',
};

const WORLD_TAB_BY_SUBVIEW: Readonly<Record<string, WorldTab>> = {
  codex: 'people',
};

// Re-export for sub-ViewModels
export type { AutoSaveStatus, DialogueNpcData, GameOverlayType };

/**
 * C-527 AC-2 — the captured origin of a management session.
 *
 * Directive 3: the host must be able to return the player to exactly where they
 * came from. The overlay stack already preserves the originating overlay and its
 * focus element; this type carries the parts the stack does not own.
 */
export type ManagementReturnContext = {
  /** Overlay that was active when the host opened (`NONE` = plain exploration). */
  originOverlay: GameOverlayType;
  /** NPC of the conversation the host was opened over, when there was one. */
  npcId?: string;
  /** Identity of the unsent composer draft, so it stays on the same actor. */
  draftId?: string;
  /** Scroll anchor of the originating surface, in CSS pixels. */
  scrollAnchor?: number;
};

// ---------------------------------------------------------------------------
// GameUIViewModel — overlay router for the game UI layer.
//
// Creates and manages all overlay sub-ViewModels. The View reads
// activeOverlay to pick which overlay component to render.
// ---------------------------------------------------------------------------

export type GameUIViewModelOptions = BaseViewModelOptions & {
  /** Chat state read for the auto-summary threshold effect. */
  chat: GameUIChatCapabilities;
  /** Combat-encounter state read when the combat overlay activates. */
  combat: GameUICombatStateCapabilities;
  /** Text-provider configuration read for onboarding hints. */
  config: GameUIConfigCapabilities;
  /** Runtime text-endpoint configuration read for onboarding hints. */
  runtimeConfig: GameUIRuntimeConfigCapabilities;
  /** Overlay router operations and observable state. */
  overlays: GameUIOverlayCapabilities;
  /** Keybinding label resolution for onboarding input hints. */
  inputAction: GameUIInputActionCapabilities;
  /** NPC dialogue orchestrator. */
  npcDialogue: NpcDialogueServiceInterface;
  /** Onboarding hint state and actions. */
  onboarding: GameUIOnboardingCapabilities;
  /** Player HP reads for the HUD. */
  playerState: GameUIPlayerStateCapabilities;
  /** Quest overlay visibility read for the HUD. */
  questOverlay: GameUIQuestOverlayCapabilities;
  /** Session state read for chat locking and auto-summary. */
  session: GameUISessionCapabilities;
  /** Game-time reads for the clock and weather HUD. */
  time: GameUITimeCapabilities;
  /** C-527 AC-6: the player's persisted motion selection. */
  motion: GameUIMotionCapabilities;
  /** Engine service registered with the overlay router. */
  engine: GameEngineServiceInterface;

  // ── Sub-ViewModel factories (production wiring lives in the composition) ──

  createCombatViewModel: typeof getCombatViewModel;
  createDialogueOverlayViewModel: typeof getDialogueOverlayViewModel;
  createInventoryViewModel: typeof getInventoryViewModel;
  createQuestViewModel: typeof getQuestViewModel;
  createJournalViewModel: typeof getJournalViewModel;
  createCharacterSheetViewModel: typeof getCharacterSheetViewModel;
  createVendorViewModel: typeof getVendorViewModel;
  createEndSessionViewModel: typeof getEndSessionViewModel;
  createGameOverViewModel: typeof getGameOverViewModel;
  createPauseMenuViewModel: typeof getPauseMenuViewModel;
  createSettingsOverlayViewModel: typeof getSettingsOverlayViewModel;
  createPartyRosterViewModel: typeof getPartyRosterViewModel;
  createReputationViewModel: typeof getReputationViewModel;
  createWorldViewModel: typeof getWorldViewModel;
  createTalkToPartyViewModel: typeof getTalkToPartyViewModel;
  createQuestTrackerViewModel: typeof getQuestTrackerViewModel;
};

export type GameUIViewModelInterface = BaseViewModelInterface & {
  readonly activeOverlay: GameOverlayType;
  readonly overlayStack: readonly OverlayStackEntry[];
  readonly isTransitioning: boolean;
  readonly isCombat: boolean;
  readonly autoSaveStatus: AutoSaveStatus;
  readonly gameHour: number;
  readonly gameMinute: number;
  readonly windVelocity: number;
  readonly rainIntensity: number;

  /** Whether the chat is locked (read-only) — session has ended. */
  readonly chatLocked: boolean;

  // ── Player HP (C-332 AC-1) ──

  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly hpPercent: number;

  // ── Quest Tracker (C-332 AC-1) ──

  readonly questTrackerViewModel: QuestTrackerViewModelInterface;

  // ── HUD Visibility (C-332 AC-1, AC-5) ──

  /** Whether to show the clock HUD (hidden during pause menu, game over, end session). */
  readonly showClockHud: boolean;
  /** Whether to show the HP bar (explore only, hidden during combat, pause, game over). */
  readonly showHpBar: boolean;
  /** Whether to show the quest tracker (explore only). */
  readonly showQuestTracker: boolean;
  /** Whether the quest overlay is visible (persisted setting). */
  readonly questOverlayVisible: boolean;
  /** Whether to show the autosave indicator (hidden during pause menu, game over, end session). */
  readonly showAutosaveIndicator: boolean;
  /** Whether to show the hotbar (C-337) — visible during exploration, hidden during overlays/combat. */
  readonly showHotbar: boolean;
  /** Whether the exploration management navigation is visible. */
  readonly showManagementNav: boolean;

  // ── Management navigation (HUD → overlay router) ──

  /**
   * Concatenated location of the active management overlay, or undefined when
   * the current overlay is not a management destination. Derived from the
   * overlay stack via the C-527 legacy mapping — there is no second router.
   */
  readonly managementLocation: ManagementLocation | undefined;
  /** The last location opened through the host, used by the Menu entry. */
  readonly menuLocation: ManagementLocation;
  /** Whether the current overlay is one of the management destinations. */
  readonly isManagementOpen: boolean;
  /**
   * Captured origin of the current management session, or undefined when no
   * session is open. Used by `closeManagement` to return the player.
   */
  readonly returnContext: ManagementReturnContext | undefined;

  /** Opens a canonical section at its default subview. */
  openManagementSection(section: ManagementSectionId): void;
  /**
   * Opens (or replaces a sibling with) a normalized management location.
   * Unknown sections are ignored; an unknown subview falls back to the
   * section default rather than throwing.
   */
  openManagementLocation(location: ManagementLocation): void;
  /** Opens the management host through the HUD Menu entry. */
  openManagementMenu(): void;
  /** Closes the active management section through its owning overlay close. */
  closeManagement(): void;

  // ── Overlay ViewModels (created on demand by initialize) ──

  readonly pauseMenuViewModel: PauseMenuViewModelInterface | undefined;
  readonly dialogueViewModel: DialogueOverlayViewModelInterface | undefined;
  readonly inventoryViewModel: InventoryViewModelInterface | undefined;
  readonly questViewModel: QuestViewModelInterface | undefined;
  readonly journalViewModel: JournalViewModelInterface | undefined;
  readonly dashboardViewModel: CharacterSheetViewModelInterface | undefined;
  readonly combatViewModel: CombatViewModelInterface | undefined;
  readonly vendorViewModel: VendorViewModelInterface | undefined;
  readonly endSessionViewModel: EndSessionViewModelInterface | undefined;
  readonly gameOverViewModel: GameOverViewModelInterface | undefined;
  readonly settingsOverlayViewModel: SettingsOverlayViewModelInterface | undefined;

  // ── Party Roster (C-340) ──
  readonly partyRosterViewModel: PartyRosterViewModelInterface | undefined;

  // ── Reputation (C-341) ──
  readonly reputationViewModel: ReputationViewModelInterface | undefined;

  // ── World Codex (Phase 4) ──
  readonly worldViewModel: WorldViewModelInterface | undefined;

  // ── Talk to Party (C-340) ──
  readonly talkToPartyViewModel: TalkToPartyViewModelInterface | undefined;

  // ── Interaction HUD (C-327) ──

  /** Current interaction prompt label (e.g. "E — Talk to Elder Thalia"). */
  readonly interactionPromptLabel: string;
  /** Whether the interaction prompt is visible. */
  readonly interactionPromptVisible: boolean;
  /** Current onboarding hint text, or undefined if none. */
  readonly onboardingHintText: string | undefined;
  /** Whether the onboarding hint toast is visible. */
  readonly onboardingHintVisible: boolean;
  /** Index of the current onboarding step (0-based), or -1 if none. */
  readonly onboardingStepIndex: number;
  /** Total number of onboarding steps in the loaded arc. */
  readonly onboardingTotalSteps: number;
  /** Whether the user prefers reduced motion (AC-5). */
  readonly reducedMotion: boolean;
  /** C-527 AC-6: the `data-motion` value the effective policy publishes. */
  readonly motionAttribute: 'reduced' | 'full';
  /** C-527 AC-6: the player's explicit motion selection (`auto` follows the OS). */
  readonly motionPreference: MotionPreference;
  /**
   * C-527 AC-6: sets the explicit motion selection. An explicit value wins
   * under either OS preference; `auto` defers to the OS.
   */
  setMotionPreference(preference: MotionPreference): void;

  handleKeyDown(event: KeyboardEvent): void;
  /** Tab-focus-trap for the Quest Log dialog only — must NOT also dispatch to
   * this._overlays.handleKeyDown(), which the window-level listener
   * already calls for the same keydown as it bubbles up. */
  handleQuestLogDialogKeyDown(event: KeyboardEvent): void;
  handleBackdropClick(event: MouseEvent): void;
  resumeGame(): void;
  endDialogue(): void;
  saveGame(): Promise<void>;
  respawnPlayer(): Promise<void>;
  loadLastSave(): Promise<void>;
  dismissOnboardingHint(): void;
  /** Skips the entire onboarding arc (C-422 AC-3). */
  skipOnboardingHint(): void;
};

class GameUIViewModel
  extends BaseViewModel<GameUIViewModelOptions>
  implements GameUIViewModelInterface
{
  private readonly _chat: GameUIChatCapabilities;
  private readonly _combat: GameUICombatStateCapabilities;
  private readonly _config: GameUIConfigCapabilities;
  private readonly _runtimeConfig: GameUIRuntimeConfigCapabilities;
  private readonly _overlays: GameUIOverlayCapabilities;
  private readonly _inputAction: GameUIInputActionCapabilities;
  private readonly _npcDialogue: NpcDialogueServiceInterface;
  private readonly _onboarding: GameUIOnboardingCapabilities;
  private readonly _playerState: GameUIPlayerStateCapabilities;
  private readonly _questOverlay: GameUIQuestOverlayCapabilities;
  private readonly _session: GameUISessionCapabilities;
  private readonly _time: GameUITimeCapabilities;
  private readonly _motion: GameUIMotionCapabilities;
  private readonly _engine: GameEngineServiceInterface;

  private readonly _createCombatViewModel: typeof getCombatViewModel;
  private readonly _createDialogueOverlayViewModel: typeof getDialogueOverlayViewModel;
  private readonly _createInventoryViewModel: typeof getInventoryViewModel;
  private readonly _createQuestViewModel: typeof getQuestViewModel;
  private readonly _createJournalViewModel: typeof getJournalViewModel;
  private readonly _createCharacterSheetViewModel: typeof getCharacterSheetViewModel;
  private readonly _createVendorViewModel: typeof getVendorViewModel;
  private readonly _createEndSessionViewModel: typeof getEndSessionViewModel;
  private readonly _createGameOverViewModel: typeof getGameOverViewModel;
  private readonly _createPauseMenuViewModel: typeof getPauseMenuViewModel;
  private readonly _createSettingsOverlayViewModel: typeof getSettingsOverlayViewModel;
  private readonly _createPartyRosterViewModel: typeof getPartyRosterViewModel;
  private readonly _createReputationViewModel: typeof getReputationViewModel;
  private readonly _createWorldViewModel: typeof getWorldViewModel;
  private readonly _createTalkToPartyViewModel: typeof getTalkToPartyViewModel;

  // ── Overlay ViewModels ──

  pauseMenuViewModel = $state<PauseMenuViewModelInterface | undefined>(undefined);
  dialogueViewModel = $state<DialogueOverlayViewModelInterface | undefined>(undefined);
  inventoryViewModel = $state<InventoryViewModelInterface | undefined>(undefined);
  questViewModel = $state<QuestViewModelInterface | undefined>(undefined);
  journalViewModel = $state<JournalViewModelInterface | undefined>(undefined);
  dashboardViewModel = $state<CharacterSheetViewModelInterface | undefined>(undefined);
  combatViewModel = $state<CombatViewModelInterface | undefined>(undefined);
  vendorViewModel = $state<VendorViewModelInterface | undefined>(undefined);
  endSessionViewModel = $state<EndSessionViewModelInterface | undefined>(undefined);
  gameOverViewModel = $state<GameOverViewModelInterface | undefined>(undefined);
  settingsOverlayViewModel = $state<SettingsOverlayViewModelInterface | undefined>(undefined);

  // ── Party Roster (C-340) ──
  partyRosterViewModel = $state<PartyRosterViewModelInterface | undefined>(undefined);

  // ── Reputation (C-341) ──
  reputationViewModel = $state<ReputationViewModelInterface | undefined>(undefined);

  // ── World Codex (Phase 4) ──
  worldViewModel = $state<WorldViewModelInterface | undefined>(undefined);

  // ── Talk to Party (C-340) ──
  talkToPartyViewModel = $state<TalkToPartyViewModelInterface | undefined>(undefined);

  /** Quest tracker ViewModel (C-332 AC-1) — created eagerly, filters only when visible. */
  readonly questTrackerViewModel: QuestTrackerViewModelInterface;

  constructor(options: GameUIViewModelOptions) {
    super(options);
    this._chat = options.chat;
    this._combat = options.combat;
    this._config = options.config;
    this._runtimeConfig = options.runtimeConfig;
    this._overlays = options.overlays;
    this._inputAction = options.inputAction;
    this._npcDialogue = options.npcDialogue;
    this._onboarding = options.onboarding;
    this._playerState = options.playerState;
    this._questOverlay = options.questOverlay;
    this._session = options.session;
    this._time = options.time;
    this._motion = options.motion;
    this._engine = options.engine;

    this._createCombatViewModel = options.createCombatViewModel;
    this._createDialogueOverlayViewModel = options.createDialogueOverlayViewModel;
    this._createInventoryViewModel = options.createInventoryViewModel;
    this._createQuestViewModel = options.createQuestViewModel;
    this._createJournalViewModel = options.createJournalViewModel;
    this._createCharacterSheetViewModel = options.createCharacterSheetViewModel;
    this._createVendorViewModel = options.createVendorViewModel;
    this._createEndSessionViewModel = options.createEndSessionViewModel;
    this._createGameOverViewModel = options.createGameOverViewModel;
    this._createPauseMenuViewModel = options.createPauseMenuViewModel;
    this._createSettingsOverlayViewModel = options.createSettingsOverlayViewModel;
    this._createPartyRosterViewModel = options.createPartyRosterViewModel;
    this._createReputationViewModel = options.createReputationViewModel;
    this._createWorldViewModel = options.createWorldViewModel;
    this._createTalkToPartyViewModel = options.createTalkToPartyViewModel;

    this.questTrackerViewModel = options.createQuestTrackerViewModel({
      className: 'QuestTrackerViewModel',
    });
  }

  // ── Interaction HUD state (C-327) ──

  get interactionPromptLabel(): string {
    return this._overlays.interactionPromptLabel;
  }

  get interactionPromptVisible(): boolean {
    return this._overlays.interactionPromptVisible;
  }

  get onboardingHintText(): string | undefined {
    const hint = this._onboarding.currentHint;
    if (!hint) {
      return undefined;
    }

    // C-422 AC-5: Check if this step requires a model but none is configured
    if (hint.requiresModel && !this._hasTextProvider()) {
      return 'This step needs an AI model — configure one in Settings, or skip this step.';
    }

    // Replace {key} placeholder with the current binding label (input steps only)
    if (hint.action.kind === 'input') {
      const keyLabel = this._inputAction.actionDisplayLabel(hint.action.actionId);
      return hint.text.replaceAll('{key}', keyLabel);
    }
    // Event steps have no keybinding — return text as-is
    return hint.text;
  }

  get onboardingHintVisible(): boolean {
    // C-327 AC-3: suppress the toast while any overlay (dialogue, inventory,
    // pause menu, ...) is open — the taught key is often unusable there
    // (e.g. "Press Q" while mid-conversation), and the hint reappears once
    // the overlay closes since the underlying step is still pending.
    return this._onboarding.hintVisible && this._overlays.activeOverlay === 'NONE';
  }

  /** @inheritdoc */
  get onboardingStepIndex(): number {
    return this._onboarding.stepIndex;
  }

  /** @inheritdoc */
  get onboardingTotalSteps(): number {
    return this._onboarding.totalSteps;
  }

  /**
   * C-527 AC-6 — whether motion is reduced.
   *
   * Derived from the shared motion service rather than cached, so changing the
   * Motion control in Settings is reflected by the game HUD immediately. A
   * cached copy would go stale the moment the player used the control, which is
   * exactly the "explicit choices work" clause of AC-6.
   */
  get reducedMotion(): boolean {
    return resolveReducedMotion({
      preference: this._motion.preference,
      osPrefersReduced: this._osPrefersReduced,
    });
  }

  /**
   * C-527 AC-6: the player's explicit motion choice, owned by the shared
   * motion-preference service so Settings and the game HUD cannot disagree.
   */
  get motionPreference(): MotionPreference {
    return this._motion.preference;
  }

  /** The OS-level preference; `$state` so an OS change re-derives the policy. */
  private _osPrefersReduced = $state<boolean>(false);

  /**
   * Returns whether a text AI provider is configured (C-422 AC-5).
   * Used to show a graceful message when a step requires a model.
   */
  private _hasTextProvider(): boolean {
    try {
      const resolved = this._config.getActiveTextProvider();
      if (LOCAL_TEXT_PROVIDERS.has(resolved.provider)) {
        return Boolean(this._runtimeConfig.getTextUrl());
      }
      return Boolean(resolved.endpoint || resolved.apiKey);
    } catch {
      return false;
    }
  }

  private _reducedMotionQuery: MediaQueryList | undefined;

  // ── Service-proxied state ──

  get activeOverlay(): GameOverlayType {
    return this._overlays.activeOverlay;
  }

  get overlayStack(): readonly OverlayStackEntry[] {
    return this._overlays.overlayStack;
  }

  get isTransitioning(): boolean {
    return this._overlays.isTransitioning;
  }

  /** Reads combat state from engine service (C-332 AC-5). */
  get isCombat(): boolean {
    return this._overlays.activeOverlay === 'COMBAT';
  }

  get autoSaveStatus(): AutoSaveStatus {
    return this._overlays.autoSaveStatus;
  }

  get gameHour(): number {
    return this._time.gameHour;
  }

  get gameMinute(): number {
    return this._time.gameMinute;
  }

  get windVelocity(): number {
    return this._time.windVelocity;
  }

  get rainIntensity(): number {
    return this._time.rainIntensity;
  }

  get chatLocked(): boolean {
    return this._session.chatLocked;
  }

  // ── Player HP (C-332 AC-1) ──

  get playerHp(): number {
    return this._playerState.playerHp;
  }

  get playerMaxHp(): number {
    return this._playerState.playerMaxHp;
  }

  get hpPercent(): number {
    return hpPercent(this.playerHp, this.playerMaxHp);
  }

  // ── HUD Visibility Rules (C-332 AC-1, AC-5) — policy in game_ui_hud_visibility.ts ──

  get showHpBar(): boolean {
    return showHpBar(this._overlays.activeOverlay);
  }

  get showQuestTracker(): boolean {
    return showQuestTracker(this._overlays.activeOverlay);
  }

  get questOverlayVisible(): boolean {
    return this._questOverlay.visible;
  }

  get showAutosaveIndicator(): boolean {
    return showAutosaveIndicator(this._overlays.activeOverlay);
  }

  get showClockHud(): boolean {
    return showClockHud(this._overlays.activeOverlay);
  }

  get showHotbar(): boolean {
    return showHotbar(this._overlays.activeOverlay);
  }

  get showManagementNav(): boolean {
    return showManagementNav(this._overlays.activeOverlay, this._overlays.isTransitioning);
  }

  // ── Management navigation (HUD → overlay router) ──

  /**
   * Last subview remembered per section, so returning to a section lands where
   * the player left it. Transient UI state only — never persisted to a save.
   */
  private readonly _rememberedSubviews = new Map<ManagementSectionId, string>();

  /**
   * Management sections whose ViewModel has been created for the current host
   * session. Deliberately NOT reactive: it is a creation guard, and a tracked
   * read here would re-run the lifecycle effect against itself.
   */
  private readonly _createdManagementOverlays = new Set<GameOverlayType>();

  /**
   * C-527 AC-2 — the captured origin of the current management session.
   * Exposed so the return is observable rather than implied.
   */
  returnContext = $state<ManagementReturnContext | undefined>(undefined);

  /**
   * The element that held focus when the host opened. Kept outside the reactive
   * return context because focus restoration runs after the context is cleared.
   */
  private _originFocus: HTMLElement | undefined;

  /** Whether the host was open on the previous lifecycle tick. */
  private _hostWasOpen = false;

  /** Last location the host opened — the HUD Menu entry resumes here. */
  menuLocation = $state<ManagementLocation>(DEFAULT_MENU_LOCATION);

  /**
   * The active management location, derived from the overlay stack. Because it
   * is derived, a deep-open shortcut (`QUEST_LOG`) and a host tab switch can
   * never disagree about which section is showing.
   */
  get managementLocation(): ManagementLocation | undefined {
    return managementLocationFromOverlay(this._overlays.activeOverlay);
  }

  get isManagementOpen(): boolean {
    return isManagementOverlay(this._overlays.activeOverlay);
  }

  /** @inheritdoc */
  openManagementSection(section: ManagementSectionId): void {
    this.openManagementLocation({ section });
  }

  /** @inheritdoc */
  openManagementLocation(location: ManagementLocation): void {
    const normalized = normalizeManagementLocation(location);
    if (!normalized) {
      this.debug('management:open:unknown-section', { section: location.section });
      return;
    }

    if (normalized.subview !== undefined) {
      this._rememberedSubviews.set(normalized.section, normalized.subview);
    }
    this.menuLocation = normalized;

    const destination = managementOverlayFor(normalized);
    if (!destination) {
      return;
    }

    // Directive 3: opening a section REPLACES a sibling management section
    // rather than stacking one overlay per visited tab. `replaceOverlay` also
    // keeps the original pre-host focus and never resumes the engine, so
    // switching tabs cannot leak a simulation frame (Directive 6).
    if (isManagementOverlay(this._overlays.activeOverlay)) {
      if (this._overlays.activeOverlay === destination) {
        return;
      }
      this._overlays.replaceOverlay(destination);
      return;
    }

    // C-527 AC-2: capture the origin before the host takes over.
    this._beginManagementSession();
    this._openOverlayDestination(destination);
  }

  /** @inheritdoc */
  openManagementMenu(): void {
    this.openManagementLocation(this.menuLocation);
  }

  /** @inheritdoc */
  closeManagement(): void {
    const context = this.returnContext;
    this._closeOverlayDestination(this._overlays.activeOverlay);
    this._restoreReturnContext(context);
  }

  /**
   * C-527 AC-2 — captures what the host must return the player to, before the
   * host pushes its first section.
   *
   * The origin overlay itself is preserved by the overlay stack (a push stacks
   * over it, and a sibling switch replaces only the management entry), so the
   * capture is about the parts the stack does NOT own: the scroll anchor of the
   * surface underneath, and the identity of an open conversation so its draft
   * stays attached to the same actor.
   */
  private _captureReturnContext(): void {
    const originOverlay = this._overlays.activeOverlay;
    const npcId = untrack(() => this._npcDialogue.activeNpc?.npcId);
    const scrollAnchor = this._readScrollAnchor();
    this._originFocus =
      typeof document === 'undefined'
        ? undefined
        : ((document.activeElement as HTMLElement | null) ?? undefined);

    this.returnContext = {
      originOverlay,
      ...(npcId === undefined ? {} : { npcId, draftId: `dialogue-draft:${npcId}` }),
      ...(scrollAnchor === undefined ? {} : { scrollAnchor }),
    };
  }

  /**
   * C-527 AC-3 — restores focus once the host has closed.
   *
   * The router remembers the pre-overlay focus element, but the HUD Menu entry
   * is conditionally mounted: while the host covers the screen that element is
   * DETACHED, so the router's restore finds nothing connected and focus falls
   * to `<body>`. This puts focus back on the origin element when it survived,
   * and otherwise on the replacement Menu entry — so the keyboard path resumes
   * exactly where it left off.
   */
  private _restoreHostFocus(): void {
    if (typeof document === 'undefined') {
      return;
    }
    if (this._originFocus?.isConnected) {
      this._originFocus.focus();
      return;
    }
    document.querySelector<HTMLElement>('[data-testid="hud-menu-entry"]')?.focus();
  }

  /**
   * Restores the captured origin after the host closes. Focus and the overlay
   * stack are restored by the router itself; this returns the scroll anchor the
   * player left behind. Guarded so a non-DOM environment is a no-op.
   */
  private _restoreReturnContext(context: ManagementReturnContext | undefined): void {
    if (!context || context.scrollAnchor === undefined) {
      this.returnContext = undefined;
      return;
    }
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: context.scrollAnchor, behavior: 'instant' });
    }
    this.returnContext = undefined;
  }

  /** Scroll anchor of the originating surface, or undefined without a DOM. */
  private _readScrollAnchor(): number | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const anchor = window.scrollY ?? 0;
    return anchor === 0 ? undefined : anchor;
  }

  /** Advises the host that a management session is about to start. */
  private _beginManagementSession(): void {
    if (this.returnContext === undefined) {
      this._captureReturnContext();
    }
  }

  /**
   * Opens a management destination through its existing deep-open entry point.
   * The old entry-point methods stay authoritative (Migration & Rollback): this
   * host is an adapter onto them, not a competing router.
   */
  private _openOverlayDestination(destination: GameOverlayType): void {
    switch (destination) {
      case 'INVENTORY':
        this._overlays.openInventory();
        return;
      case 'QUEST_LOG':
        this._overlays.openQuestLog();
        return;
      case 'JOURNAL':
        this._overlays.openJournal();
        return;
      case 'CHARACTER_DASHBOARD':
        this._overlays.openCharacterDashboard();
        return;
      case 'PARTY_ROSTER':
        this._overlays.openPartyRoster();
        return;
      case 'REPUTATION':
        this._overlays.openReputation();
        return;
      case 'WORLD':
        this._overlays.openWorld();
        return;
      default:
        return;
    }
  }

  /** Closes a management destination through its owning close method. */
  private _closeOverlayDestination(destination: GameOverlayType): void {
    switch (destination) {
      case 'INVENTORY':
        this._overlays.closeInventory();
        return;
      case 'QUEST_LOG':
        this._overlays.closeQuestLog();
        return;
      case 'JOURNAL':
        this._overlays.closeJournal();
        return;
      case 'CHARACTER_DASHBOARD':
        this._overlays.closeCharacterDashboard();
        return;
      case 'PARTY_ROSTER':
        this._overlays.closePartyRoster();
        return;
      case 'REPUTATION':
        this._overlays.closeReputation();
        return;
      case 'WORLD':
        this._overlays.closeWorld();
        return;
      default:
        return;
    }
  }

  /**
   * Creates the ViewModel for a NON-management "simple" overlay and returns its
   * cleanup. Management sections are deliberately absent here — they are owned
   * by {@link _ensureManagementSectionViewModel} so a section keeps its own
   * state across sibling switches (C-527 AC-2).
   */
  private _simpleOverlayCleanup(overlay: GameOverlayType): (() => void) | undefined {
    if (overlay === 'END_SESSION') {
      this.endSessionViewModel = this._createEndSessionViewModel({
        className: 'EndSessionViewModel',
      });
      return () => {
        this.endSessionViewModel = undefined;
      };
    }
    if (overlay === 'SETTINGS') {
      this.settingsOverlayViewModel = this._createSettingsOverlayViewModel({
        className: 'SettingsOverlayViewModel',
      });
      return () => {
        this.settingsOverlayViewModel = undefined;
      };
    }
    return undefined;
  }

  /**
   * C-527 AC-2 — one ViewModel per management section, created once and kept
   * alive for the whole host session.
   *
   * Creating the ViewModel on activation and destroying it on the next
   * activation (the pre-C-527 behaviour) meant every sibling switch threw away
   * the section's own state — scroll position, item selection, the active tab,
   * an in-progress note. Creating each section once per session and leaving it
   * mounted preserves that state; the sections that are not on screen simply
   * are not rendered.
   *
   * Idempotent by construction: guarded by a plain (non-reactive) set, so
   * re-entering a section is a no-op and cannot reset it.
   */
  private _ensureManagementSectionViewModel(overlay: GameOverlayType): void {
    if (this._createdManagementOverlays.has(overlay)) {
      return;
    }
    this._createdManagementOverlays.add(overlay);

    switch (overlay) {
      case 'INVENTORY':
        this.inventoryViewModel = this._createInventoryViewModel({
          className: 'InventoryViewModel',
        });
        return;
      case 'QUEST_LOG':
        this.questViewModel = this._createQuestViewModel({ className: 'QuestViewModel' });
        return;
      case 'JOURNAL': {
        const vm = this._createJournalViewModel({ className: 'JournalViewModel' });
        this.journalViewModel = vm;
        // C-527: restore the subview the player last used in this section.
        const subview = this._rememberedSubviews.get('journal');
        const tab = subview === undefined ? undefined : JOURNAL_TAB_BY_SUBVIEW[subview];
        if (tab !== undefined) {
          untrack(() => vm.setActiveTab(tab));
        }
        return;
      }
      case 'CHARACTER_DASHBOARD':
        this.dashboardViewModel = this._createCharacterSheetViewModel({
          className: 'CharacterSheetViewModel',
          onClose: () => this._overlays.closeCharacterDashboard(),
        });
        return;
      case 'PARTY_ROSTER':
        this.partyRosterViewModel = this._createPartyRosterViewModel({
          className: 'PartyRosterViewModel',
        });
        return;
      case 'REPUTATION':
        this.reputationViewModel = this._createReputationViewModel({
          className: 'ReputationViewModel',
        });
        return;
      case 'WORLD': {
        const vm = this._createWorldViewModel({ className: 'WorldViewModel' });
        this.worldViewModel = vm;
        // C-527: the World section's canonical subview is 'codex', which is the
        // section's name for the view — it is NOT one of the view's own tabs.
        const subview = this._rememberedSubviews.get('world');
        const tab = subview === undefined ? undefined : WORLD_TAB_BY_SUBVIEW[subview];
        if (tab !== undefined) {
          untrack(() => vm.setActiveTab(tab));
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Ends the management session: releases every section ViewModel and the
   * kept-alive bookkeeping, so the next open starts from a clean session.
   */
  private _disposeManagementSectionViewModels(): void {
    this.inventoryViewModel = undefined;
    this.questViewModel = undefined;
    this.journalViewModel = undefined;
    this.dashboardViewModel = undefined;
    this.partyRosterViewModel = undefined;
    this.reputationViewModel = undefined;
    this.worldViewModel = undefined;
    this._createdManagementOverlays.clear();
  }

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    this._overlays.setEngineService(this._engine);

    // React to overlay state changes — create/destroy sub-ViewModels
    this.registerEffectRoot(() => {
      // ── Dialogue ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'DIALOGUE') {
          return;
        }
        const npc = this._npcDialogue.activeNpc;
        if (!npc) {
          return;
        }
        const vm = this._createDialogueOverlayViewModel({
          className: 'DialogueOverlayViewModel',
          npcData: npc,
          onEndChat: () => this._overlays.endDialogue(),
          npcDialogueService: this._npcDialogue,
          onStartCombat: (combatNpcData) => {
            this._overlays.startCombat({
              enemyName: combatNpcData.npcName,
              enemyNpcId: combatNpcData.npcId,
            });
          },
        });
        this.dialogueViewModel = vm;

        return () => {
          vm.hasNpcScreenPosition = false;
          this.dialogueViewModel = undefined;
        };
      });

      // ── Combat ──
      //
      // Lifecycle owner for the combat overlay: ONE ViewModel per overlay
      // activation. The combat service's live state is read UNTRACKED on
      // purpose — `COMBAT_STARTED`/`TURN_CHANGED` mutate it, and a tracked read
      // would tear this ViewModel down and build a fresh one the moment the
      // engine answered, discarding the turn/budget events it had just
      // received (no turn tracker, no budget dots, no End Turn). The ViewModel
      // is event-driven: it seeds from whatever the service knows at open time
      // and updates itself from the bridge for everything after.
      $effect(() => {
        if (this._overlays.activeOverlay !== 'COMBAT') {
          return;
        }
        const vm = this._createCombatViewModel({
          className: 'CombatViewModel',
          onDismissOverlay: () => this._overlays.closeCombat(),
        }) as CombatViewModel;
        const seed = untrack(() => {
          const cs = this._combat;
          return {
            enemyName: cs.enemyName,
            enemyNpcId: cs.enemyNpcId,
            enemyHp: cs.enemyHp,
            enemyMaxHp: cs.enemyMaxHp,
            participantIds: [...cs.participantIds],
            firstTurnEntityId: cs.firstTurnEntityId,
          };
        });
        void vm.initialize();
        vm.enemyName = seed.enemyName || 'Enemy';
        vm.enemyNpcId = seed.enemyNpcId;
        vm.enemyHp = seed.enemyHp;
        vm.enemyMaxHp = seed.enemyMaxHp;
        vm.activeEntities = seed.participantIds;
        vm.currentTurnEntity = seed.firstTurnEntityId;
        vm.totalParticipants = seed.participantIds.length;
        vm.isPlayerTurn = true;
        this.combatViewModel = vm;

        return () => {
          void vm.dispose();
          this.combatViewModel = undefined;
        };
      });

      // ── Non-management simple overlays (End Session, Settings) — one
      //    lifecycle owner per active overlay, created and cleared centrally. ──
      $effect(() => this._simpleOverlayCleanup(this._overlays.activeOverlay));

      // ── Management host session (C-527 AC-2) ──
      //
      // One session per host open. While the session is live, each visited
      // section's ViewModel is created ONCE and kept alive, so switching a
      // sibling section preserves that section's own state. The session ends —
      // and every section ViewModel is released — when the active overlay stops
      // being a management destination (including a "Back to game" close).
      $effect(() => {
        const overlay = this._overlays.activeOverlay;
        if (!isManagementOverlay(overlay)) {
          return;
        }
        if (this.returnContext === undefined) {
          this._captureReturnContext();
        }
        this._ensureManagementSectionViewModel(overlay);

        return () => {
          // Only tear down when the host really ended — a sibling switch also
          // runs this cleanup, and the overlay that replaced it is still a
          // management destination.
          if (isManagementOverlay(this._overlays.activeOverlay)) {
            return;
          }
          this._disposeManagementSectionViewModels();
          this.returnContext = undefined;
        };
      });

      // ── Focus restoration after the host closes (C-527 AC-3) ──
      //
      // Runs as an effect (rather than in the cleanup above) so it happens
      // AFTER the DOM has re-rendered and the HUD Menu entry is mounted again.
      $effect(() => {
        const open = this.isManagementOpen;
        if (open) {
          this._hostWasOpen = true;
          return;
        }
        if (!this._hostWasOpen) {
          return;
        }
        this._hostWasOpen = false;
        untrack(() => {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => this._restoreHostFocus());
          } else {
            this._restoreHostFocus();
          }
        });
      });

      // ── Vendor ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'VENDOR') {
          return;
        }
        const opts = this._overlays.vendorSessionOptions;
        if (!opts) {
          return;
        }
        const vm = this._createVendorViewModel({
          className: 'VendorViewModel',
          vendorId: opts.vendorId,
          vendorName: opts.vendorName,
          vendorInventory: opts.vendorInventory,
        });
        this.vendorViewModel = vm;

        return () => {
          void vm.dispose();
          this.vendorViewModel = undefined;
        };
      });

      // ── Talk to Party (C-340) ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'TALK_TO_PARTY') {
          return;
        }
        // Talk to Party is opened with companion context from party roster
        // For now, open default — the router will populate context from the
        // last companion talked to
        const vm = this._createTalkToPartyViewModel({
          className: 'TalkToPartyViewModel',
          npcId: '', // populated by the party roster button
          npcName: 'Companion',
          npcDialogueService: this._npcDialogue,
        });
        this.talkToPartyViewModel = vm;

        return () => {
          this.talkToPartyViewModel = undefined;
        };
      });

      // Camera zoom forwarding (for dialogue spatial UI)
      $effect(() => {
        const x = this._overlays._cameraZoomNpcScreenX;
        const y = this._overlays._cameraZoomNpcScreenY;
        if (!this.dialogueViewModel) {
          return;
        }
        if (x !== undefined) {
          this.dialogueViewModel.npcScreenX = x;
          this.dialogueViewModel.npcScreenY = y ?? 0;
          this.dialogueViewModel.hasNpcScreenPosition = true;
        } else {
          this.dialogueViewModel.hasNpcScreenPosition = false;
        }
      });
    });

    // Create static overlay VMs (pause menu and game over are always ready)
    this.pauseMenuViewModel = this._createPauseMenuViewModel({ className: 'PauseMenuViewModel' });
    this.gameOverViewModel = this._createGameOverViewModel({ className: 'GameOverViewModel' });

    // Auto-summary threshold check (C-240)
    this.registerEffectRoot(() => {
      $effect(() => {
        void this._chat.messages.length;
        this._session.checkAutoSummaryThreshold();
      });
    });

    // Detect prefers-reduced-motion (C-327 AC-5)
    this._reducedMotionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (this._reducedMotionQuery) {
      this._osPrefersReduced = this._reducedMotionQuery.matches;
      this._reducedMotionQuery.addEventListener('change', this._onReducedMotionChange);
    }

    await this._overlays.initialize();
    await super.initialize();
  }

  // ── Delegated ──

  handleKeyDown(event: KeyboardEvent): void {
    this._overlays.handleKeyDown(event);
  }

  /** @inheritdoc */
  handleQuestLogDialogKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      // Every other key (Q, Escape, ...) is handled once by the window-level
      // handleKeyDown as this event bubbles up — dispatching it again here
      // would double-fire (e.g. Q closing the log, then immediately
      // reopening it on the bubbled call).
      return;
    }
    event.preventDefault();
    const dialog = event.currentTarget as HTMLElement;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"]), [href]',
    );
    if (focusable.length === 0) {
      return;
    }
    const currentIndex = Array.from(focusable).indexOf(document.activeElement as HTMLElement);
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = (currentIndex + direction + focusable.length) % focusable.length;
    focusable[nextIndex]?.focus();
  }

  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this._overlays.closeQuestLog();
    }
  }

  resumeGame(): void {
    this._overlays.resumeGame();
  }

  endDialogue(): void {
    this._overlays.endDialogue();
  }

  async saveGame(): Promise<void> {
    await this._overlays.saveGame();
  }

  async respawnPlayer(): Promise<void> {
    await this._overlays.respawnPlayer();
  }

  async loadLastSave(): Promise<void> {
    await this._overlays.loadLastSave();
  }

  /** Dismisses the current onboarding hint (C-327 AC-3). */
  dismissOnboardingHint(): void {
    this._onboarding.dismissCurrentHint();
  }

  /** Skips the entire onboarding arc (C-422 AC-3). */
  skipOnboardingHint(): void {
    this._onboarding.skipOnboarding();
  }

  // ── Media query cleanup (C-327 AC-5) ──

  private readonly _onReducedMotionChange = (event: MediaQueryListEvent): void => {
    this._osPrefersReduced = event.matches;
  };

  /** @inheritdoc */
  setMotionPreference(preference: MotionPreference): void {
    // The service owns persistence; `reducedMotion` re-derives from it.
    this._motion.setPreference(preference);
  }

  /** @inheritdoc */
  get motionAttribute(): 'reduced' | 'full' {
    return motionAttributeValue(this.reducedMotion);
  }

  async dispose(): Promise<void> {
    if (this._reducedMotionQuery) {
      this._reducedMotionQuery.removeEventListener('change', this._onReducedMotionChange);
    }
    await super.dispose();
  }
}

/**
 * Builds a game-UI ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getGameUIViewModel` in ./game_ui_composition.ts.
 */
export const createGameUIViewModel = (options: GameUIViewModelOptions): GameUIViewModelInterface =>
  GameUIViewModel.create(options);
