// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  type AutoSaveStatus,
  chatService,
  combatService,
  type DialogueNpcData,
  type GameOverlayType,
  gameEngineService,
  gameOverlayService,
  inputActionService,
  npcDialogueService,
  onboardingHintService,
  playerStateService,
  sessionService,
  timeService,
} from '$services';
import {
  type CombatViewModel,
  type CombatViewModelInterface,
  getCombatViewModel,
} from '../../combat/combat_view_model.svelte.ts';
import type { InventoryViewModelInterface } from '../../inventory/inventory_view_model.svelte';
import { getInventoryViewModel } from '../../inventory/inventory_view_model.svelte';
import type { QuestViewModelInterface } from '../../quest/quest_view_model.svelte.ts';
import { getQuestViewModel } from '../../quest/quest_view_model.svelte.ts';
import type { VendorViewModelInterface } from '../../vendor/vendor_view_model.svelte';
import { getVendorViewModel } from '../../vendor/vendor_view_model.svelte';
import type { CharacterSheetViewModelInterface } from '../dashboard/character_sheet_view_model.svelte';
import { getCharacterSheetViewModel } from '../dashboard/character_sheet_view_model.svelte';
import {
  type DialogueOverlayViewModelInterface,
  getDialogueOverlayViewModel,
} from './overlays/dialogue/dialogue_overlay_view_model.svelte';
import type { EndSessionViewModelInterface } from './overlays/end_session/end_session_view_model.svelte';
import { getEndSessionViewModel } from './overlays/end_session/end_session_view_model.svelte';
import type { GameOverViewModelInterface } from './overlays/game_over/game_over_view_model.svelte';
import { getGameOverViewModel } from './overlays/game_over/game_over_view_model.svelte';
import type { PauseMenuViewModelInterface } from './overlays/pause_menu/pause_menu_view_model.svelte';
import { getPauseMenuViewModel } from './overlays/pause_menu/pause_menu_view_model.svelte';
import {
  getSettingsOverlayViewModel,
  type SettingsOverlayViewModelInterface,
} from './overlays/settings/settings_overlay_view_model.svelte';
import {
  getPartyRosterViewModel,
  type PartyRosterViewModelInterface,
} from './overlays/party_roster/party_roster_view_model.svelte';
import {
  getQuestTrackerViewModel,
  type QuestTrackerViewModelInterface,
} from './quest_tracker_view_model.svelte';

// Re-export for sub-ViewModels
export type { AutoSaveStatus, DialogueNpcData, GameOverlayType };

// ---------------------------------------------------------------------------
// GameUIViewModel — overlay router for the game UI layer.
//
// Creates and manages all overlay sub-ViewModels. The View reads
// activeOverlay to pick which overlay component to render.
// ---------------------------------------------------------------------------

export type GameUIViewModelOptions = BaseViewModelOptions;

export type GameUIViewModelInterface = BaseViewModelInterface & {
  readonly activeOverlay: GameOverlayType;
  readonly overlayStack: readonly import('$lib/services/game/game_overlay_service.svelte.ts').OverlayStackEntry[];
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

  // ── Interaction HUD (C-327) ──

  /** Current interaction prompt label (e.g. "E — Talk to Elder Thalia"). */
  readonly interactionPromptLabel: string;
  /** Whether the interaction prompt is visible. */
  readonly interactionPromptVisible: boolean;
  /** Current onboarding hint text, or undefined if none. */
  readonly onboardingHintText: string | undefined;
  /** Whether the onboarding hint toast is visible. */
  readonly onboardingHintVisible: boolean;
  /** Whether the user prefers reduced motion (AC-5). */
  readonly reducedMotion: boolean;

  handleKeyDown(event: KeyboardEvent): void;
  resumeGame(): void;
  endDialogue(): void;
  saveGame(): Promise<void>;
  respawnPlayer(): Promise<void>;
  loadLastSave(): Promise<void>;
  dismissOnboardingHint(): void;
};

class GameUIViewModel
  extends BaseViewModel<GameUIViewModelOptions>
  implements GameUIViewModelInterface
{
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

  /** Quest tracker ViewModel (C-332 AC-1) — created eagerly, filters only when visible. */
  questTrackerViewModel = $state<QuestTrackerViewModelInterface>(
    getQuestTrackerViewModel({ className: 'QuestTrackerViewModel' }),
  );

  // ── Interaction HUD state (C-327) ──

  get interactionPromptLabel(): string {
    return gameOverlayService.interactionPromptLabel;
  }

  get interactionPromptVisible(): boolean {
    return gameOverlayService.interactionPromptVisible;
  }

  get onboardingHintText(): string | undefined {
    const hint = onboardingHintService.currentHint;
    if (!hint) {
      return undefined;
    }
    // Replace {key} placeholder with the current binding label
    const keyLabel = inputActionService.actionDisplayLabel(hint.action);
    return hint.text.replaceAll('{key}', keyLabel);
  }

  get onboardingHintVisible(): boolean {
    return onboardingHintService.hintVisible;
  }

  /** Detects prefers-reduced-motion via matchMedia (C-327 AC-5). */
  reducedMotion = $state<boolean>(false);

  private _reducedMotionQuery: MediaQueryList | undefined;

  // ── Service-proxied state ──

  get activeOverlay(): GameOverlayType {
    return gameOverlayService.activeOverlay;
  }

  get overlayStack(): readonly import('$lib/services/game/game_overlay_service.svelte.ts').OverlayStackEntry[] {
    return gameOverlayService.overlayStack;
  }

  get isTransitioning(): boolean {
    return gameOverlayService.isTransitioning;
  }

  /** Reads combat state from engine service (C-332 AC-5). */
  get isCombat(): boolean {
    return gameOverlayService.activeOverlay === 'COMBAT';
  }

  get autoSaveStatus(): AutoSaveStatus {
    return gameOverlayService.autoSaveStatus;
  }

  get gameHour(): number {
    return timeService.gameHour;
  }

  get gameMinute(): number {
    return timeService.gameMinute;
  }

  get windVelocity(): number {
    return timeService.windVelocity;
  }

  get rainIntensity(): number {
    return timeService.rainIntensity;
  }

  get chatLocked(): boolean {
    return sessionService.chatLocked;
  }

  get showClockHud(): boolean {
    const overlay = gameOverlayService.activeOverlay;
    return overlay !== 'PAUSE_MENU' && overlay !== 'GAME_OVER' && overlay !== 'END_SESSION';
  }

  // ── Player HP (C-332 AC-1) ──

  get playerHp(): number {
    return playerStateService.playerHp;
  }

  get playerMaxHp(): number {
    return playerStateService.playerMaxHp;
  }

  get hpPercent(): number {
    const max = this.playerMaxHp;
    return max > 0 ? Math.max(0, Math.min(100, (this.playerHp / max) * 100)) : 0;
  }

  // ── HUD Visibility Rules (C-332 AC-1, AC-5) ──

  /** HP bar: visible during EXPLORE, hidden during COMBAT, PAUSE_MENU, GAME_OVER, END_SESSION. */
  get showHpBar(): boolean {
    const overlay = gameOverlayService.activeOverlay;
    return overlay === 'NONE';
  }

  /** Quest tracker: visible during EXPLORE, hidden during all overlays. */
  get showQuestTracker(): boolean {
    const overlay = gameOverlayService.activeOverlay;
    return overlay === 'NONE';
  }

  /** Autosave indicator: visible during EXPLORE, hidden during PAUSE_MENU, GAME_OVER, END_SESSION. */
  get showAutosaveIndicator(): boolean {
    const overlay = gameOverlayService.activeOverlay;
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
    const overlay = gameOverlayService.activeOverlay;
    return overlay === 'NONE';
  }

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    gameOverlayService.setEngineService(
      gameEngineService as import('$lib/services/game/game_engine_service.svelte').GameEngineServiceInterface,
    );

    // React to overlay state changes — create/destroy sub-ViewModels
    this.registerEffectRoot(() => {
      // ── Dialogue ──
      $effect(() => {
        if (gameOverlayService.activeOverlay !== 'DIALOGUE') {
          return;
        }
        const npc = npcDialogueService.activeNpc;
        if (!npc) {
          return;
        }
        const vm = getDialogueOverlayViewModel({
          className: 'DialogueOverlayViewModel',
          npcData: npc,
          onEndChat: () => gameOverlayService.endDialogue(),
          npcDialogueService: npcDialogueService,
          onStartCombat: (combatNpcData) => {
            gameOverlayService.startCombat({ enemyName: combatNpcData.npcName });
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
        if (gameOverlayService.activeOverlay !== 'COMBAT') {
          return;
        }
        const cs = combatService;
        const vm = getCombatViewModel({ className: 'CombatViewModel' }) as CombatViewModel;
        void vm.initialize();
        vm.enemyName = cs.enemyName;
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
        if (gameOverlayService.activeOverlay !== 'INVENTORY') {
          return;
        }
        const vm = getInventoryViewModel({ className: 'InventoryViewModel' });
        this.inventoryViewModel = vm;

        return () => {
          this.inventoryViewModel = undefined;
        };
      });

      // ── Quest Log ──
      $effect(() => {
        if (gameOverlayService.activeOverlay !== 'QUEST_LOG') {
          return;
        }
        const vm = getQuestViewModel({ className: 'QuestViewModel' });
        this.questViewModel = vm;

        return () => {
          this.questViewModel = undefined;
        };
      });

      // ── Character Dashboard ──
      $effect(() => {
        if (gameOverlayService.activeOverlay !== 'CHARACTER_DASHBOARD') {
          return;
        }
        const vm = getCharacterSheetViewModel({
          className: 'CharacterSheetViewModel',
          onClose: () => gameOverlayService.closeCharacterDashboard(),
        });
        this.dashboardViewModel = vm;

        return () => {
          this.dashboardViewModel = undefined;
        };
      });

      // ── Vendor ──
      $effect(() => {
        if (gameOverlayService.activeOverlay !== 'VENDOR') {
          return;
        }
        const opts = gameOverlayService.vendorSessionOptions;
        if (!opts) {
          return;
        }
        const vm = getVendorViewModel({
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
        if (gameOverlayService.activeOverlay !== 'END_SESSION') {
          return;
        }
        const vm = getEndSessionViewModel();
        this.endSessionViewModel = vm;

        return () => {
          this.endSessionViewModel = undefined;
        };
      });

      // ── Settings Overlay (C-333 AC-4) ──
      $effect(() => {
        if (gameOverlayService.activeOverlay !== 'SETTINGS') {
          return;
        }
        const vm = getSettingsOverlayViewModel({ className: 'SettingsOverlayViewModel' });
        this.settingsOverlayViewModel = vm;

        return () => {
          this.settingsOverlayViewModel = undefined;
        };
      });

      // ── Party Roster (C-340) ──
      $effect(() => {
        if (gameOverlayService.activeOverlay !== 'PARTY_ROSTER') {
          return;
        }
        const vm = getPartyRosterViewModel({ className: 'PartyRosterViewModel' });
        this.partyRosterViewModel = vm;

        return () => {
          this.partyRosterViewModel = undefined;
        };
      });

      // Camera zoom forwarding (for dialogue spatial UI)
      $effect(() => {
        const x = gameOverlayService._cameraZoomNpcScreenX;
        const y = gameOverlayService._cameraZoomNpcScreenY;
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
    this.pauseMenuViewModel = getPauseMenuViewModel({ className: 'PauseMenuViewModel' });
    this.gameOverViewModel = getGameOverViewModel({ className: 'GameOverViewModel' });

    // Auto-summary threshold check (C-240)
    this.registerEffectRoot(() => {
      $effect(() => {
        void chatService.messages.length;
        sessionService.checkAutoSummaryThreshold();
      });
    });

    // Detect prefers-reduced-motion (C-327 AC-5)
    this._reducedMotionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (this._reducedMotionQuery) {
      this.reducedMotion = this._reducedMotionQuery.matches;
      this._reducedMotionQuery.addEventListener('change', this._onReducedMotionChange);
    }

    await gameOverlayService.initialize();
    await super.initialize();
  }

  // ── Delegated ──

  handleKeyDown(event: KeyboardEvent): void {
    gameOverlayService.handleKeyDown(event);
  }

  resumeGame(): void {
    gameOverlayService.resumeGame();
  }

  endDialogue(): void {
    gameOverlayService.endDialogue();
  }

  async saveGame(): Promise<void> {
    await gameOverlayService.saveGame();
  }

  async respawnPlayer(): Promise<void> {
    await gameOverlayService.respawnPlayer();
  }

  async loadLastSave(): Promise<void> {
    await gameOverlayService.loadLastSave();
  }

  /** Dismisses the current onboarding hint (C-327 AC-3). */
  dismissOnboardingHint(): void {
    onboardingHintService.dismissCurrentHint();
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

export const getGameUIViewModel = (options: GameUIViewModelOptions): GameUIViewModelInterface =>
  GameUIViewModel.create(options);
