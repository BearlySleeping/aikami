// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.dev.test.ts
//
// Unit tests for DialogueDevViewModel (C-162 dev sandbox controls).
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.dev.test.ts

// biome-ignore-all lint/style/useNamingConvention: Mock object properties mirror PascalCase class names from @aikami/frontend-services
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived, $effect are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock: imageGenerationService
// ---------------------------------------------------------------------------

let mockImageGenShouldThrow: Error | null = null;
let mockImageGenResult: { url: string; isDemo: boolean } = {
  url: 'blob:https://example.com/generated-image',
  isDemo: false,
};
let mockImageGenIsGenerating = false;
let mockImageGenIsReady = true;

const IMAGE_GEN_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts';

mock.module(IMAGE_GEN_SVC_PATH, () => ({
  imageGenerationService: {
    get isGenerating() {
      return mockImageGenIsGenerating;
    },
    get isReady() {
      return mockImageGenIsReady;
    },
    generateImage: mock(async () => {
      if (mockImageGenShouldThrow) {
        throw mockImageGenShouldThrow;
      }
      return mockImageGenResult;
    }),
    isDemoMode: mock(() => mockImageGenResult.isDemo),
    checkpoints: [],
    selectedCheckpoint: '',
  },
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Mock: $services barrel (diceService, textGenerationService, ttsService, etc.)
// ---------------------------------------------------------------------------

let mockTextGenStreamChunks: string[] = [];
let mockTextGenShouldThrow: Error | null = null;

const textGenStreamChat = async (options: { onChunk: (text: string) => void }) => {
  if (mockTextGenShouldThrow) {
    throw mockTextGenShouldThrow;
  }
  for (const chunk of mockTextGenStreamChunks) {
    options.onChunk(chunk);
  }
};

// Mock game service files BEFORE $services so that barrel evaluation
// can resolve GM service imports (gm_prompt_service imports these directly).
const COMBAT_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/game/combat_service.svelte.ts';
mock.module(COMBAT_PATH, () => ({
  combatService: { enemyName: 'Unknown Enemy', enemyHp: 0, enemyMaxHp: 0 },
}));

const GAME_STATE_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts';
mock.module(GAME_STATE_PATH, () => ({
  gameStateService: { worldGenOutput: undefined, quests: [], characterSheetSummary: undefined },
}));

const TIME_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/game/time_service.svelte.ts';
mock.module(TIME_PATH, () => ({
  timeService: { gameHour: 12, gameMinute: 0, rainIntensity: 0 },
}));

mock.module('$services', () => ({
  textGenerationService: {
    streamChat: textGenStreamChat,
    extractStructure: mock(async () => ({})),
    cancelAll: mock(() => {}),
  },
  diceService: {
    rollD20: (_modifier: number) => ({ natural: 14, total: 14 }),
  },
  imageGenerationService: {
    get isGenerating() {
      return mockImageGenIsGenerating;
    },
    get isReady() {
      return mockImageGenIsReady;
    },
    generateImage: mock(async () => {
      if (mockImageGenShouldThrow) {
        throw mockImageGenShouldThrow;
      }
      return mockImageGenResult;
    }),
    isDemoMode: mock(() => mockImageGenResult.isDemo),
    checkpoints: [],
    selectedCheckpoint: '',
  },
  routerService: {},
  SentenceBoundaryChunker: class {
    feed(_text: string) {}
    close() {}
    onSentence(_handler: (event: { sentence: string }) => void) {}
  },
  ttsService: {
    synthesize: mock(() => {}),
    initialize: mock(async () => {}),
    selectedVoice: 'af_bella',
    status: 'uninitialized',
  },
  gmPromptService: {
    assemblePrompt: mock(() => 'Mock GM system prompt for testing'),
  },
  narrativeDirectorService: {
    isRunning: false,
    start: mock(() => {}),
    stop: mock(() => {}),
    pushStory: mock(async () => {}),
  },
  sessionSummaryService: {
    currentSummary: null,
    isGenerating: false,
    generateSummary: mock(async () => ({})),
    clearSummary: mock(() => {}),
  },
  combatService: {
    enemyName: 'Unknown Enemy',
    enemyHp: 0,
    enemyMaxHp: 0,
  },
  gameStateService: {
    worldGenOutput: undefined,
    quests: [],
    characterSheetSummary: undefined,
  },
  timeService: {
    gameHour: 12,
    gameMinute: 0,
    rainIntensity: 0,
  },
}));

// ---------------------------------------------------------------------------
// Mock: $lib/services/ai/clients (OllamaClient)
// ---------------------------------------------------------------------------

const createMockOllamaClient = (): Record<string, unknown> => {
  const streamChatSpy = mock(async function* (this: unknown, _prompt: string) {
    for (const chunk of [] as string[]) {
      yield chunk;
    }
  });

  return {
    OllamaClient: class {
      streamChat = streamChatSpy;
    },
    OllamaConnectionError: class extends Error {
      constructor(baseUrl: string) {
        super(`Ollama connection refused at ${baseUrl}`);
        this.name = 'OllamaConnectionError';
      }
    },
    OllamaTimeoutError: class extends Error {
      constructor(timeoutMs: number) {
        super(`Ollama request timed out after ${timeoutMs}ms`);
        this.name = 'OllamaTimeoutError';
      }
    },
    OllamaStreamError: class extends Error {
      constructor(status: number, msg: string) {
        super(`Ollama stream error (${status}): ${msg}`);
        this.name = 'OllamaStreamError';
      }
    },
  };
};

mock.module('$lib/services/ai/clients/index.ts', () => createMockOllamaClient());

// ---------------------------------------------------------------------------
// Mock: URL and setTimeout globals (not available in Bun)
// ---------------------------------------------------------------------------

const revokedUrls: string[] = [];
const pendingTimeouts: Array<() => void> = [];

(globalThis as Record<string, unknown>).URL = {
  revokeObjectURL: (url: string) => {
    revokedUrls.push(url);
  },
  createObjectURL: (_blob: unknown) => 'blob:mock://object-url',
};

// Mock setTimeout only for the 30s auto-revoke delay — all other
// setTimeout calls (1500ms roll animation, 800ms mock latency, etc.)
// pass through to the real implementation so async promises resolve.
const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
(globalThis as Record<string, unknown>).setTimeout = (fn: () => void, delay: number) => {
  if (delay === 30_000) {
    pendingTimeouts.push(fn);
    return pendingTimeouts.length - 1;
  }
  return originalSetTimeout(fn, delay as Parameters<typeof setTimeout>[1]);
};
(globalThis as Record<string, unknown>).clearTimeout = () => {};

// ---------------------------------------------------------------------------
// Import (after mocks registered)
// ---------------------------------------------------------------------------

import {
  type DevInteractionMode,
  type DevNpcPreset,
  DialogueDevViewModel,
} from './dialogue_overlay_view_model.dev.svelte';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createNpcData = (
  overrides?: Partial<{ npcId: string; npcName: string; dialog: string }>,
) => ({
  npcId: 'sandbox-elder',
  npcName: 'Elder Thrain',
  dialog: 'Ah, a traveler!',
  personaId: 'sage',
  ...overrides,
});

const createDevVM = (options?: {
  initialDiceOutcome?: 'random' | 'always_succeed' | 'always_fail';
  initialUseMockAi?: boolean;
  initialNpcPreset?: DevNpcPreset;
  // C-371: freeTextFirst is the only supported interaction mode.
  initialInteractionMode?: DevInteractionMode;
}) => {
  return new DialogueDevViewModel({
    className: 'TestDialogueDevVM',
    npcData: createNpcData(),
    onEndChat: () => {},
    initialDiceOutcome: options?.initialDiceOutcome,
    initialUseMockAi: options?.initialUseMockAi,
    initialNpcPreset: options?.initialNpcPreset,
    initialInteractionMode: options?.initialInteractionMode,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DialogueDevViewModel', () => {
  beforeEach(() => {
    mockTextGenStreamChunks = [];
    mockTextGenShouldThrow = null;
    mockImageGenShouldThrow = null;
    mockImageGenResult = { url: 'blob:https://example.com/generated-image', isDemo: false };
    mockImageGenIsGenerating = false;
    mockImageGenIsReady = true;
    revokedUrls.length = 0;
    pendingTimeouts.length = 0;
  });

  afterEach(() => {
    mock.module('$lib/services/ai/clients/index.ts', () => createMockOllamaClient());
  });

  // ── Initial state ────────────────────────────────────────────────────

  test('defaults: diceOutcome=random, useMockAi=true, interactionMode=freeTextFirst', () => {
    const vm = createDevVM();
    expect(vm.diceOutcome).toBe('random');
    expect(vm.useMockAi).toBe(true);
    expect(vm.mockNpcPreset).toBe('sage');
    // C-371: freeTextFirst is the only supported interaction mode.
    expect(vm.interactionMode).toBe('freeTextFirst');
    expect(vm.dialoguePhase).toBe('FREE_TEXT');
    expect(vm.autoGenerateImage).toBe(false);
    expect(vm.generatedImages).toEqual([]);
  });

  test('freeTextFirst interaction mode keeps dialoguePhase at FREE_TEXT on init', () => {
    const vm = createDevVM({ initialInteractionMode: 'freeTextFirst' });
    expect(vm.interactionMode).toBe('freeTextFirst');
    expect(vm.dialoguePhase).toBe('FREE_TEXT');
  });

  // ── setDiceOutcome ───────────────────────────────────────────────────

  test('setDiceOutcome changes mode', () => {
    const vm = createDevVM();
    vm.setDiceOutcome('always_succeed');
    expect(vm.diceOutcome).toBe('always_succeed');

    vm.setDiceOutcome('always_fail');
    expect(vm.diceOutcome).toBe('always_fail');

    vm.setDiceOutcome('random');
    expect(vm.diceOutcome).toBe('random');
  });

  // ── setUseMockAi ─────────────────────────────────────────────────────

  test('setUseMockAi toggles mock AI', () => {
    const vm = createDevVM();
    expect(vm.useMockAi).toBe(true);

    vm.setUseMockAi(false);
    expect(vm.useMockAi).toBe(false);

    vm.setUseMockAi(true);
    expect(vm.useMockAi).toBe(true);
  });

  // ── setMockNpcPreset ─────────────────────────────────────────────────

  test('setMockNpcPreset changes NPC name and resets messages', () => {
    const vm = createDevVM();
    expect(vm.npcName).toBe('Elder Thrain');
    expect(vm.messages.length).toBe(1);

    vm.setMockNpcPreset('guard');
    expect(vm.mockNpcPreset).toBe('guard');
    expect(vm.npcName).toBe('Guard Captain Voss');
    // Messages are reset with the new NPC greeting
    expect(vm.messages.length).toBe(1);
    expect(vm.messages[0].content).toContain('Halt!');
  });

  test('setMockNpcPreset to blacksmith shows correct name', () => {
    const vm = createDevVM();
    vm.setMockNpcPreset('blacksmith');
    expect(vm.npcName).toBe('Blacksmith Dorin');
    expect(vm.messages[0].content).toContain('Clang!');
  });

  test('setMockNpcPreset to bandit shows correct name', () => {
    const vm = createDevVM();
    vm.setMockNpcPreset('bandit');
    expect(vm.npcName).toBe('Scarred Bandit');
  });

  test('setMockNpcPreset to merchant shows correct name', () => {
    const vm = createDevVM();
    vm.setMockNpcPreset('merchant');
    expect(vm.npcName).toBe('Merchant Lysander');
  });

  // ── setInteractionMode ───────────────────────────────────────────────

  test('setInteractionMode only supports freeTextFirst (C-371)', () => {
    const vm = createDevVM();
    expect(vm.interactionMode).toBe('freeTextFirst');
    expect(vm.dialoguePhase).toBe('FREE_TEXT');

    vm.setInteractionMode('freeTextFirst');
    expect(vm.interactionMode).toBe('freeTextFirst');
    expect(vm.dialoguePhase).toBe('FREE_TEXT');
    expect(vm.inputText).toBe('');
  });

  // ── setAutoGenerateImage ─────────────────────────────────────────────

  test('setAutoGenerateImage toggles flag', () => {
    const vm = createDevVM();
    expect(vm.autoGenerateImage).toBe(false);

    vm.setAutoGenerateImage(true);
    expect(vm.autoGenerateImage).toBe(true);

    vm.setAutoGenerateImage(false);
    expect(vm.autoGenerateImage).toBe(false);
  });

  // ── generateSceneImage ───────────────────────────────────────────────

  test('generateSceneImage records generated image on success', async () => {
    const vm = createDevVM();
    await vm.generateSceneImage();

    expect(vm.generatedImages).toHaveLength(1);
    expect(vm.generatedImages[0].url).toBe('blob:https://example.com/generated-image');
    expect(vm.generatedImages[0].status).toBe('done');
  });

  test('generateSceneImage records error status on failure', async () => {
    mockImageGenShouldThrow = new Error('ComfyUI connection refused');

    const vm = createDevVM();
    await vm.generateSceneImage();

    expect(vm.generatedImages).toHaveLength(1);
    expect(vm.generatedImages[0].status).toBe('error');
    expect(vm.generatedImages[0].url).toBeNull();
  });

  test('generateSceneImage skips when imageGenerationService is busy', async () => {
    mockImageGenIsGenerating = true;
    mockImageGenResult = {
      url: 'blob:https://example.com/should-not-appear',
      isDemo: false,
    };

    const vm = createDevVM();
    await vm.generateSceneImage();

    // Should have skipped — no image record created.
    expect(vm.generatedImages).toHaveLength(0);
  });

  // ── rollDice with controlled outcomes ────────────────────────────────

  test('rollDice with always_succeed always passes the check', async () => {
    const vm = createDevVM({ initialDiceOutcome: 'always_succeed' });
    // Manually set up the dice state (simulating selectAction('persuasion'))
    (vm as Record<string, unknown>).skillCheckState = {
      checkType: 'Persuasion',
      difficultyClass: 12,
      rollValue: null,
      phase: 'awaiting_click',
      isSuccess: null,
    };

    const rollPromise = vm.rollDice();

    // Wait for rolling → reveal
    await new Promise<void>((resolve) => setTimeout(resolve, 1600));
    expect(vm.skillCheckState?.phase).toBe('revealed');
    expect(vm.skillCheckState?.rollValue).toBe(12); // DC = 12, always_succeed rolls exactly DC
    expect(vm.skillCheckState?.isSuccess).toBe(true);

    await rollPromise;
    expect(vm.skillCheckState).toBeNull();
  });

  test('rollDice with always_fail always misses the check', async () => {
    const vm = createDevVM({ initialDiceOutcome: 'always_fail' });
    (vm as Record<string, unknown>).skillCheckState = {
      checkType: 'Intimidation',
      difficultyClass: 14,
      rollValue: null,
      phase: 'awaiting_click',
      isSuccess: null,
    };

    const rollPromise = vm.rollDice();

    await new Promise<void>((resolve) => setTimeout(resolve, 1600));
    expect(vm.skillCheckState?.phase).toBe('revealed');
    expect(vm.skillCheckState?.rollValue).toBe(13); // DC-1 = 13
    expect(vm.skillCheckState?.isSuccess).toBe(false);

    await rollPromise;
    expect(vm.skillCheckState).toBeNull();
  });

  test('rollDice with always_fail handles DC=1 edge case', async () => {
    const vm = createDevVM({ initialDiceOutcome: 'always_fail' });
    (vm as Record<string, unknown>).skillCheckState = {
      checkType: 'Stealth',
      difficultyClass: 1,
      rollValue: null,
      phase: 'awaiting_click',
      isSuccess: null,
    };

    const rollPromise = vm.rollDice();

    await new Promise<void>((resolve) => setTimeout(resolve, 1600));
    // DC=1, DC-1=0, but min is 1
    expect(vm.skillCheckState?.rollValue).toBe(1);
    expect(vm.skillCheckState?.isSuccess).toBe(true); // 1 >= 1 is a pass

    await rollPromise;
  });

  // ── Mock skill check appends persona narrative ───────────────────────

  test('mock skill check appends narrative message on success', async () => {
    const vm = createDevVM({ initialDiceOutcome: 'always_succeed' });
    (vm as Record<string, unknown>).skillCheckState = {
      checkType: 'Persuasion',
      difficultyClass: 12,
      rollValue: null,
      phase: 'awaiting_click',
      isSuccess: null,
    };

    const messagesBefore = vm.messages.length;

    const rollPromise = vm.rollDice();

    // Wait for mock resolution (~800ms simulated latency + ~1.5s animation + ~1s reveal)
    await rollPromise;
    // Give extra time for the mock resolution to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(vm.messages.length).toBeGreaterThan(messagesBefore);
    const lastMessage = vm.messages[vm.messages.length - 1];
    expect(lastMessage.role).toBe('npc');
    // C-371: mock narratives are plain persona lines (no dev tag).
    expect(lastMessage.content.length).toBeGreaterThan(0);
  });

  test('mock skill check with always_fail appends a failure narrative', async () => {
    const vm = createDevVM({ initialDiceOutcome: 'always_fail' });
    (vm as Record<string, unknown>).skillCheckState = {
      checkType: 'Intimidation',
      difficultyClass: 14,
      rollValue: null,
      phase: 'awaiting_click',
      isSuccess: null,
    };

    const messagesBefore = vm.messages.length;
    const rollPromise = vm.rollDice();
    await rollPromise;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(vm.messages.length).toBeGreaterThan(messagesBefore);
    const lastMessage = vm.messages[vm.messages.length - 1];
    expect(lastMessage.role).toBe('npc');
    expect(lastMessage.content.length).toBeGreaterThan(0);
  });

  // ── NPC persona switching keeps mock narratives matching ────────────

  test('switching NPC persona changes npcName', async () => {
    const vm = createDevVM({ initialNpcPreset: 'guard' });
    // Guard NPC name should be "Guard Captain Voss"
    expect(vm.npcName).toBe('Guard Captain Voss');
    expect(vm.messages[0].content).toContain('Halt!');
  });
});
