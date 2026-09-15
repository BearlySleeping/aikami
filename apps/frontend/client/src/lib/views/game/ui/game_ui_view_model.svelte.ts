// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { GameEngineServiceInterface, NpcDialogueServiceInterface } from '$services';
import type { AutoSaveStatus, DialogueNpcData, GameOverlayType, OverlayStackEntry } from '$types';
import { type MotionPreference, motionAttributeValue, resolveReducedMotion } from '$types';
import type { getCombatViewModel } from '$views/combat/combat_composition.ts';
import type { CombatViewModelInterface } from '$views/combat/combat_view_model.svelte';
import type { getCharacterSheetViewModel } from '$views/game/dashboard/character_sheet_composition.ts';
import type { getHudLayoutEditorViewModel } from '$views/game/ui/hud/hud_layout_editor_composition.ts';
import type { HudLayoutEditorViewModelInterface } from '$views/game/ui/hud/hud_layout_editor_view_model.svelte';
import type { getDialogueOverlayViewModel } from '$views/game/ui/overlays/dialogue/dialogue_overlay_composition.ts';
import type { DialogueOverlayViewModelInterface } from '$views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte';
import type { getEndSessionViewModel } from '$views/game/ui/overlays/end_session/end_session_composition.ts';
import type { EndSessionViewModelInterface } from '$views/game/ui/overlays/end_session/end_session_view_model.svelte';
import type { getGameOverViewModel } from '$views/game/ui/overlays/game_over/game_over_composition.ts';
import type { GameOverViewModelInterface } from '$views/game/ui/overlays/game_over/game_over_view_model.svelte';
import type { getPartyRosterViewModel } from '$views/game/ui/overlays/party_roster/party_roster_composition.ts';
import type { getPauseMenuViewModel } from '$views/game/ui/overlays/pause_menu/pause_menu_composition.ts';
import type { PauseMenuViewModelInterface } from '$views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte';
import type { getReputationViewModel } from '$views/game/ui/overlays/reputation/reputation_composition.ts';
import type { getSettingsOverlayViewModel } from '$views/game/ui/overlays/settings/settings_overlay_composition.ts';
import type { SettingsOverlayViewModelInterface } from '$views/game/ui/overlays/settings/settings_overlay_view_model.svelte';
import type { getTalkToPartyViewModel } from '$views/game/ui/overlays/talk_to_party/talk_to_party_composition.ts';
import type { TalkToPartyViewModelInterface } from '$views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte';
import type { getQuestTrackerViewModel } from '$views/game/ui/quest_tracker_composition.ts';
import type { QuestTrackerViewModelInterface } from '$views/game/ui/quest_tracker_view_model.svelte';
import type { getInventoryViewModel } from '$views/inventory/inventory_composition.ts';
import type { getJournalViewModel } from '$views/journal/journal_composition.ts';
import type { getQuestViewModel } from '$views/quest/quest_composition.ts';
import type { getVendorViewModel } from '$views/vendor/vendor_composition.ts';
import type { VendorViewModelInterface } from '$views/vendor/vendor_view_model.svelte';
import type { getWorldViewModel } from '$views/world/world_composition.ts';
import { createGameHudView, type GameHudViewInterface } from './game_hud_surface.svelte.ts';
import {
  hpPercent,
  showAutosaveIndicator,
  showClockHud,
  showHotbar,
  showHpBar,
  showManagementNav,
  showQuestTracker,
} from './game_ui_hud_visibility.ts';
import { registerGameUIOverlayLifecycle } from './game_ui_overlay_lifecycle.svelte.ts';
import type {
  GameUIChatCapabilities,
  GameUIClockCapabilities,
  GameUICombatStateCapabilities,
  GameUIConfigCapabilities,
  GameUIHudCapabilities,
  GameUIHudViewCapabilities,
  GameUIInputActionCapabilities,
  GameUIMotionCapabilities,
  GameUIOnboardingCapabilities,
  GameUIOverlayCapabilities,
  GameUIPlayerStateCapabilities,
  GameUIQuestOverlayCapabilities,
  GameUIRuntimeConfigCapabilities,
  GameUISessionCapabilities,
  GameUITimeCapabilities,
} from './game_ui_view_model_types.ts';
import type { ManagementLocation, ManagementSectionId } from './management_sections.ts';
import {
  createGameManagementSession,
  type GameManagementSessionInterface,
  type ManagementReturnContext,
} from './management_session.svelte.ts';

const LOCAL_TEXT_PROVIDERS = new Set(['ollama', 'llamacpp', 'ooba']);

// Re-export for sub-ViewModels
export type { AutoSaveStatus, DialogueNpcData, GameOverlayType, ManagementReturnContext };

/**
 * C-527 AC-2 — the captured origin of a management session.
 *
 * Directive 3: the host must be able to return the player to exactly where they
 * came from. The overlay stack already preserves the originating overlay and its
 * focus element; this type carries the parts the stack does not own.
 */
// GameUIViewModel — overlay router for the game UI layer. Creates and manages
// the overlay sub-ViewModels; the View reads activeOverlay to pick which one to
// render, and `hud` for the resolved HUD presentation.

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
  /** C-527 AC-1: the persisted clock visibility preference. */
  clock: GameUIClockCapabilities;
  /** Session state read for chat locking and auto-summary. */
  session: GameUISessionCapabilities;
  /** Game-time reads for the clock and weather HUD. */
  time: GameUITimeCapabilities;
  /** C-527 AC-6: the player's persisted motion selection. */
  motion: GameUIMotionCapabilities;
  /** C-528: the HUD preference authority (read-only in this layer). */
  hud: GameUIHudCapabilities;
  /** C-528: measured viewport and text scale for HUD reflow. */
  hudView: GameUIHudViewCapabilities;
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
  createHudEditorViewModel: typeof getHudLayoutEditorViewModel;
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

  // ── HUD layout (C-528) — the resolved surface the HUD markup reads. ──
  readonly hud: GameHudViewInterface;
  /** C-528: the paused HUD layout editor ViewModel, when open. */
  readonly hudEditorViewModel: HudLayoutEditorViewModelInterface | undefined;

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
  readonly combatViewModel: CombatViewModelInterface | undefined;
  readonly vendorViewModel: VendorViewModelInterface | undefined;
  readonly endSessionViewModel: EndSessionViewModelInterface | undefined;
  readonly gameOverViewModel: GameOverViewModelInterface | undefined;
  readonly settingsOverlayViewModel: SettingsOverlayViewModelInterface | undefined;

  /**
   * C-527: the management host session — the section ViewModels, the section
   * registry navigation and the captured return context. See
   * `management_session.svelte.ts`.
   */
  readonly management: GameManagementSessionInterface;

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
  private readonly _clock: GameUIClockCapabilities;
  private readonly _session: GameUISessionCapabilities;
  private readonly _time: GameUITimeCapabilities;
  private readonly _motion: GameUIMotionCapabilities;
  private readonly _engine: GameEngineServiceInterface;

  private readonly _createCombatViewModel: typeof getCombatViewModel;
  private readonly _createDialogueOverlayViewModel: typeof getDialogueOverlayViewModel;
  private readonly _createVendorViewModel: typeof getVendorViewModel;
  private readonly _createEndSessionViewModel: typeof getEndSessionViewModel;
  private readonly _createGameOverViewModel: typeof getGameOverViewModel;
  private readonly _createPauseMenuViewModel: typeof getPauseMenuViewModel;
  private readonly _createSettingsOverlayViewModel: typeof getSettingsOverlayViewModel;
  private readonly _createHudEditorViewModel: typeof getHudLayoutEditorViewModel;
  private readonly _createTalkToPartyViewModel: typeof getTalkToPartyViewModel;

  // ── Overlay ViewModels ──

  pauseMenuViewModel = $state<PauseMenuViewModelInterface | undefined>(undefined);
  dialogueViewModel = $state<DialogueOverlayViewModelInterface | undefined>(undefined);
  combatViewModel = $state<CombatViewModelInterface | undefined>(undefined);
  vendorViewModel = $state<VendorViewModelInterface | undefined>(undefined);
  endSessionViewModel = $state<EndSessionViewModelInterface | undefined>(undefined);
  gameOverViewModel = $state<GameOverViewModelInterface | undefined>(undefined);
  settingsOverlayViewModel = $state<SettingsOverlayViewModelInterface | undefined>(undefined);
  hudEditorViewModel = $state<HudLayoutEditorViewModelInterface | undefined>(undefined);

  /**
   * C-527: the management host session owns the section ViewModels and the
   * section registry navigation. Created eagerly — it holds no resources until
   * a section is opened.
   */
  readonly management: GameManagementSessionInterface;

  // ── Talk to Party (C-340) ──
  talkToPartyViewModel = $state<TalkToPartyViewModelInterface | undefined>(undefined);

  /** Quest tracker ViewModel (C-332 AC-1) — created eagerly, filters only when visible. */
  readonly questTrackerViewModel: QuestTrackerViewModelInterface;

  /** C-528: the HUD presentation surface (resolved layout, overflow, focus). */
  readonly hud: GameHudViewInterface;

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
    this._clock = options.clock;
    this._session = options.session;
    this._time = options.time;
    this._motion = options.motion;
    this._engine = options.engine;

    this._createCombatViewModel = options.createCombatViewModel;
    this._createDialogueOverlayViewModel = options.createDialogueOverlayViewModel;
    this._createVendorViewModel = options.createVendorViewModel;
    this._createEndSessionViewModel = options.createEndSessionViewModel;
    this._createGameOverViewModel = options.createGameOverViewModel;
    this._createPauseMenuViewModel = options.createPauseMenuViewModel;
    this._createSettingsOverlayViewModel = options.createSettingsOverlayViewModel;
    this._createHudEditorViewModel = options.createHudEditorViewModel;
    this._createTalkToPartyViewModel = options.createTalkToPartyViewModel;

    this.management = createGameManagementSession({
      className: 'GameManagementSession',
      overlays: this._overlays,
      npcDialogue: this._npcDialogue,
      createInventoryViewModel: options.createInventoryViewModel,
      createQuestViewModel: options.createQuestViewModel,
      createJournalViewModel: options.createJournalViewModel,
      createCharacterSheetViewModel: options.createCharacterSheetViewModel,
      createPartyRosterViewModel: options.createPartyRosterViewModel,
      createReputationViewModel: options.createReputationViewModel,
      createWorldViewModel: options.createWorldViewModel,
    });

    this.questTrackerViewModel = options.createQuestTrackerViewModel({
      className: 'QuestTrackerViewModel',
    });

    this.hud = createGameHudView({
      hud: options.hud,
      hudView: options.hudView,
      readContext: () => ({
        activeOverlay: this._overlays.activeOverlay,
        isTransitioning: this._overlays.isTransitioning,
        autoSaveStatus: this._overlays.autoSaveStatus,
        interactionPromptVisible: this.interactionPromptVisible,
        hasObjective: this.questTrackerViewModel.hasQuests,
        hasOnboardingHint: this.onboardingHintVisible,
      }),
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
    // C-527 AC-1 — off for a new player; an explicit stored preference wins.
    return this._clock.visible && showClockHud(this._overlays.activeOverlay);
  }

  get showHotbar(): boolean {
    return showHotbar(this._overlays.activeOverlay);
  }

  get showManagementNav(): boolean {
    return showManagementNav(this._overlays.activeOverlay, this._overlays.isTransitioning);
  }

  // ── Management navigation (HUD → overlay router) ──
  //
  // The host session itself (which section is showing, which sections are
  // alive, the captured return context, focus restoration) lives in
  // `management_session.svelte.ts` — that is its own responsibility, and this
  // ViewModel stays the overlay router. These members are thin delegations so
  // the View keeps one `viewModel` handle.

  /** @inheritdoc */
  get managementLocation(): ManagementLocation | undefined {
    return this.management.location;
  }

  /** @inheritdoc */
  get isManagementOpen(): boolean {
    return this.management.isOpen;
  }

  /** @inheritdoc */
  get menuLocation(): ManagementLocation {
    return this.management.menuLocation;
  }

  /** @inheritdoc */
  get returnContext(): ManagementReturnContext | undefined {
    return this.management.returnContext;
  }

  /** @inheritdoc */
  openManagementSection(section: ManagementSectionId): void {
    this.management.openSection(section);
  }

  /** @inheritdoc */
  openManagementLocation(location: ManagementLocation): void {
    this.management.openLocation(location);
  }

  /** @inheritdoc */
  openManagementMenu(): void {
    this.management.openMenu();
  }

  /** @inheritdoc */
  closeManagement(): void {
    this.management.close();
  }

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    this._overlays.setEngineService(this._engine);

    // The overlay → ViewModel lifecycle graph (dialogue, combat, vendor,
    // talk-to-party, end-session/settings, the management host session and its
    // focus restoration, camera-zoom forwarding, auto-summary). Extracted to
    // its own module to respect this file's reviewed size ceiling.
    registerGameUIOverlayLifecycle({
      registerEffectRoot: (fn) => this.registerEffectRoot(fn),
      overlays: this._overlays,
      npcDialogue: this._npcDialogue,
      combat: this._combat,
      chat: this._chat,
      session: this._session,
      management: this.management,
      createDialogueOverlayViewModel: this._createDialogueOverlayViewModel,
      createCombatViewModel: this._createCombatViewModel,
      createVendorViewModel: this._createVendorViewModel,
      createTalkToPartyViewModel: this._createTalkToPartyViewModel,
      createEndSessionViewModel: this._createEndSessionViewModel,
      createSettingsOverlayViewModel: this._createSettingsOverlayViewModel,
      createHudEditorViewModel: this._createHudEditorViewModel,
      setDialogueViewModel: (vm) => {
        this.dialogueViewModel = vm;
      },
      setCombatViewModel: (vm) => {
        this.combatViewModel = vm;
      },
      setVendorViewModel: (vm) => {
        this.vendorViewModel = vm;
      },
      setTalkToPartyViewModel: (vm) => {
        this.talkToPartyViewModel = vm;
      },
      setEndSessionViewModel: (vm) => {
        this.endSessionViewModel = vm;
      },
      setSettingsOverlayViewModel: (vm) => {
        this.settingsOverlayViewModel = vm;
      },
      setHudEditorViewModel: (vm) => {
        this.hudEditorViewModel = vm;
      },
      getDialogueViewModel: () => this.dialogueViewModel,
    });

    // Create static overlay VMs (pause menu and game over are always ready)
    this.pauseMenuViewModel = this._createPauseMenuViewModel({ className: 'PauseMenuViewModel' });
    this.gameOverViewModel = this._createGameOverViewModel({ className: 'GameOverViewModel' });

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
