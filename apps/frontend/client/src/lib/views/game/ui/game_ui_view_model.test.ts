// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.test.ts
//
// Game UI overlay-router ViewModel tests. Every dependency (services and child
// ViewModel factories) is a construction capability, so these tests inject
// inert stubs and never touch the global service registry.

// biome-ignore-all lint/style/useNamingConvention: capability stubs mirror PascalCase ViewModel names

import { describe, expect, mock, test } from 'bun:test';
import type { BaseViewModelInterface } from '@aikami/frontend/services/base';
import type { GameEngineServiceInterface, NpcDialogueServiceInterface } from '$services';
import type { AutoSaveStatus, GameOverlayType, MotionPreference } from '$types';
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
import type { WorldViewModelInterface } from '$views/world/world_view_model.svelte';
import {
  createGameUIViewModel,
  type GameUIViewModelInterface,
  type GameUIViewModelOptions,
} from './game_ui_view_model.svelte';

/** Inert child ViewModel stand-in for capabilities the tests never exercise. */
const subStub = {} as BaseViewModelInterface;

/**
 * C-527 AC-6: a motion capability whose selection is real state, so the tests
 * can prove the game HUD reads the SAME source Settings writes.
 */
const createMotionCapability = (initial: MotionPreference = 'auto') => {
  const state = { preference: initial };
  return {
    get preference() {
      return state.preference;
    },
    setPreference: mock((preference: MotionPreference) => {
      state.preference = preference;
    }),
  };
};

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
  closeInventory: mock(() => {}),
  closePartyRoster: mock(() => {}),
  closeReputation: mock(() => {}),
  replaceOverlay: mock((_type: GameOverlayType) => {}),
  openInventory: mock(() => {}),
  openQuestLog: mock(() => {}),
  openJournal: mock(() => {}),
  closeJournal: mock(() => {}),
  openCharacterDashboard: mock(() => {}),
  openPartyRoster: mock(() => {}),
  openReputation: mock(() => {}),
  openWorld: mock(() => {}),
  closeWorld: mock(() => {}),
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
  // Fixture default is on so the overlay-policy tests exercise the clock; the
  // new-player default-off behavior is asserted explicitly.
  clock: { visible: true },
  session: { chatLocked: false, checkAutoSummaryThreshold: mock(() => {}) },
  time: { gameHour: 12, gameMinute: 30, windVelocity: 0, rainIntensity: 0 },
  motion: createMotionCapability(),
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
  createWorldViewModel: () => subStub as WorldViewModelInterface,
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

  test('withdraws the corner HUD chrome while the management host owns the screen', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    // C-527: the host's rail spans the top of the screen, so a clock or an
    // autosave badge left mounted at z-50 would paint over it.
    for (const active of [
      'INVENTORY',
      'QUEST_LOG',
      'JOURNAL',
      'CHARACTER_DASHBOARD',
      'PARTY_ROSTER',
      'REPUTATION',
      'WORLD',
    ] as const) {
      overlay.activeOverlay = active;
      expect(vm.showClockHud).toBe(false);
      expect(vm.showAutosaveIndicator).toBe(false);
      expect(vm.showHpBar).toBe(false);
      expect(vm.showQuestTracker).toBe(false);
      expect(vm.showHotbar).toBe(false);
      expect(vm.showManagementNav).toBe(false);
      expect(vm.isManagementOpen).toBe(true);
    }
  });

  test('hpPercent derives from player state', () => {
    expect(createVm().hpPercent).toBe(50);
  });

  test('questOverlayVisible reflects the quest overlay capability', () => {
    expect(createVm({ questOverlay: { visible: false } }).questOverlayVisible).toBe(false);
  });

  // C-527 AC-1 — clock off for a new player, explicit preference wins.
  test('showClockHud is off for a new player even during exploration', () => {
    const vm = createVm({ clock: { visible: false } });
    expect(vm.activeOverlay).toBe('NONE');
    expect(vm.showClockHud).toBe(false);
  });

  test('showClockHud honours an explicit stored preference during exploration', () => {
    expect(createVm({ clock: { visible: true } }).showClockHud).toBe(true);
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

describe('GameUIViewModel — management navigation (C-527)', () => {
  test('opens each canonical section through its legacy deep-open destination', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    vm.openManagementSection('character');
    expect(overlay.openCharacterDashboard).toHaveBeenCalledTimes(1);

    vm.openManagementSection('inventory');
    expect(overlay.openInventory).toHaveBeenCalledTimes(1);

    vm.openManagementSection('journal');
    expect(overlay.openJournal).toHaveBeenCalledTimes(1);

    vm.openManagementSection('party');
    expect(overlay.openPartyRoster).toHaveBeenCalledTimes(1);

    vm.openManagementSection('world');
    expect(overlay.openWorld).toHaveBeenCalledTimes(1);
  });

  test('a deep-open location reaches the equivalent section content', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    vm.openManagementLocation({ section: 'journal', subview: 'quests' });
    vm.openManagementLocation({ section: 'world', subview: 'reputation' });

    expect(overlay.openQuestLog).toHaveBeenCalledTimes(1);
    expect(overlay.openReputation).toHaveBeenCalledTimes(1);
    expect(overlay.openInventory).not.toHaveBeenCalled();
  });

  test('an unknown subview falls back to the section default instead of throwing', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    vm.openManagementLocation({ section: 'inventory', subview: 'not-a-subview' });

    expect(overlay.openInventory).toHaveBeenCalledTimes(1);
  });

  test('an unknown section is ignored and opens nothing', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    vm.openManagementLocation({ section: 'guildhall' as never });

    expect(overlay.openInventory).not.toHaveBeenCalled();
    expect(overlay.openWorld).not.toHaveBeenCalled();
    expect(overlay.replaceOverlay).not.toHaveBeenCalled();
  });

  test('switching a sibling section replaces the open section instead of stacking it', () => {
    const overlay = createOverlay();
    overlay.activeOverlay = 'INVENTORY';
    const vm = createVm({}, overlay);

    vm.openManagementSection('party');

    expect(overlay.replaceOverlay).toHaveBeenCalledWith('PARTY_ROSTER');
    expect(overlay.openPartyRoster).not.toHaveBeenCalled();
  });

  test('re-selecting the active section is a no-op', () => {
    const overlay = createOverlay();
    overlay.activeOverlay = 'INVENTORY';
    const vm = createVm({}, overlay);

    vm.openManagementSection('inventory');

    expect(overlay.replaceOverlay).not.toHaveBeenCalled();
    expect(overlay.openInventory).not.toHaveBeenCalled();
  });

  test('the Menu entry resumes the last opened location', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    vm.openManagementSection('party');
    overlay.activeOverlay = 'NONE';
    vm.openManagementMenu();

    expect(overlay.openPartyRoster).toHaveBeenCalledTimes(2);
    expect(vm.menuLocation).toEqual({ section: 'party' });
  });

  test('managementLocation is derived from the overlay stack, so host and shortcut agree', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    for (const [active, section] of [
      ['CHARACTER_DASHBOARD', 'character'],
      ['INVENTORY', 'inventory'],
      ['QUEST_LOG', 'journal'],
      ['PARTY_ROSTER', 'party'],
      ['REPUTATION', 'world'],
    ] as const) {
      overlay.activeOverlay = active;
      expect(vm.managementLocation?.section).toBe(section);
      expect(vm.isManagementOpen).toBe(true);
    }

    for (const active of ['NONE', 'COMBAT', 'DIALOGUE', 'PAUSE_MENU'] as const) {
      overlay.activeOverlay = active;
      expect(vm.managementLocation).toBeUndefined();
      expect(vm.isManagementOpen).toBe(false);
    }
  });

  test('closeManagement routes to the owning overlay close', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    overlay.activeOverlay = 'QUEST_LOG';
    vm.closeManagement();
    expect(overlay.closeQuestLog).toHaveBeenCalledTimes(1);

    overlay.activeOverlay = 'PARTY_ROSTER';
    vm.closeManagement();
    expect(overlay.closePartyRoster).toHaveBeenCalledTimes(1);

    overlay.activeOverlay = 'REPUTATION';
    vm.closeManagement();
    expect(overlay.closeReputation).toHaveBeenCalledTimes(1);
  });

  test('closeManagement never closes a non-management overlay', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    overlay.activeOverlay = 'PAUSE_MENU';
    vm.closeManagement();

    expect(overlay.closeInventory).not.toHaveBeenCalled();
    expect(overlay.closeQuestLog).not.toHaveBeenCalled();
    expect(overlay.closeJournal).not.toHaveBeenCalled();
  });
});

describe('GameUIViewModel — captured return context (C-527 AC-2)', () => {
  test('captures the originating overlay before the host takes over', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    expect(vm.returnContext).toBeUndefined();
    vm.openManagementSection('inventory');

    expect(vm.returnContext?.originOverlay).toBe('NONE');
  });

  test('captures a pause menu as the origin when management is opened over it', () => {
    const overlay = createOverlay();
    overlay.activeOverlay = 'PAUSE_MENU';
    const vm = createVm({}, overlay);

    vm.openManagementSection('inventory');

    expect(vm.returnContext?.originOverlay).toBe('PAUSE_MENU');
  });

  test('captures the conversation identity so a draft stays on the same actor', () => {
    const overlay = createOverlay();
    const vm = createVm(
      { npcDialogue: { activeNpc: { npcId: 'elder_thalia' } } as NpcDialogueServiceInterface },
      overlay,
    );

    vm.openManagementSection('journal');

    expect(vm.returnContext?.npcId).toBe('elder_thalia');
    expect(vm.returnContext?.draftId).toBe('dialogue-draft:elder_thalia');
  });

  test('the origin is captured once per session, not re-captured by a sibling switch', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    vm.openManagementSection('inventory');
    overlay.activeOverlay = 'INVENTORY';
    vm.openManagementSection('world');

    expect(vm.returnContext?.originOverlay).toBe('NONE');
  });

  test('closing releases the captured context', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    vm.openManagementSection('inventory');
    overlay.activeOverlay = 'INVENTORY';
    vm.closeManagement();

    expect(vm.returnContext).toBeUndefined();
  });

  test('an exploration origin carries no conversation identity', () => {
    const overlay = createOverlay();
    const vm = createVm({}, overlay);

    vm.openManagementSection('party');

    expect(vm.returnContext?.npcId).toBeUndefined();
    expect(vm.returnContext?.draftId).toBeUndefined();
  });
});

describe('GameUIViewModel — effective motion policy (C-527 AC-6)', () => {
  test('publishes the effective policy to the game UI layer', () => {
    expect(createVm().motionAttribute).toBe('full');
  });

  test('reads the selection from the shared motion capability', () => {
    expect(createVm({ motion: createMotionCapability('reduce') }).motionPreference).toBe('reduce');
  });

  test('an explicit selection wins over the OS preference', () => {
    const overlay = createOverlay();
    const motion = createMotionCapability('reduce');
    const vm = createVm({ motion }, overlay);

    vm.setMotionPreference('full');

    expect(motion.setPreference).toHaveBeenCalledWith('full');
    expect(vm.motionPreference).toBe('full');
    // The single effective policy is recomputed from the shared source, so the
    // HUD cannot keep applying a stale value after Settings changes it.
    expect(vm.motionAttribute).toBe('full');
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
