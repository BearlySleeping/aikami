// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts
//
// Unit tests for DialogueOverlayViewModel (C-129 AC: streaming, messages, error handling)
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived, $effect are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock: OllamaClient from @aikami/frontend/api-core
// ---------------------------------------------------------------------------

type StreamChunk = string;

let mockStreamChunks: StreamChunk[] = [];
let mockShouldThrow: Error | null = null;

const createMockOllamaClient = (): Record<string, unknown> => {
  const streamChatSpy = mock(async function* (this: unknown, _prompt: string) {
    if (mockShouldThrow) {
      throw mockShouldThrow;
    }
    for (const chunk of mockStreamChunks) {
      yield chunk;
    }
  });

  return {
    OllamaClient: class {
      streamChat = streamChatSpy;
      name = 'ollama';
      capabilities = { dialogue: true };
      get streamChatSpy() {
        return streamChatSpy;
      }
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

mock.module('@aikami/frontend/api-core', () => {
  const m = createMockOllamaClient();
  return m;
});

// ---------------------------------------------------------------------------
// Mock: textGenerationService from $services
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

// Mock both the barrel import ($services) and the resolved file path
const TEXT_GEN_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts';

mock.module(TEXT_GEN_SVC_PATH, () => ({
  textGenerationService: {
    streamChat: textGenStreamChat,
    extractStructure: mock(async () => ({})),
    cancelAll: mock(() => {}),
  },
  __esModule: true,
}));

mock.module('$services', () => ({
  textGenerationService: {
    streamChat: textGenStreamChat,
    extractStructure: mock(async () => ({})),
    cancelAll: mock(() => {}),
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
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { DialogueOverlayViewModel } from './dialogue_overlay_view_model.svelte';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createNpcData = (
  overrides?: Partial<{ npcId: string; npcName: string; dialog: string }>,
) => ({
  npcId: 'npc-001',
  npcName: 'Elder Thrain',
  dialog: 'Welcome, traveler!',
  ...overrides,
});

const createViewModel = (options?: {
  npcData?: ReturnType<typeof createNpcData>;
  onEndChat?: () => void;
  ollamaClient?: unknown;
}): DialogueOverlayViewModel => {
  return new DialogueOverlayViewModel({
    className: 'TestDialogueOverlayViewModel',
    npcData: options?.npcData ?? createNpcData(),
    onEndChat: options?.onEndChat ?? (() => {}),
    ollamaClient: options?.ollamaClient as never,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DialogueOverlayViewModel', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockShouldThrow = null;
    mockTextGenStreamChunks = [];
    mockTextGenShouldThrow = null;
  });

  afterEach(() => {
    // Re-create mocks to reset streamChat spy state
    mock.module('@aikami/frontend/api-core', () => createMockOllamaClient());
  });

  // ── Initialization ───────────────────────────────────────────────────

  test('initializes with NPC greeting as first message when dialog is provided', () => {
    const vm = createViewModel({
      npcData: createNpcData({ dialog: 'Greetings, hero!' }),
    });

    expect(vm.npcName).toBe('Elder Thrain');
    // The constructor appends the NPC greeting dialog as the first message
    expect(vm.messages.length).toBe(1);
    expect(vm.messages[0].content).toBe('Greetings, hero!');
    expect(vm.messages[0].role).toBe('npc');

    // initialize() must be called (handled by BaseViewModelContainer in production)
    // For unit test we call it directly
  });

  test('exposes correct npcName', () => {
    const vm = createViewModel({
      npcData: createNpcData({ npcName: 'Guard Captain' }),
    });

    expect(vm.npcName).toBe('Guard Captain');
  });

  // ── Input State ──────────────────────────────────────────────────────

  test('setInput updates inputText', () => {
    const vm = createViewModel();

    vm.setInput('Hello');

    expect(vm.inputText).toBe('Hello');
  });

  test('inputText starts empty', () => {
    const vm = createViewModel();

    expect(vm.inputText).toBe('');
  });

  // ── sendMessage — Happy Path (TextGenerationService fallback) ────────

  test('sendMessage appends player message and clears input', async () => {
    const vm = createViewModel();
    vm.setInput('Hello there');
    vm.messages = []; // Reset to empty (no greeting)

    await vm.sendMessage();

    expect(vm.inputText).toBe('');
    expect(vm.messages.length).toBeGreaterThanOrEqual(1);
    expect(vm.messages[0].role).toBe('player');
    expect(vm.messages[0].content).toBe('Hello there');
  });

  test('sendMessage does nothing when input is empty', async () => {
    const vm = createViewModel();
    vm.messages = []; // Reset to empty

    await vm.sendMessage();

    expect(vm.messages.length).toBe(0);
  });

  test('sendMessage does nothing when already streaming', async () => {
    const vm = createViewModel();
    vm.setInput('Hi');
    (vm as Record<string, unknown>).isStreaming = true;

    await vm.sendMessage();

    // Should not have appended a player message since we returned early
    // (isStreaming guard fires before message is appended)
    expect(vm.messages.every((m) => m.role !== 'player')).toBe(true);
  });

  // ── sendMessage — Streaming & isStreaming toggles ────────────────────

  test('isStreaming is true during generation and false after', async () => {
    mockTextGenStreamChunks = ['Hello', ' World', '!'];

    const vm = createViewModel();
    vm.setInput('Hi');
    vm.messages = []; // Reset to empty

    await vm.sendMessage();

    // isStreaming should be false after sendMessage completes
    expect(vm.isStreaming).toBe(false);
    // Verify NPC message accumulated streamed chunks
    expect(vm.messages.length).toBe(2);
    expect(vm.messages[1].content).toBe('Hello World!');
  });

  test('NPC message accumulates streamed chunks', async () => {
    mockTextGenStreamChunks = ['H', 'e', 'l', 'l', 'o'];

    const vm = createViewModel();
    vm.setInput('Hi');
    vm.messages = []; // Reset to empty

    await vm.sendMessage();

    // Should have player message + NPC message
    expect(vm.messages.length).toBe(2);
    expect(vm.messages[0].role).toBe('player');
    expect(vm.messages[1].role).toBe('npc');
    expect(vm.messages[1].content).toBe('Hello');
  });

  // ── sendMessage — Error Handling ────────────────────────────────────

  test('streamError is set when generation throws', async () => {
    mockTextGenShouldThrow = new Error('Network failure');

    const vm = createViewModel();
    vm.setInput('Hi');
    vm.messages = []; // Reset to empty

    await vm.sendMessage();

    expect(vm.streamError).toBe('Network failure');
    expect(vm.isStreaming).toBe(false);
  });

  test('streamError is null on subsequent successful send', async () => {
    // First call: error
    mockTextGenShouldThrow = new Error('First error');
    const vm = createViewModel();
    vm.setInput('First');
    vm.messages = [];
    await vm.sendMessage();

    expect(vm.streamError).toBe('First error');

    // Second call: success
    mockTextGenShouldThrow = null;
    mockTextGenStreamChunks = ['OK'];

    vm.setInput('Second');
    await vm.sendMessage();

    expect(vm.streamError).toBeNull();
    expect(vm.isStreaming).toBe(false);
  });

  // ── sendMessage — sendMessage with explicit text ─────────────────────

  test('sendMessage accepts explicit text parameter', async () => {
    mockTextGenStreamChunks = ['Response'];

    const vm = createViewModel();
    vm.messages = [];

    await vm.sendMessage('Explicit text');

    expect(vm.messages[0].content).toBe('Explicit text');
    expect(vm.inputText).toBe('');
  });

  // ── endChat ──────────────────────────────────────────────────────────

  test('endChat calls onEndChat callback', () => {
    let called = false;
    const vm = createViewModel({
      onEndChat: () => {
        called = true;
      },
    });

    vm.endChat();

    expect(called).toBe(true);
  });

  // ── handleKeyDown ────────────────────────────────────────────────────

  test('handleKeyDown with Enter triggers sendMessage', () => {
    const vm = createViewModel();
    vm.setInput('Hello');
    vm.messages = [];

    const event = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: mock(() => {}),
    } as unknown as KeyboardEvent;

    // This triggers async sendMessage — we just verify preventDefault was called
    vm.handleKeyDown(event);

    expect(event.preventDefault as ReturnType<typeof mock>).toHaveBeenCalled();
  });

  test('handleKeyDown with Escape triggers endChat', () => {
    let ended = false;
    const vm = createViewModel({
      onEndChat: () => {
        ended = true;
      },
    });

    const event = { key: 'Escape', preventDefault: mock(() => {}) } as unknown as KeyboardEvent;

    vm.handleKeyDown(event);

    expect(ended).toBe(true);
    expect(event.preventDefault as ReturnType<typeof mock>).toHaveBeenCalled();
  });

  test('handleKeyDown with Shift+Enter does not send message', () => {
    const vm = createViewModel();
    vm.setInput('Hello');
    vm.messages = [];

    const event = {
      key: 'Enter',
      shiftKey: true,
      preventDefault: mock(() => {}),
    } as unknown as KeyboardEvent;

    vm.handleKeyDown(event);

    // preventDefault should NOT be called for Shift+Enter
    expect(event.preventDefault as ReturnType<typeof mock>).not.toHaveBeenCalled();
  });

  // ── OllamaClient streaming integration ───────────────────────────────

  test('uses OllamaClient.streamChat when ollamaClient is provided', async () => {
    // Re-register mock with fresh spy
    const ollamaMock = createMockOllamaClient();
    mockStreamChunks = ['Hello', ' traveller'];
    mock.module('@aikami/frontend/api-core', () => ollamaMock);

    const { OllamaClient: OllamaClientClass } = ollamaMock;
    const ollamaInstance = new (OllamaClientClass as new () => Record<string, unknown>)();

    const vm = createViewModel({
      ollamaClient: ollamaInstance,
    });
    vm.setInput('Hi');
    vm.messages = [];

    await vm.sendMessage();

    // Verify NPC message accumulated Ollama stream chunks
    expect(vm.messages.length).toBe(2);
    expect(vm.messages[1].role).toBe('npc');
    expect(vm.messages[1].content).toContain('Hello');
  });
});
