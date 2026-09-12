// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.test.ts
//
// Game UI overlay-router ViewModel tests. Every dependency (services and child
// ViewModel factories) is a construction capability, so these tests inject
// inert stubs and never touch the global service registry.

// biome-ignore-all lint/style/useNamingConvention: capability stubs mirror PascalCase ViewModel names

import { describe, expect, mock, test } from 'bun:test';
import type { BaseViewModelInterface } from '@aikami/frontend/services/base';
import type { GameEngineServiceInterface, NpcDialogueServiceInterface } from '$services';
import type { AutoSaveStatus, GameOverlayType } from '$types';
import type { CombatViewModelInterface } from '$views/combat/combat_view_model.svelte';
import type { CharacterSheetViewModelInterface } from '$views/game/dashboard/character_sheet_view_model.svelte';
import type { DialogueOverlayViewModelInterface } from '$views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte';
import type { EndSessionViewModelInterface } from '$views/game/ui/overlays/end_session/end_session_view_model.svelte';
import type { GameOverViewModelInterface } from '$views/game/ui/overlays/game_over/game_over_view_model.svelte';
import type { PartyRosterViewModelInterface } from '$views/game/ui/overlays/party_roster/party_roster_view_model.svelte';
import type { PauseMenuViewModelInterface } from '$views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte';
import type { ReputationViewModelInterface } from '$views/game/ui/overlays/reputation/reputation_view_model.svelte';
import type { SettingsOverlayViewModelInterface } from '$views/game/ui/overlays/settings/settings_overlay_view_model.svelte';
import type { TalkToPartyViewModelInterface } from '$views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte';
import type { QuestTrackerViewModelInterface } from '$views/game/ui/quest_tracker_view_model.svelte';
import type { InventoryViewModelInterface } from '$views/inventory/inventory_view_model.svelte';
import type { JournalViewModelInterface } from '$views/journal/journal_view_model.svelte';
import type { QuestViewModelInterface } from '$views/quest/quest_view_model.svelte';
import type { VendorViewModelInterface } from '$views/vendor/vendor_view_model.svelte';
import {
  createGameUIViewModel,
  type GameUIViewModelInterface,
  type GameUIViewModelOptions,
} from './game_ui_view_model.svelte';

/** Inert child ViewModel stand-in for capabilities the tests never exercise. */
const subStub = {} as BaseViewModelInterface;

const createOverlay = () => ({
  activeOverlay: 'NONE' as GameOverlayType,
  overlayStack: [],
  isTransitioning: false,
  autoSaveStatus: 'idle' as AutoSaveStatus,
  vendorSessionOptions: undefined,
  _cameraZoomNpcScreenX: undefined,
  _cameraZoomNpcScreenY: undefined,
  interactionPromptLabel: '',
  interactionPromptVisible: false,
  setEngineService: mock((_service: GameEngineServiceInterface) => {}),
  initialize: mock(async () => {}),
  handleKeyDown: mock((_event: KeyboardEvent) => {}),
  endDialogue: mock(() => {}),
  resumeGame: mock(() => {}),
  saveGame: mock(async () => {}),
  respawnPlayer: mock(async () => {}),
  loadLastSave: mock(async () => {}),
  startCombat: mock(() => {}),
  closeCombat: mock(() => {}),
  closeQuestLog: mock(() => {}),
  closeCharacterDashboard: mock(() => {}),
  openInventory: mock(() => {}),
  openQuestLog: mock(() => {}),
  openJournal: mock(() => {}),
  closeJournal: mock(() => {}),
  openCharacterDashboard: mock(() => {}),
  openPartyRoster: mock(() => {}),
  openReputation: mock(() => {}),
});

const buildOptions = (
  overrides: Partial<GameUIViewModelOptions> = {},
  overlay = createOverlay(),
): GameUIViewModelOptions => ({
  className: 'GameUIViewModel',
  chat: { messages: [] },
  combat: {
    enemyName: 'Unknown Enemy',
    enemyNpcId: '',
    enemyHp: 0,
    enemyMaxHp: 0,
    participantIds: [],
    firstTurnEntityId: 1,
  },
  config: { getActiveTextProvider: mock(() => ({ provider: 'ollama' })) },
  runtimeConfig: { getTextUrl: mock(() => 'http://localhost:11434') },
  overlays: overlay,
  inputAction: { actionDisplayLabel: mock((id: string) => id) },
  npcDialogue: {} as NpcDialogueServiceInterface,
  onboarding: {
    currentHint: undefined,
    hintVisible: false,
    stepIndex: -1,
    totalSteps: 0,
    dismissCurrentHint: mock(() => {}),
    skipOnboarding: mock(() => {}),
  },
  playerState: { playerHp: 40, playerMaxHp: 80 },
  questOverlay: { visible: true },
  session: { chatLocked: false, checkAutoSummaryThreshold: mock(() => {}) },
  time: { gameHour: 12, gameMinute: 30, windVelocity: 0, rainIntensity: 0 },
  engine: {} as GameEngineServiceInterface,
  createCombatViewModel: () => subStub as CombatViewModelInterface,
  createDialogueOverlayViewModel: () => subStub as DialogueOverlayViewModelInterface,
  createInventoryViewModel: () => subStub as InventoryViewModelInterface,
  createQuestViewModel: () => subStub as QuestViewModelInterface,
  createJournalViewModel: () => subStub as JournalViewModelInterface,
  createCharacterSheetViewModel: () => subStub as CharacterSheetViewModelInterface,
  createVendorViewModel: () => subStub as VendorViewModelInterface,
  createEndSessionViewModel: () => subStub as EndSessionViewModelInterface,
  createGameOverViewModel: () => subStub as GameOverViewModelInterface,
  createPauseMenuViewModel: () => subStub as PauseMenuViewModelInterface,
  createSettingsOverlayViewModel: () => subStub as SettingsOverlayViewModelInterface,
  createPartyRosterViewModel: () => subStub as PartyRosterViewModelInterface,
  createReputationViewModel: () => subStub as ReputationViewModelInterface,
  createTalkToPartyViewModel: () => subStub as TalkToPartyViewModelInterface,
  createQuestTrackerViewModel: () => subStub as QuestTrackerViewModelInterface,
  ...overrides,
});

const createVm = (
  overrides: Partial<GameUIViewModelOptions> = {},
  overlay = createOverlay(),
): GameUIViewModelInterface => createGameUIViewModel(buildOptions(overrides, overlay));

describe('GameUIViewModel — HUD visibility', () => {
  test('shows the HP bar only during exploration', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    expect(vm.showHpBar).toBe(true);
    overlay.activeOverlay = 'COMBAT';
    expect(vm.showHpBar).toBe(false);
    overlay.activeOverlay = 'NONE';
    expect(vm.showHpBar).toBe(true);
  });

  test('hides the clock during terminal overlays', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    overlay.activeOverlay = 'PAUSE_MENU';
    expect(vm.showClockHud).toBe(false);
    overlay.activeOverlay = 'END_SESSION';
    expect(vm.showClockHud).toBe(false);
    overlay.activeOverlay = 'NONE';
    expect(vm.showClockHud).toBe(true);
  });

  test('hpPercent derives from player state', () => {
    expect(createVm().hpPercent).toBe(50);
  });

  test('questOverlayVisible reflects the quest overlay capability', () => {
    expect(createVm({ questOverlay: { visible: false } }).questOverlayVisible).toBe(false);
  });
});

describe('GameUIViewModel — delegated actions', () => {
  test('resumeGame and endDialogue delegate to the overlay router', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    vm.resumeGame();
    vm.endDialogue();

    expect(overlay.resumeGame).toHaveBeenCalledTimes(1);
    expect(overlay.endDialogue).toHaveBeenCalledTimes(1);
  });

  test('dismissOnboardingHint delegates to the onboarding capability', () => {
    const dismissCurrentHint = mock(() => {});
    const vm = createVm({
      onboarding: {
        currentHint: undefined,
        hintVisible: false,
        stepIndex: -1,
        totalSteps: 0,
        dismissCurrentHint,
        skipOnboarding: mock(() => {}),
      },
    });

    vm.dismissOnboardingHint();

    expect(dismissCurrentHint).toHaveBeenCalledTimes(1);
  });
});

describe('GameUIViewModel — initialize', () => {
  test('registers the engine with the overlay router', async () => {
    const overlay = createOverlay();
    const engine = {} as GameEngineServiceInterface;
    const vm = createVm({ engine }, overlay);

    await vm.initialize();

    expect(overlay.setEngineService).toHaveBeenCalledWith(engine);
    expect(overlay.initialize).toHaveBeenCalledTimes(1);
  });

  test('dispose tears down without throwing', async () => {
    const vm = createVm();

    await expect(vm.dispose()).resolves.toBeUndefined();
  });
});
