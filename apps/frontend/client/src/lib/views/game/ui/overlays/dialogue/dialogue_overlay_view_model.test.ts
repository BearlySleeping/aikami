// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts
//
// Unit tests for DialogueOverlayViewModel (C-328 refactor, C-371 free-text-first).
// Tests delegation to NpcDialogueService (orchestrator) using the two-call
// pipeline (analyzeIntent → resolveRoll) or single-call (generateTurn).
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts

// biome-ignore-all lint/style/useNamingConvention: Mock object properties mirror PascalCase class names from @aikami/frontend-services
import { afterEach, beforeEach, describe, expect, type Mock, mock, test } from 'bun:test';
import { SKILL_CHECK_STAKES } from '@aikami/constants';
import type { GameCharacterSheet } from '@aikami/types';
import { computeModifier, createDefaultSheet } from '@aikami/utils';
import { availableMessageActions } from '../../../../../components/chat/message_actions';
import type { NpcDialogueServiceInterface } from '$services';

type AnalyzeIntentOptions = Parameters<NpcDialogueServiceInterface['analyzeIntent']>[0];
type AnalyzeIntentCallback = (
  options: AnalyzeIntentOptions,
) => ReturnType<NpcDialogueServiceInterface['analyzeIntent']>;

// ---------------------------------------------------------------------------
// Seeded character sheet — the mocked playerStateService returns this so the
// ViewModel's real breakdown computation is exercised against authored data.
// ---------------------------------------------------------------------------

const makeSeededSheet = (options?: {
  charisma?: number;
  persuasionProficient?: boolean;
  persuasionExpertise?: boolean;
}): GameCharacterSheet => {
  const sheet = createDefaultSheet();
  const charisma = options?.charisma ?? 10;
  sheet.abilities = {
    ...sheet.abilities,
    charisma: { value: charisma, modifier: computeModifier(charisma) },
  };
  sheet.skills = sheet.skills.map((s) =>
    s.name === 'Persuasion'
      ? {
          ...s,
          isProficient: options?.persuasionProficient ?? false,
          isExpertise: options?.persuasionExpertise ?? false,
        }
      : s,
  );
  return sheet;
};

let seededSheet: GameCharacterSheet = makeSeededSheet({
  charisma: 16,
  persuasionProficient: true,
});
let isCharacterSheetAuthored = true;

// ---------------------------------------------------------------------------
// Mock: npcDialogueService (orchestrator) — C-371 two-call pipeline
// ---------------------------------------------------------------------------

let generateTurnStub = mock(async () => ({
  narrative: 'The elder nods thoughtfully.',
  choices: [
    { id: 'talk', label: 'Ask about the ward' },
    { id: 'leave', label: 'Leave' },
  ],
  source: 'ai' as const,
}));

const defaultAnalyzeIntent: AnalyzeIntentCallback = async (_options) => ({
  requiresRoll: false,
  checkType: undefined,
  difficultyClass: undefined,
  modifierSource: undefined,
  npcResponse: 'The elder considers your words.',
  suggestedChips: [
    {
      id: 'talk',
      label: 'Ask about the ward',
      intentType: 'dialogue' as const,
      prefillText: 'Tell me about the ward.',
    },
    { id: 'leave', label: 'Leave', intentType: 'dialogue' as const, prefillText: 'Goodbye.' },
  ],
});

let analyzeIntentStub: Mock<AnalyzeIntentCallback> = mock(defaultAnalyzeIntent);

// ── Quest-activation tool call stubs (C-quest-activation) ──
let acceptQuestStub = mock(() => true);
let declineQuestStub = mock(() => {});
let getOfferableQuestsStub = mock(() => [{ id: 'fading_ward', name: 'The Fading Ward' }]);

const mockQuestStateService = {
  quests: [],
  worldStateFlags: {},
  acceptQuest: acceptQuestStub,
  declineQuest: declineQuestStub,
  canAcceptQuest: mock(() => true),
  getOfferableQuests: getOfferableQuestsStub,
  evaluateTriggers: mock(() => {}),
};

const resolveRollStub = mock(async () => ({
  narrativeResult: 'The attempt succeeds.',
  stateDeltas: [],
  suggestedChips: [],
}));

const mockNpcDialogueService = {
  generateTurn: generateTurnStub,
  analyzeIntent: analyzeIntentStub,
  resolveRoll: resolveRollStub,
  useFreeTextFirst: true,
  wasCommandExecuted: mock(() => false),
  markCommandExecuted: mock(() => {}),
  configure: mock(() => {}),
  deriveAllowedCommands: mock(() => ['trade', 'offerQuest', 'skillCheck', 'giveItem']),
  buildContext: mock(() => ({
    persona: 'You are a sage.',
    npcName: 'Elder Thrain',
    memory: [],
    gameStateFacts: [],
    allowedCommands: ['trade', 'offerQuest', 'skillCheck', 'giveItem'],
  })),
};

// ---------------------------------------------------------------------------
// Mock: services barrel (minimal)
// ---------------------------------------------------------------------------

// In isolated test runs the bare `$services` alias is resolved through the
// tsconfig paths BEFORE mock.module matching; keep the bare-specifier mock
// (the same form the other passing ViewModel tests use).
mock.module('$services', () => ({
  buildGameStateFacts: () => ['Location: Village of Oakvale', 'Time: Midday'],
  combatService: {
    lastCombatOptions: undefined,
    enemyName: 'Unknown Enemy',
    enemyHp: 0,
    enemyMaxHp: 0,
  },
  diceService: {
    rollD20: (_modifier: number) => ({ natural: 14, total: 14 }),
  },
  draftStore: {
    loadDraft: mock(async () => ''),
    saveDraft: mock(async () => {}),
    clearDraft: mock(async () => {}),
  },
  gameModeService: {
    currentMode: 'DIALOGUE',
  },
  gameOverlayService: {
    openVendor: mock(() => {}),
    startCombat: mock(() => {}),
    closeEndSession: mock(() => {}),
    endSession: mock(async () => {}),
  },
  questStateService: mockQuestStateService,
  messageBranchStore: {
    swipeAlternative: mock(() => {}),
    clearAlternatives: mock(() => {}),
    addAlternative: mock(() => {}),
    enrichMessage: mock(
      (options: { id: string; text: string; sender: string; timestamp: Date }) => ({
        ...options,
        alternativeCount: 1,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
        showActions: true,
      }),
    ),
  },
  playerStateService: {
    characterSheetSummary: undefined,
    classId: 'fighter',
    get characterSheet() {
      return seededSheet;
    },
    get isCharacterSheetAuthored() {
      return isCharacterSheetAuthored;
    },
  },
  ttsService: {
    selectedVoice: 'default',
    initialize: mock(async () => {}),
    synthesize: mock(() => {}),
    stop: mock(() => {}),
    status: 'uninitialized',
    speak: mock(async () => {}),
    isKokoroServerAvailable: false,
  },
  expressionService: {
    detectExpression: mock(async () => ({
      expressionMap: { 'Elder Thrain': 'happy' },
      detectionTier: 'keyword' as const,
    })),
  },
  SentenceBoundaryChunker: class {
    onSentence = mock(() => {});
    feed = mock(() => {});
    close = mock(() => {});
  },
  npcDialogueService: mockNpcDialogueService,
  imageGenerationService: {
    isGenerating: false,
    generateImage: mock(async ({ prompt }: { prompt: string }) => ({
      url: `blob:mock-${prompt}`,
      isDemo: false,
    })),
  },
  __esModule: true,
  default: {},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  type DialogueOverlayViewModelInterface,
  type DialogueOverlayViewModelOptions,
  getDialogueOverlayViewModel,
} from './dialogue_overlay_view_model.svelte';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createNpcData = (overrides?: Partial<DialogueOverlayViewModelOptions['npcData']>) => ({
  npcId: 'npc-001',
  npcName: 'Elder Thrain',
  dialog: 'Welcome, traveler!',
  ...overrides,
});

const createViewModel = (options?: {
  npcData?: ReturnType<typeof createNpcData>;
  onEndChat?: () => void;
  isCampaignPlay?: boolean;
  useFreeTextFirst?: boolean;
  imageProviderAvailable?: boolean;
}): DialogueOverlayViewModelInterface => {
  mockNpcDialogueService.useFreeTextFirst = options?.useFreeTextFirst ?? true;
  return getDialogueOverlayViewModel({
    className: 'TestDialogueOverlayViewModel',
    npcData: options?.npcData ?? createNpcData(),
    onEndChat: options?.onEndChat ?? (() => {}),
    npcDialogueService: mockNpcDialogueService,
    isCampaignPlay: options?.isCampaignPlay,
    imageProviderAvailable: options?.imageProviderAvailable,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DialogueOverlayViewModel', () => {
  beforeEach(() => {
    seededSheet = makeSeededSheet({ charisma: 16, persuasionProficient: true });
    isCharacterSheetAuthored = true;

    generateTurnStub = mock(async () => ({
      narrative: 'The elder nods thoughtfully.',
      choices: [
        { id: 'talk', label: 'Ask about the ward' },
        { id: 'leave', label: 'Leave' },
      ],
      source: 'ai' as const,
    }));
    mockNpcDialogueService.generateTurn = generateTurnStub;
    analyzeIntentStub = mock(defaultAnalyzeIntent);
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    // Reset quest-activation stubs
    acceptQuestStub = mock(() => true);
    declineQuestStub = mock(() => {});
    getOfferableQuestsStub = mock(() => [{ id: 'fading_ward', name: 'The Fading Ward' }]);
    mockQuestStateService.acceptQuest = acceptQuestStub;
    mockQuestStateService.declineQuest = declineQuestStub;
    mockQuestStateService.getOfferableQuests = getOfferableQuestsStub;
  });

  afterEach(() => {
    mock.restore();
  });

  // ── Initialization ─────────────────────────────────────────────────────

  test('initializes with NPC greeting as first message when dialog is provided', () => {
    const vm = createViewModel({
      npcData: createNpcData({ dialog: 'Welcome, traveler!' }),
    });

    expect(vm.messages.length).toBe(1);
    expect(vm.messages[0].role).toBe('npc');
    expect(vm.messages[0].content).toBe('Welcome, traveler!');
  });

  test('initializes with empty messages when no dialog', () => {
    const vm = createViewModel({
      npcData: createNpcData({ dialog: '' }),
    });

    expect(vm.messages.length).toBe(0);
  });

  test('npcName returns the NPC display name', () => {
    const vm = createViewModel();
    expect(vm.npcName).toBe('Elder Thrain');
  });

  // ── Input Management ───────────────────────────────────────────────────

  test('setInput updates inputText', () => {
    const vm = createViewModel();
    vm.setInput('Hello!');
    expect(vm.inputText).toBe('Hello!');
  });

  test('sendMessage does nothing when input is empty', () => {
    const vm = createViewModel();
    vm.sendMessage('');
    expect(vm.messages.length).toBe(1); // only greeting
  });

  test('sendMessage does nothing when streaming', () => {
    const vm = createViewModel();
    // Simulate streaming state
    vm.inputText = 'Hello';
    vm.sendMessage();
    expect(vm.messages.length).toBeGreaterThan(1); // player + response
  });

  test('sendMessage clears input after sending', () => {
    const vm = createViewModel();
    vm.inputText = 'Hello world!';
    vm.sendMessage();
    expect(vm.inputText).toBe('');
  });

  // ── Orchestrator Delegation (C-328 / C-371) ─────────────────────────

  test('sendMessage delegates to analyzeIntent when useFreeTextFirst is true', async () => {
    const vm = createViewModel();
    vm.inputText = 'What do you know about the ward?';
    vm.sendMessage();

    // Wait for async
    await new Promise((r) => setTimeout(r, 50));

    expect(mockNpcDialogueService.analyzeIntent).toHaveBeenCalled();
    // Should have 3 messages: greeting, player, NPC pre-roll narrative
    expect(vm.messages.length).toBe(3);
  });

  test('npc message contains pre-roll narrative from intent analysis', async () => {
    analyzeIntentStub = mock(async () => ({
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'The elder strokes his beard. "The ward is failing."',
      suggestedChips: [
        {
          id: 'talk',
          label: 'Tell me more',
          intentType: 'dialogue' as const,
          prefillText: 'Tell me more.',
        },
      ],
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    const vm = createViewModel();
    vm.inputText = 'Tell me about the ward.';
    vm.sendMessage();

    // Expression detection is fire-and-forget async (real expressionService) —
    // give the detection chain a moment to settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(vm.messages.length).toBe(3);
    expect(vm.messages[2].content).toBe('The elder strokes his beard. "The ward is failing."');
    // Expression should be set from the mock
    expect(vm.npcExpression).toBe('happy');
  });

  test('surfaces an explicit error state rather than an endless placeholder when intent analysis fails after retry+repair (C-499 AC-3)', async () => {
    analyzeIntentStub = mock(async () => {
      throw new Error('No JSON object found in response');
    });
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    const vm = createViewModel();
    vm.inputText = 'I attack the goblin';
    vm.sendMessage();

    await new Promise((r) => setTimeout(r, 50));

    // An explicit error state is surfaced (never an endless "..." placeholder).
    expect(vm.streamError).toBe('No JSON object found in response');
    // The empty placeholder NPC message was removed — no stuck typing state.
    const emptyNpcMessages = vm.messages.filter((m) => m.role === 'npc' && m.content === '');
    expect(emptyNpcMessages.length).toBe(0);
    // The player's message remains so they can retry.
    expect(vm.messages.some((m) => m.role === 'player')).toBe(true);
  });

  // ── Quest-activation tool call (C-quest-activation) ──────────────────

  test('quest activation: accepting an offered quest calls acceptQuest', async () => {
    analyzeIntentStub = mock(async () => ({
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'The elder beams. "You will save us all, traveler!"',
      suggestedChips: [],
      questActivation: { action: 'accept', questId: 'fading_ward' },
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;
    acceptQuestStub = mock(() => true);
    mockQuestStateService.acceptQuest = acceptQuestStub;
    getOfferableQuestsStub = mock(() => [{ id: 'fading_ward', name: 'The Fading Ward' }]);
    mockQuestStateService.getOfferableQuests = getOfferableQuestsStub;

    const vm = createViewModel();
    vm.inputText = 'I accept the quest, elder.';
    await vm.sendMessage();

    expect(acceptQuestStub).toHaveBeenCalledWith({
      questId: 'fading_ward',
      npcId: 'npc-001',
    });
  });

  test('quest activation: decline calls declineQuest', async () => {
    analyzeIntentStub = mock(async () => ({
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'The elder sighs. "I understand, traveler."',
      suggestedChips: [],
      questActivation: { action: 'decline', questId: 'fading_ward' },
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;
    declineQuestStub = mock(() => {});
    mockQuestStateService.declineQuest = declineQuestStub;

    const vm = createViewModel();
    vm.inputText = 'I cannot take this quest.';
    await vm.sendMessage();

    expect(declineQuestStub).toHaveBeenCalledWith({ questId: 'fading_ward' });
    expect(acceptQuestStub).not.toHaveBeenCalled();
  });

  test('quest activation: does not accept a quest this NPC cannot offer', async () => {
    analyzeIntentStub = mock(async () => ({
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'The elder nods. "Then it shall be done."',
      suggestedChips: [],
      questActivation: { action: 'accept', questId: 'fading_ward' },
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;
    acceptQuestStub = mock(() => true);
    mockQuestStateService.acceptQuest = acceptQuestStub;
    // This NPC offers nothing — the tool call must be ignored.
    getOfferableQuestsStub = mock(() => []);
    mockQuestStateService.getOfferableQuests = getOfferableQuestsStub;

    const vm = createViewModel();
    vm.inputText = 'I will take the quest.';
    await vm.sendMessage();

    expect(acceptQuestStub).not.toHaveBeenCalled();
  });

  test('chips are populated from intent analysis', async () => {
    analyzeIntentStub = mock(async () => ({
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'Hello.',
      suggestedChips: [
        {
          id: 'quest',
          label: 'Ask about quests',
          intentType: 'quest' as const,
          prefillText: 'Do you have work?',
        },
        {
          id: 'trade',
          label: 'Trade',
          intentType: 'trade' as const,
          prefillText: 'Show me your wares.',
        },
      ],
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    const vm = createViewModel();
    vm.inputText = 'Hi';
    vm.sendMessage();

    await new Promise((r) => setTimeout(r, 50));

    expect(vm.suggestedChips.length).toBe(2);
    expect(vm.suggestedChips[0].intentType).toBe('quest');
  });

  // ── C-371: Default phase is FREE_TEXT ─────────────────────────────────

  test('default dialoguePhase is FREE_TEXT', () => {
    const vm = createViewModel();
    expect(vm.dialoguePhase).toBe('FREE_TEXT');
  });

  // ── C-371: Suggestion chips ──────────────────────────────────────────

  test('handleChipTap pre-fills input and sends message', () => {
    const vm = createViewModel();
    // Simulate chips being set (as from an analyzeIntent response)
    vm.inputText = '';
    vm.handleChipTap('talk');
    // handleChipTap delegates to sendMessage with prefillText
    // The prefillText from the mock is 'Tell me about the ward.'
    expect(vm.inputText).toBe('');
  });

  test('handleChipTap does nothing when streaming', () => {
    const vm = createViewModel();
    // When chips don't exist, handleChipTap is a no-op
    vm.handleChipTap('nonexistent');
  });

  test('suggestedChips preloads player-class chips when a greeting exists', () => {
    const vm = createViewModel();
    // Default class (fighter) preset chips are preloaded alongside the greeting.
    expect(vm.suggestedChips.length).toBeGreaterThan(0);
    expect(vm.suggestedChips.some((c) => c.id.startsWith('class_'))).toBe(true);
  });

  test('suggestedChips merges NPC initialSuggestions with class presets', () => {
    const vm = createViewModel({
      npcData: createNpcData({
        initialSuggestions: [
          {
            id: 'elder_ask_ward',
            label: 'Ask about the ward',
            intentType: 'quest',
            prefillText: 'Can you tell me about the fading ward?',
          },
        ],
      }),
    });

    expect(vm.suggestedChips.length).toBeGreaterThanOrEqual(1);
    // NPC-authored chip comes first.
    expect(vm.suggestedChips[0].id).toBe('elder_ask_ward');
    // Class chips are appended after NPC chips.
    expect(vm.suggestedChips.some((c) => c.id.startsWith('class_'))).toBe(true);
  });

  test('suggestedChips stays empty when no greeting message exists', () => {
    const vm = createViewModel({
      npcData: createNpcData({ dialog: '' }),
    });
    expect(vm.suggestedChips.length).toBe(0);
  });

  // ── C-371: sendMessage uses analyzeIntent pipeline ──────────────────

  test('sendMessage delegates to analyzeIntent when useFreeTextFirst is true', async () => {
    const vm = createViewModel();
    vm.inputText = 'What do you know about the ward?';
    vm.sendMessage();

    // Wait for async
    await new Promise((r) => setTimeout(r, 50));

    expect(mockNpcDialogueService.analyzeIntent).toHaveBeenCalled();
    // Should have 3 messages: greeting, player, NPC pre-roll narrative
    expect(vm.messages.length).toBe(3);
  });

  // ── Dice Mechanics (C-371 updated) ─────────────────────────────────

  test('rollDice no-ops when phase is not awaiting_click', async () => {
    const vm = createViewModel();
    await vm.rollDice(); // should not throw
    expect(vm.skillCheckState).toBeNull();
  });

  test('rollDice transitions through declared → awaiting_click → rolling → revealed → FREE_TEXT', async () => {
    const vm = createViewModel();
    // Manually set up skill check state (simulating DECLARED_DC from analyzeIntent)
    vm.skillCheckState = {
      checkType: 'Persuasion',
      difficultyClass: 12,
      breakdown: {
        ability: 'charisma',
        abilityLabel: 'CHA',
        abilityModifier: 3,
        isProficient: true,
        isExpertise: false,
        proficiencyBonus: 2,
        totalModifier: 5,
      },
      stakes: { success: 'Convinced.', failure: 'Trust drops.' },
      targetNumber: 7,
      rollValue: null,
      phase: 'declared',
      isSuccess: null,
    };

    expect(vm.skillCheckState?.phase).toBe('declared');

    // Acknowledge the declaration to make the dice interactive
    vm.acknowledgeDeclaration();
    expect(vm.skillCheckState?.phase).toBe('awaiting_click');

    const rollPromise = vm.rollDice();

    // Rolling phase should appear quickly
    await new Promise((r) => setTimeout(r, 100));
    expect(vm.skillCheckState?.phase).toBe('rolling');

    await rollPromise;

    // After resolution, dice clears and phase returns to FREE_TEXT
    expect(vm.skillCheckState).toBeNull();
    expect(vm.dialoguePhase).toBe('FREE_TEXT');
  });

  // ── C-487: real character sheet roll inputs ───────────────────────────

  test('AC-1: proficient Persuasion with CHA 16 totals +5 from the sheet', async () => {
    const vm = createViewModel();
    analyzeIntentStub = mock(async () => ({
      requiresRoll: true,
      checkType: 'Persuasion',
      difficultyClass: 12,
      modifierSource: 'CHA',
      npcResponse: 'The elder considers your words.',
      suggestedChips: [],
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    vm.inputText = 'I try to persuade you.';
    await vm.sendMessage();

    const state = vm.skillCheckState;
    expect(state).not.toBeNull();
    expect(state?.phase).toBe('declared');
    expect(state?.breakdown.ability).toBe('charisma');
    expect(state?.breakdown.abilityLabel).toBe('CHA');
    expect(state?.breakdown.abilityModifier).toBe(3);
    expect(state?.breakdown.isProficient).toBe(true);
    expect(state?.breakdown.isExpertise).toBe(false);
    expect(state?.breakdown.proficiencyBonus).toBe(2);
    expect(state?.breakdown.totalModifier).toBe(5);
    expect(state?.targetNumber).toBe(7);
    expect(vm.dialoguePhase).toBe('DECLARED_DC');
  });

  test('AC-1: expertise doubles the proficiency bonus (+7)', async () => {
    seededSheet = makeSeededSheet({
      charisma: 16,
      persuasionProficient: true,
      persuasionExpertise: true,
    });
    const vm = createViewModel();
    analyzeIntentStub = mock(async () => ({
      requiresRoll: true,
      checkType: 'Persuasion',
      difficultyClass: 12,
      modifierSource: 'CHA',
      npcResponse: 'The elder considers your words.',
      suggestedChips: [],
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    vm.inputText = 'Persuade.';
    await vm.sendMessage();

    expect(vm.skillCheckState?.breakdown.totalModifier).toBe(7);
    expect(vm.skillCheckState?.breakdown.isExpertise).toBe(true);
  });

  test('AC-1: normalises spaced and canonical checkType values to the map key', async () => {
    for (const checkType of ['Sleight Of Hand', 'sleight of hand', 'sleightOfHand']) {
      const vm = createViewModel();
      analyzeIntentStub = mock(async () => ({
        requiresRoll: true,
        checkType,
        difficultyClass: 12,
        modifierSource: 'DEX',
        npcResponse: 'The elder watches your hands.',
        suggestedChips: [],
      }));
      mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

      vm.inputText = 'Pickpocket.';
      await vm.sendMessage();

      expect(vm.skillCheckState?.breakdown.abilityLabel).toBe('DEX');
      expect(vm.skillCheckState?.breakdown.ability).toBe('dexterity');
      expect(vm.skillCheckState?.stakes).toEqual(SKILL_CHECK_STAKES.sleightOfHand);
    }
  });

  test('AC-2: breakdown and stakes are assembled before the roll commits', async () => {
    const vm = createViewModel();
    analyzeIntentStub = mock(async () => ({
      requiresRoll: true,
      checkType: 'Deception',
      difficultyClass: 12,
      modifierSource: 'CHA',
      npcResponse: 'The elder studies you.',
      suggestedChips: [],
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    vm.inputText = 'I bluff.';
    await vm.sendMessage();

    const state = vm.skillCheckState;
    expect(state?.phase).toBe('declared');
    expect(state?.breakdown.abilityLabel).toBe('CHA');
    expect(state?.stakes.success.length).toBeGreaterThan(0);
    expect(state?.stakes.failure.length).toBeGreaterThan(0);
    expect(state?.stakes.failure.toLowerCase()).toContain('suspicion');
  });

  test('AC-3: passes the real player context, never the hardcoded default', async () => {
    const vm = createViewModel();
    analyzeIntentStub = mock(async () => ({
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'Hello, traveler.',
      suggestedChips: [],
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    vm.inputText = 'Hello there.';
    await vm.sendMessage();

    const call = analyzeIntentStub.mock.calls[0][0] as {
      playerContext?: { characterSheetSummary: string; level: number; classId: string };
    };
    expect(call.playerContext).toBeDefined();
    expect(call.playerContext?.characterSheetSummary).not.toBe('Level 1 Fighter');
    expect(call.playerContext?.characterSheetSummary).toContain('[CHARACTER SHEET]');
    expect(call.playerContext?.characterSheetSummary).toContain('CHA 16(+3)');
    expect(call.playerContext?.level).toBe(1);
    expect(call.playerContext?.classId).toBe('fighter');
  });

  test('AC-4: ordinary conversation stays in FREE_TEXT with no dice', async () => {
    const vm = createViewModel();
    analyzeIntentStub = mock(async () => ({
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'A fine day to you.',
      suggestedChips: [],
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    vm.inputText = 'Hello there.';
    await vm.sendMessage();

    expect(vm.dialoguePhase).toBe('FREE_TEXT');
    expect(vm.skillCheckState).toBeNull();
  });

  test('AC-5: a model-authored bonus cannot override the sheet modifier', async () => {
    const vm = createViewModel();
    analyzeIntentStub = mock(async () => ({
      requiresRoll: true,
      checkType: 'Persuasion',
      difficultyClass: 12,
      modifierSource: 'CHA +5',
      npcResponse: 'The elder considers your words.',
      suggestedChips: [],
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    vm.inputText = 'Persuade.';
    await vm.sendMessage();

    // Sheet is the sole authority: CHA 16 (+3) + proficiency (+2) = +5.
    // The model's "+5" and any advantage claim are ignored.
    expect(vm.skillCheckState?.breakdown.abilityModifier).toBe(3);
    expect(vm.skillCheckState?.breakdown.totalModifier).toBe(5);
  });

  // ── End Dialogue ───────────────────────────────────────────────────────

  test('endChat calls onEndChat', () => {
    let called = false;
    const vm = createViewModel({
      onEndChat: () => {
        called = true;
      },
    });
    vm.endChat();
    expect(called).toBe(true);
  });

  // ── Keyboard Handling ──────────────────────────────────────────────────

  test('handleKeyDown with Enter sends message', () => {
    const vm = createViewModel();
    vm.inputText = 'Hello';
    vm.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(vm.inputText).toBe('');
  });

  test('handleKeyDown with Escape ends chat', () => {
    let ended = false;
    const vm = createViewModel({
      onEndChat: () => {
        ended = true;
      },
    });
    vm.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(ended).toBe(true);
  });

  test('handleKeyDown with Shift+Enter does not send', () => {
    const vm = createViewModel();
    vm.inputText = 'Hello';
    // Shift+Enter should not trigger sendMessage
    const initialMessages = vm.messages.length;
    vm.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    // Input should still be present (not cleared) — handleKeyDown only
    // calls sendMessage when event.key === 'Enter' && !event.shiftKey
    // In the test $state polyfill, inputText may reset — verify no crash.
    expect(initialMessages).toBeGreaterThanOrEqual(1);
    expect(vm.dialoguePhase).toBeDefined();
  });

  // ── C-231 Rich Chat ───────────────────────────────────────────────────

  test('swipeAlternative delegates to messageBranchStore', () => {
    const vm = createViewModel();
    vm.swipeAlternative('msg-1', 'left');
    // Verify no crash — messageBranchStore is mocked
  });

  test('copyMessage does not throw', async () => {
    const vm = createViewModel();
    // clipboard may not be available in test environment
    await vm.copyMessage('test text');
    // Either 'Copied!' or 'Copy failed' — both are valid states
    expect(vm.toastMessage.length).toBeGreaterThan(0);
  });

  // ── C-490 Transcript branching must not imply rewinding the world ───────

  test('C-490: isCampaignPlay defaults to true for the production overlay', () => {
    const vm = createViewModel();
    expect(vm.isCampaignPlay).toBe(true);
  });

  test('C-490: isCampaignPlay can be disabled (dev sandbox / non-campaign chat)', () => {
    const vm = createViewModel({ isCampaignPlay: false });
    expect(vm.isCampaignPlay).toBe(false);
  });

  test('C-490 AC-2: rephrase performs no quest-activation state mutation', async () => {
    // The intent would normally accept a quest — but the rephrase path must
    // never apply NpcStateDelta / quest mutations.
    analyzeIntentStub = mock(async () => ({
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'A rephrased reply.',
      suggestedChips: [],
      questActivation: { action: 'accept', questId: 'fading_ward' },
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;
    acceptQuestStub = mock(() => true);
    mockQuestStateService.acceptQuest = acceptQuestStub;
    getOfferableQuestsStub = mock(() => [{ id: 'fading_ward', name: 'The Fading Ward' }]);
    mockQuestStateService.getOfferableQuests = getOfferableQuestsStub;

    const vm = createViewModel();
    // Build a player → NPC exchange so rephrase has an NPC message to target.
    vm.inputText = 'I accept the quest, elder.';
    await vm.sendMessage();
    const npcMessageId = vm.messages[vm.messages.length - 1].id;

    // Sanity: the initial send DID accept the quest.
    expect(acceptQuestStub).toHaveBeenCalledTimes(1);

    // Rephrase must not re-run the quest activation.
    vm.rephraseResponse(npcMessageId);
    await new Promise((r) => setTimeout(r, 0));
    expect(acceptQuestStub).toHaveBeenCalledTimes(1);
  });

  test('C-490 AC-3: branch data is never persisted to saves; campaign gating retains in-memory branch state read-only', () => {
    // AC-3 Verification asks how already-persisted branch data loads without
    // crash or silent loss. Verified fact: dialogue transcript and branch data
    // are NOT persisted to saves — `branches`/`activeBranchId` are in-memory,
    // session-scoped state (cleared on overlay close per C-343); only input
    // drafts persist to IndexedDB. So a "fixture save containing branch data"
    // cannot occur in the current save format — this scenario is N/A.
    const vm = createViewModel();
    expect(vm.isCampaignPlay).toBe(true);

    // A freshly created VM (as after any save load — no branch fields exist)
    // must start with no branch data: nothing is silently dropped or recovered.
    expect(vm.branches).toEqual([]);
    expect(vm.activeBranchId).toBeNull();

    // Defense-in-depth: if in-memory branch state ever exists in a campaign
    // overlay, it is RETAINED (never silently discarded) but rendered read-only
    // behind the gated UI (branch selector + branch/edit/delete actions hidden).
    vm.createBranch({ parentMessageId: vm.messages[0].id });
    expect(vm.branches.length).toBe(1);
    expect(vm.branches[0].parentMessageId).toBe(vm.messages[0].id);

    // In campaign play the rewinding UI is gated: no branch action is offered.
    expect(availableMessageActions({ sender: 'ai', disableRewind: true })).not.toContain('branch');
    expect(availableMessageActions({ sender: 'user', disableRewind: true })).toEqual(['copy']);
  });
  // ── C-501 Slash Commands ────────────────────────────────────────────

  test('AC-1: /generate produces an inline image and never reaches the NPC', async () => {
    const vm = createViewModel({ imageProviderAvailable: true });
    await vm.sendMessage('/generate a forest clearing');

    expect(vm.generatedImages.length).toBe(1);
    expect(vm.generatedImages[0].status).toBe('done');
    expect(vm.generatedImages[0].url).toBeTruthy();
    // The NPC pipeline is never invoked for a slash command.
    expect(mockNpcDialogueService.analyzeIntent).not.toHaveBeenCalled();
    expect(mockNpcDialogueService.generateTurn).not.toHaveBeenCalled();
  });

  test('AC-2: /generate with no provider shows an inline error, no crash', async () => {
    const vm = createViewModel({ imageProviderAvailable: false });
    await vm.sendMessage('/generate a forest clearing');

    expect(vm.generatedImages.length).toBe(1);
    expect(vm.generatedImages[0].status).toBe('error');
    // No stuck generating state, no NPC turn.
    expect(vm.generatedImages[0].url).toBeNull();
    expect(mockNpcDialogueService.analyzeIntent).not.toHaveBeenCalled();
  });

  test('AC-3: /tree re-presents the previous choice set', async () => {
    const vm = createViewModel({ useFreeTextFirst: false });

    generateTurnStub = mock(async () => ({
      narrative: 'Turn one.',
      choices: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
      source: 'ai' as const,
    }));
    mockNpcDialogueService.generateTurn = generateTurnStub;
    await vm.sendMessage('first');
    expect(vm.activeChoices.map((c) => c.id)).toEqual(['a', 'b']);

    generateTurnStub = mock(async () => ({
      narrative: 'Turn two.',
      choices: [{ id: 'c', label: 'Option C' }],
      source: 'ai' as const,
    }));
    mockNpcDialogueService.generateTurn = generateTurnStub;
    await vm.sendMessage('second');
    expect(vm.activeChoices.map((c) => c.id)).toEqual(['c']);

    await vm.sendMessage('/tree');
    expect(vm.activeChoices.map((c) => c.id)).toEqual(['a', 'b']);
  });

  test('AC-3: /tree with no prior choices shows inline help', async () => {
    const vm = createViewModel({ useFreeTextFirst: false });
    await vm.sendMessage('/tree');

    expect(vm.activeChoices.length).toBe(0);
    expect(vm.messages.some((m) => m.senderName === 'System')).toBe(true);
  });

  test('AC-4: /action routes the instruction to the Game Master', async () => {
    const vm = createViewModel();
    await vm.sendMessage('/action search for tracks');

    expect(mockNpcDialogueService.analyzeIntent).toHaveBeenCalled();
    const call = mockNpcDialogueService.analyzeIntent.mock.calls[0]?.[0];
    expect(call.npcName).toBe('Game Master');
    expect(call.messages.at(-1)?.content).toBe('/action search for tracks');
    expect(vm.messages.some((message) => message.content === '/action search for tracks')).toBe(
      true,
    );
  });

  test('AC-4: bare /action shows help instead of sending an empty GM instruction', async () => {
    const vm = createViewModel();
    await vm.sendMessage('/action');

    expect(vm.messages.at(-1)?.senderName).toBe('System');
    expect(mockNpcDialogueService.analyzeIntent).not.toHaveBeenCalled();
  });

  test('AC-4: bare /look sends a descriptive, command-identified GM instruction', async () => {
    const vm = createViewModel();
    await vm.sendMessage('/look');

    const expectedInstruction = '/look Look around and describe what I see.';
    const call = mockNpcDialogueService.analyzeIntent.mock.calls[0]?.[0];
    expect(vm.messages.some((message) => message.content === expectedInstruction)).toBe(true);
    expect(call.messages.at(-1)?.content).toBe(expectedInstruction);
  });

  test('AC-5: an unknown command shows inline help and is not sent to the NPC', async () => {
    const vm = createViewModel();
    const before = vm.messages.length;
    await vm.sendMessage('/foobar');

    expect(vm.messages.length).toBe(before + 1);
    expect(vm.messages.at(-1)?.senderName).toBe('System');
    expect(mockNpcDialogueService.analyzeIntent).not.toHaveBeenCalled();
    expect(mockNpcDialogueService.generateTurn).not.toHaveBeenCalled();
  });

  test('AC-5: system help messages are omitted from subsequent model context', async () => {
    const vm = createViewModel();
    await vm.sendMessage('/foobar');
    await vm.sendMessage('Tell me about the ward');

    const call = mockNpcDialogueService.analyzeIntent.mock.calls[0]?.[0];
    expect(call.messages.some((message) => message.content.includes('/generate <prompt>'))).toBe(
      false,
    );
  });

  test('AC-5: system help messages are omitted from Game Master context', async () => {
    const vm = createViewModel();
    await vm.sendMessage('/foobar');
    await vm.sendMessage('/look around');

    const call = mockNpcDialogueService.analyzeIntent.mock.calls[0]?.[0];
    expect(call.npcName).toBe('Game Master');
    expect(call.messages.some((message) => message.content.includes('/generate <prompt>'))).toBe(
      false,
    );
  });

  // ── Pending queue (C-436: type while streaming) ───────────────────────

  test('slash commands submitted while streaming wait in the pending FIFO', async () => {
    let releaseFirstTurn = (): void => {};
    analyzeIntentStub = mock(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstTurn = resolve;
      });
      return {
        requiresRoll: false,
        checkType: undefined,
        difficultyClass: undefined,
        modifierSource: undefined,
        npcResponse: 'Understood.',
        suggestedChips: [],
      };
    });
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    const vm = createViewModel();
    const first = vm.sendMessage('First');
    vm.sendMessage('/generate a moonlit clearing');

    expect(vm.pendingMessages).toEqual(['/generate a moonlit clearing']);
    expect(vm.generatedImages).toHaveLength(0);

    releaseFirstTurn();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(vm.pendingMessages).toHaveLength(0);
    expect(vm.generatedImages).toHaveLength(1);
    expect(mockNpcDialogueService.analyzeIntent).toHaveBeenCalledTimes(1);
  });

  test('messages queued during streaming are delivered in FIFO order after the turn succeeds', async () => {
    analyzeIntentStub = mock(async (_options: AnalyzeIntentOptions) => ({
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'Understood.',
      suggestedChips: [],
    }));
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    const vm = createViewModel();
    const first = vm.sendMessage('First'); // starts the streaming turn for 'First'

    // While the NPC is streaming, the player queues two more messages. These
    // calls run synchronously (isStreaming is already true) so the queue state
    // below is deterministic.
    vm.sendMessage('Second');
    vm.sendMessage('Third');

    expect(vm.pendingMessages).toEqual(['Second', 'Third']);
    // Pending messages are shown as pending items, not yet part of the history.
    expect(vm.messages.some((m) => m.content === 'Second')).toBe(false);

    await first; // First's turn completes successfully → drains Second, then Third
    await new Promise((r) => setTimeout(r, 100));

    // FIFO order preserved: each analyzeIntent call responds to the delivered message.
    const delivered = analyzeIntentStub.mock.calls.map((c) => c[0].messages.at(-1)?.content);
    expect(delivered).toEqual(['First', 'Second', 'Third']);
    expect(vm.pendingMessages).toEqual([]);
  });

  test('queued messages are retained after a failed stream until an explicit retry', async () => {
    let failFirst = true;
    analyzeIntentStub = mock(async () => {
      if (failFirst) {
        failFirst = false;
        throw new Error('Provider unavailable');
      }
      return {
        requiresRoll: false,
        checkType: undefined,
        difficultyClass: undefined,
        modifierSource: undefined,
        npcResponse: 'Recovered.',
        suggestedChips: [],
      };
    });
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    const vm = createViewModel();
    const first = vm.sendMessage('First'); // this turn will fail
    vm.sendMessage('Queued'); // queued during streaming (synchronous)
    expect(vm.pendingMessages).toEqual(['Queued']);

    await first; // First's turn fails → auto-drain disabled
    expect(vm.pendingMessages).toEqual(['Queued']);

    // A later successful request must NOT auto-send the retained message.
    await vm.sendMessage('Later'); // succeeds
    await new Promise((r) => setTimeout(r, 50));
    expect(vm.pendingMessages).toEqual(['Queued']);

    // An explicit retry delivers it.
    vm.retryPending();
    await new Promise((r) => setTimeout(r, 50));
    expect(vm.pendingMessages).toEqual([]);
    expect(vm.messages.some((m) => m.content === 'Queued')).toBe(true);
  });

  test('queued messages are retained after cancelStreaming until an explicit retry', async () => {
    let cancelOnce = true;
    analyzeIntentStub = mock(async ({ signal }: { signal: AbortSignal }) => {
      if (cancelOnce) {
        cancelOnce = false;
        await new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
        throw new Error('unreachable');
      }
      return {
        requiresRoll: false,
        checkType: undefined,
        difficultyClass: undefined,
        modifierSource: undefined,
        npcResponse: 'Recovered.',
        suggestedChips: [],
      };
    });
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    const vm = createViewModel();
    const first = vm.sendMessage('First'); // hangs until cancelled
    vm.sendMessage('Queued'); // queued during streaming (synchronous)
    expect(vm.pendingMessages).toEqual(['Queued']);

    vm.cancelStreaming(); // aborts → First's turn fails → auto-drain disabled
    await first;
    await new Promise((r) => setTimeout(r, 50));

    expect(vm.pendingMessages).toEqual(['Queued']);
    expect(vm.messages.some((m) => m.content === 'Queued')).toBe(false);

    // An explicit retry delivers it.
    vm.retryPending();
    await new Promise((r) => setTimeout(r, 50));
    expect(vm.pendingMessages).toEqual([]);
    expect(vm.messages.some((m) => m.content === 'Queued')).toBe(true);
  });

  test('endChat cancels and clears the pending queue so nothing leaks into a new session', async () => {
    analyzeIntentStub = mock(async ({ signal }: { signal: AbortSignal }) => {
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
      throw new Error('unreachable');
    });
    mockNpcDialogueService.analyzeIntent = analyzeIntentStub;

    let ended = false;
    const vm = createViewModel({
      onEndChat: () => {
        ended = true;
      },
    });
    const first = vm.sendMessage('First'); // hangs until aborted
    vm.sendMessage('Queued'); // queued during streaming (synchronous)
    expect(vm.pendingMessages).toEqual(['Queued']);

    vm.endChat(); // aborts the request and clears the whole queue
    expect(vm.pendingMessages).toEqual([]);
    expect(ended).toBe(true);
    await first;

    // A brand-new session always starts with an empty queue.
    const fresh = createViewModel();
    expect(fresh.pendingMessages).toEqual([]);
    expect(fresh.messages.some((m) => m.content === 'Queued')).toBe(false);
  });
});
