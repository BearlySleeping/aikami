// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type {
  ChatServiceInterface,
  CombatServiceInterface,
  ConfigServiceInterface,
  GameEngineServiceInterface,
  GameOverlayServiceInterface,
  InputActionServiceInterface,
  NpcDialogueServiceInterface,
  OnboardingHintServiceInterface,
  PlayerStateServiceInterface,
  QuestOverlayServiceInterface,
  RuntimeConfigServiceInterface,
  SessionServiceInterface,
  TimeServiceInterface,
} from '$services';
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
import type { getQuestViewModel } from '$views/quest/quest_composition.ts';
import type { QuestViewModelInterface } from '$views/quest/quest_view_model.svelte.ts';
import type { getVendorViewModel } from '$views/vendor/vendor_composition.ts';
import type { VendorViewModelInterface } from '$views/vendor/vendor_view_model.svelte';

const LOCAL_TEXT_PROVIDERS = new Set(['ollama', 'llamacpp', 'ooba']);

// Re-export for sub-ViewModels
export type { AutoSaveStatus, DialogueNpcData, GameOverlayType };

// ── Capability contracts ────────────────────────────────────────────────

export type GameUIChatCapabilities = Pick<ChatServiceInterface, 'messages'>;

export type GameUICombatStateCapabilities = Pick<
  CombatServiceInterface,
  'enemyName' | 'enemyNpcId' | 'enemyHp' | 'enemyMaxHp' | 'participantIds' | 'firstTurnEntityId'
>;

export type GameUIConfigCapabilities = Pick<ConfigServiceInterface, 'getActiveTextProvider'>;

export type GameUIRuntimeConfigCapabilities = Pick<RuntimeConfigServiceInterface, 'getTextUrl'>;

export type GameUIOverlayCapabilities = Pick<
  GameOverlayServiceInterface,
  | 'activeOverlay'
  | 'overlayStack'
  | 'isTransitioning'
  | 'autoSaveStatus'
  | 'vendorSessionOptions'
  | '_cameraZoomNpcScreenX'
  | '_cameraZoomNpcScreenY'
  | 'interactionPromptLabel'
  | 'interactionPromptVisible'
  | 'setEngineService'
  | 'initialize'
  | 'handleKeyDown'
  | 'endDialogue'
  | 'resumeGame'
  | 'saveGame'
  | 'respawnPlayer'
  | 'loadLastSave'
  | 'startCombat'
  | 'closeCombat'
  | 'closeQuestLog'
  | 'closeCharacterDashboard'
>;

export type GameUIInputActionCapabilities = Pick<InputActionServiceInterface, 'actionDisplayLabel'>;

export type GameUIOnboardingCapabilities = Pick<
  OnboardingHintServiceInterface,
  | 'currentHint'
  | 'hintVisible'
  | 'stepIndex'
  | 'totalSteps'
  | 'dismissCurrentHint'
  | 'skipOnboarding'
>;

export type GameUIPlayerStateCapabilities = Pick<
  PlayerStateServiceInterface,
  'playerHp' | 'playerMaxHp'
>;

export type GameUIQuestOverlayCapabilities = Pick<QuestOverlayServiceInterface, 'visible'>;

export type GameUISessionCapabilities = Pick<
  SessionServiceInterface,
  'chatLocked' | 'checkAutoSummaryThreshold'
>;

export type GameUITimeCapabilities = Pick<
  TimeServiceInterface,
  'gameHour' | 'gameMinute' | 'windVelocity' | 'rainIntensity'
>;

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
  /** Engine service registered with the overlay router. */
  engine: GameEngineServiceInterface;

  // ── Sub-ViewModel factories (production wiring lives in the composition) ──

  createCombatViewModel: typeof getCombatViewModel;
  createDialogueOverlayViewModel: typeof getDialogueOverlayViewModel;
  createInventoryViewModel: typeof getInventoryViewModel;
  createQuestViewModel: typeof getQuestViewModel;
  createCharacterSheetViewModel: typeof getCharacterSheetViewModel;
  createVendorViewModel: typeof getVendorViewModel;
  createEndSessionViewModel: typeof getEndSessionViewModel;
  createGameOverViewModel: typeof getGameOverViewModel;
  createPauseMenuViewModel: typeof getPauseMenuViewModel;
  createSettingsOverlayViewModel: typeof getSettingsOverlayViewModel;
  createPartyRosterViewModel: typeof getPartyRosterViewModel;
  createReputationViewModel: typeof getReputationViewModel;
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

  // ── Overlay ViewModels (created on demand by initialize) ──

  readonly pauseMenuViewModel: PauseMenuViewModelInterface | undefined;
  readonly dialogueViewModel: DialogueOverlayViewModelInterface | undefined;
  readonly inventoryViewModel: InventoryViewModelInterface | undefined;
  readonly questViewModel: QuestViewModelInterface | undefined;
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
  private readonly _engine: GameEngineServiceInterface;

  private readonly _createCombatViewModel: typeof getCombatViewModel;
  private readonly _createDialogueOverlayViewModel: typeof getDialogueOverlayViewModel;
  private readonly _createInventoryViewModel: typeof getInventoryViewModel;
  private readonly _createQuestViewModel: typeof getQuestViewModel;
  private readonly _createCharacterSheetViewModel: typeof getCharacterSheetViewModel;
  private readonly _createVendorViewModel: typeof getVendorViewModel;
  private readonly _createEndSessionViewModel: typeof getEndSessionViewModel;
  private readonly _createGameOverViewModel: typeof getGameOverViewModel;
  private readonly _createPauseMenuViewModel: typeof getPauseMenuViewModel;
  private readonly _createSettingsOverlayViewModel: typeof getSettingsOverlayViewModel;
  private readonly _createPartyRosterViewModel: typeof getPartyRosterViewModel;
  private readonly _createReputationViewModel: typeof getReputationViewModel;
  private readonly _createTalkToPartyViewModel: typeof getTalkToPartyViewModel;

  // ── Overlay ViewModels ──

  pauseMenuViewModel = $state<PauseMenuViewModelInterface | undefined>(undefined);
  dialogueViewModel = $state<DialogueOverlayViewModelInterface | undefined>(undefined);
  inventoryViewModel = $state<InventoryViewModelInterface | undefined>(undefined);
  questViewModel = $state<QuestViewModelInterface | undefined>(undefined);
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
    this._engine = options.engine;

    this._createCombatViewModel = options.createCombatViewModel;
    this._createDialogueOverlayViewModel = options.createDialogueOverlayViewModel;
    this._createInventoryViewModel = options.createInventoryViewModel;
    this._createQuestViewModel = options.createQuestViewModel;
    this._createCharacterSheetViewModel = options.createCharacterSheetViewModel;
    this._createVendorViewModel = options.createVendorViewModel;
    this._createEndSessionViewModel = options.createEndSessionViewModel;
    this._createGameOverViewModel = options.createGameOverViewModel;
    this._createPauseMenuViewModel = options.createPauseMenuViewModel;
    this._createSettingsOverlayViewModel = options.createSettingsOverlayViewModel;
    this._createPartyRosterViewModel = options.createPartyRosterViewModel;
    this._createReputationViewModel = options.createReputationViewModel;
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

  /** Detects prefers-reduced-motion via matchMedia (C-327 AC-5). */
  reducedMotion = $state<boolean>(false);

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

  get showClockHud(): boolean {
    const overlay = this._overlays.activeOverlay;
    return overlay !== 'PAUSE_MENU' && overlay !== 'GAME_OVER' && overlay !== 'END_SESSION';
  }

  // ── Player HP (C-332 AC-1) ──

  get playerHp(): number {
    return this._playerState.playerHp;
  }

  get playerMaxHp(): number {
    return this._playerState.playerMaxHp;
  }

  get hpPercent(): number {
    const max = this.playerMaxHp;
    return max > 0 ? Math.max(0, Math.min(100, (this.playerHp / max) * 100)) : 0;
  }

  // ── HUD Visibility Rules (C-332 AC-1, AC-5) ──

  /** HP bar: visible during EXPLORE, hidden during COMBAT, PAUSE_MENU, GAME_OVER, END_SESSION. */
  get showHpBar(): boolean {
    const overlay = this._overlays.activeOverlay;
    return overlay === 'NONE';
  }

  /** Quest tracker: visible during EXPLORE, hidden during all overlays. */
  get showQuestTracker(): boolean {
    const overlay = this._overlays.activeOverlay;
    return overlay === 'NONE';
  }

  get questOverlayVisible(): boolean {
    return this._questOverlay.visible;
  }

  /** Autosave indicator: visible during EXPLORE, hidden during PAUSE_MENU, GAME_OVER, END_SESSION. */
  get showAutosaveIndicator(): boolean {
    const overlay = this._overlays.activeOverlay;
    return (
      overlay !== 'PAUSE_MENU' &&
      overlay !== 'GAME_OVER' &&
      overlay !== 'END_SESSION' &&
      overlay !== 'COMBAT' &&
      overlay !== 'DIALOGUE'
    );
  }

  /** Hotbar: visible during exploration (NONE), hidden during all overlays and combat (C-337). */
  get showHotbar(): boolean {
    const overlay = this._overlays.activeOverlay;
    return overlay === 'NONE';
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
      $effect(() => {
        if (this._overlays.activeOverlay !== 'COMBAT') {
          return;
        }
        const cs = this._combat;
        const vm = this._createCombatViewModel({
          className: 'CombatViewModel',
          onDismissOverlay: () => this._overlays.closeCombat(),
        }) as CombatViewModel;
        void vm.initialize();
        vm.enemyName = cs.enemyName || 'Enemy';
        vm.enemyNpcId = cs.enemyNpcId;
        vm.enemyHp = cs.enemyHp;
        vm.enemyMaxHp = cs.enemyMaxHp;
        vm.activeEntities = [...cs.participantIds];
        vm.currentTurnEntity = cs.firstTurnEntityId;
        vm.totalParticipants = cs.participantIds.length;
        vm.isPlayerTurn = true;
        this.combatViewModel = vm;

        return () => {
          void vm.dispose();
          this.combatViewModel = undefined;
        };
      });

      // ── Inventory ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'INVENTORY') {
          return;
        }
        const vm = this._createInventoryViewModel({ className: 'InventoryViewModel' });
        this.inventoryViewModel = vm;

        return () => {
          this.inventoryViewModel = undefined;
        };
      });

      // ── Quest Log ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'QUEST_LOG') {
          return;
        }
        const vm = this._createQuestViewModel({ className: 'QuestViewModel' });
        this.questViewModel = vm;

        return () => {
          this.questViewModel = undefined;
        };
      });

      // ── Character Dashboard ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'CHARACTER_DASHBOARD') {
          return;
        }
        const vm = this._createCharacterSheetViewModel({
          className: 'CharacterSheetViewModel',
          onClose: () => this._overlays.closeCharacterDashboard(),
        });
        this.dashboardViewModel = vm;

        return () => {
          this.dashboardViewModel = undefined;
        };
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

      // ── End Session (C-240) ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'END_SESSION') {
          return;
        }
        const vm = this._createEndSessionViewModel({ className: 'EndSessionViewModel' });
        this.endSessionViewModel = vm;

        return () => {
          this.endSessionViewModel = undefined;
        };
      });

      // ── Settings Overlay (C-333 AC-4) ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'SETTINGS') {
          return;
        }
        const vm = this._createSettingsOverlayViewModel({ className: 'SettingsOverlayViewModel' });
        this.settingsOverlayViewModel = vm;

        return () => {
          this.settingsOverlayViewModel = undefined;
        };
      });

      // ── Party Roster (C-340) ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'PARTY_ROSTER') {
          return;
        }
        const vm = this._createPartyRosterViewModel({ className: 'PartyRosterViewModel' });
        this.partyRosterViewModel = vm;

        return () => {
          this.partyRosterViewModel = undefined;
        };
      });

      // ── Reputation (C-341) ──
      $effect(() => {
        if (this._overlays.activeOverlay !== 'REPUTATION') {
          return;
        }
        const vm = this._createReputationViewModel({ className: 'ReputationViewModel' });
        this.reputationViewModel = vm;

        return () => {
          this.reputationViewModel = undefined;
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
      this.reducedMotion = this._reducedMotionQuery.matches;
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
    this.reducedMotion = event.matches;
  };

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
