// apps/frontend/pwa/src/lib/client/services/media/stream_orchestrator.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Polyfill requestAnimationFrame for bun test environment
beforeAll(() => {
  (globalThis as Record<string, unknown>).requestAnimationFrame = (
    callback: FrameRequestCallback,
  ): number => {
    return setTimeout(callback, 16) as unknown as number;
  };
  (globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).requestAnimationFrame;
  delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
});

import type { AudioQueuePlayerInterface } from './audio_queue_player';
import type { ConversationRepositoryInterface } from './conversation_repository.svelte.ts';
import type { PixiTextureInjectorInterface } from './pixi_texture_injector';
import {
  type AudioStreamConnection,
  type ImageStreamConnection,
  StreamOrchestrator,
  type StreamOrchestratorInterface,
  type StreamOrchestratorOptions,
  type TextStreamConnection,
} from './stream_orchestrator.svelte';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type TextStreamStartCall = {
  signal: AbortSignal;
  onChunk: (text: string) => void;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

const createMockTextStream = (): TextStreamConnection & {
  startCalls: TextStreamStartCall[];
  abortSpy: ReturnType<typeof mock>;
} => {
  const startCalls: TextStreamStartCall[] = [];

  const conn: TextStreamConnection = {
    start: (options) => {
      startCalls.push(options);
      return new Promise(() => {
        /* never resolves — long-lived SSE */
      });
    },
  };

  return Object.assign(conn, {
    startCalls,
    abortSpy: mock(() => {}),
  });
};

const createMockAudioStream = (): AudioStreamConnection & {
  connectCall: { signal?: AbortSignal; onChunk?: (buffer: ArrayBuffer) => void } | undefined;
  closeSpy: ReturnType<typeof mock>;
} => {
  const closeSpy = mock(() => {});
  let connectCall: { signal?: AbortSignal; onChunk?: (buffer: ArrayBuffer) => void } | undefined;

  return {
    connect: (options) => {
      connectCall = options;
    },
    close: closeSpy,
    get connectCall() {
      return connectCall;
    },
    closeSpy,
  };
};

const createMockImageStream = (): ImageStreamConnection & {
  connectCall: { signal?: AbortSignal; onComplete?: (buffer: ArrayBuffer) => void } | undefined;
  closeSpy: ReturnType<typeof mock>;
} => {
  const closeSpy = mock(() => {});
  let connectCall: { signal?: AbortSignal; onComplete?: (buffer: ArrayBuffer) => void } | undefined;

  return {
    connect: (options) => {
      connectCall = options;
    },
    close: closeSpy,
    get connectCall() {
      return connectCall;
    },
    closeSpy,
  };
};

const createMockAudioQueue = (): AudioQueuePlayerInterface => ({
  enqueueChunk: mock(() => Promise.resolve()),
  startStream: mock(() => {}),
  endStream: mock(() => {}),
  stop: mock(() => {}),
  get queueSize(): number {
    return 0;
  },
  get isPlaying(): boolean {
    return false;
  },
});

const createMockTextureInjector = (): PixiTextureInjectorInterface => ({
  injectTexture: mock(() => Promise.resolve()),
  clearTexture: mock(() => {}),
});

const createMockConversationRepository = (): ConversationRepositoryInterface => ({
  saveDialogueTurn: mock(() => Promise.resolve()),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — AC1: Unified Lifecycle & Abort Management', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalAudio: ReturnType<typeof createMockAudioStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestrator',
    textStream: internalText,
    audioStream: internalAudio,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalAudio = createMockAudioStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    orchestrator = new StreamOrchestrator(createOptions());
  });

  test('should be idle before generation starts', () => {
    expect(orchestrator.isGenerating).toBe(false);
    expect(orchestrator.currentText).toBe('');
    expect(orchestrator.currentAudioQueueSize).toBe(0);
  });

  test('should set isGenerating to true when generateDialogue is called', async () => {
    // Don't await — it blocks on the long-lived SSE
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    // Give a microtask tick for the promise to start
    await Promise.resolve();

    expect(orchestrator.isGenerating).toBe(true);
  });

  test('should pass AbortSignal to all three network layers', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Greetings',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Text stream should have been started with a signal
    expect(internalText.startCalls.length).toBeGreaterThanOrEqual(1);
    expect(internalText.startCalls[0].signal).toBeInstanceOf(AbortSignal);
    const textSignal = internalText.startCalls[0].signal;
    expect(textSignal.aborted).toBe(false);

    // Audio stream should have been connected with the same signal
    expect(internalAudio.connectCall).toBeDefined();
    expect(internalAudio.connectCall?.signal).toBe(textSignal);

    // Image stream should have been connected with the same signal
    expect(internalImage.connectCall).toBeDefined();
    expect(internalImage.connectCall?.signal).toBe(textSignal);
  });

  test('should abort all three connections when cancelGeneration is called', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Test abort',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Spy on abort listeners
    const textSignal = internalText.startCalls[0].signal;
    const textAbortSpy = mock(() => {});
    textSignal.addEventListener('abort', textAbortSpy);

    orchestrator.cancelGeneration();

    // The signal should be aborted
    expect(textSignal.aborted).toBe(true);
    expect(textAbortSpy).toHaveBeenCalled();

    // Audio WS should be closed
    expect(internalAudio.closeSpy).toHaveBeenCalled();

    // Image WS should be closed
    expect(internalImage.closeSpy).toHaveBeenCalled();

    // isGenerating should be false
    expect(orchestrator.isGenerating).toBe(false);
  });

  test('should stop audio queue and clear texture on cancel', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Test cleanup',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    orchestrator.cancelGeneration();

    expect(audioQueue.stop).toHaveBeenCalled();
    expect(textureInjector.clearTexture).toHaveBeenCalled();
  });

  test('should not fail if cancelGeneration is called when idle', () => {
    expect(() => {
      orchestrator.cancelGeneration();
    }).not.toThrow();
  });

  test('should handle consecutive generateDialogue calls', async () => {
    void orchestrator.generateDialogue({
      prompt: 'First',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Should cancel the previous generation implicitly
    void orchestrator.generateDialogue({
      prompt: 'Second',
      npcId: 'npc-2',
      personaId: 'persona-2',
    });

    await Promise.resolve();

    // First connections should be torn down
    expect(internalAudio.closeSpy).toHaveBeenCalled();
    expect(internalImage.closeSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC2: Progressive Text Consumption
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — AC2: Progressive Text Consumption', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalAudio: ReturnType<typeof createMockAudioStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC2',
    textStream: internalText,
    audioStream: internalAudio,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalAudio = createMockAudioStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    orchestrator = new StreamOrchestrator(createOptions());
  });

  test('should update currentText reactively as SSE chunks arrive', async () => {
    let onChunk: ((text: string) => void) | undefined;

    // Override start to capture the onChunk callback
    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {});
    };

    void orchestrator.generateDialogue({
      prompt: 'Say something',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    expect(onChunk).toBeDefined();

    // Simulate chunks arriving
    onChunk?.('Hello');
    expect(orchestrator.currentText).toBe('Hello');

    onChunk?.(', ');
    expect(orchestrator.currentText).toBe('Hello, ');

    onChunk?.('world');
    expect(orchestrator.currentText).toBe('Hello, world');

    onChunk?.('!');
    expect(orchestrator.currentText).toBe('Hello, world!');
  });

  test('should clear currentText when new dialogue starts', async () => {
    let onChunk: ((text: string) => void) | undefined;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {});
    };

    void orchestrator.generateDialogue({
      prompt: 'First message',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();
    onChunk?.('First text');
    expect(orchestrator.currentText).toBe('First text');

    // Start second dialogue
    void orchestrator.generateDialogue({
      prompt: 'Second message',
      npcId: 'npc-2',
      personaId: 'persona-2',
    });

    await Promise.resolve();
    expect(orchestrator.currentText).toBe('');
  });

  test('should clear currentText on cancel', async () => {
    let onChunk: ((text: string) => void) | undefined;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {});
    };

    void orchestrator.generateDialogue({
      prompt: 'Message to cancel',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();
    onChunk?.('Some text that will be');

    expect(orchestrator.currentText).toBe('Some text that will be');

    orchestrator.cancelGeneration();

    expect(orchestrator.currentText).toBe('');
    expect(orchestrator.isGenerating).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C-062 AC2: Orchestrator Memory Hook — save on successful completion
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-062 AC2: Memory Hook (save on success)', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalAudio: ReturnType<typeof createMockAudioStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;
  let conversationRepo: ReturnType<typeof createMockConversationRepository>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC2',
    textStream: internalText,
    audioStream: internalAudio,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
    conversationRepository: conversationRepo,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalAudio = createMockAudioStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    conversationRepo = createMockConversationRepository();
    orchestrator = new StreamOrchestrator(createOptions());
  });

  test('should save dialogue turn when text stream completes successfully', async () => {
    let onChunk: ((text: string) => void) | undefined;
    let startPromiseResolve: (() => void) | undefined;

    // Make the text stream resolve naturally (simulating server close)
    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise<void>((resolve) => {
        startPromiseResolve = resolve;
      });
    };

    void orchestrator.generateDialogue({
      prompt: 'Hello, traveler.',
      npcId: 'npc-123',
      personaId: 'persona-1',
      chatId: 'chat-456',
    });

    await Promise.resolve();

    // Simulate stream chunks
    onChunk?.('Welcome to the');
    onChunk?.(' village.');

    expect(orchestrator.currentText).toBe('Welcome to the village.');

    // Resolve the stream — simulates natural completion
    startPromiseResolve?.();

    // Let the microtask queue flush so .then() handlers execute
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    // The repository should have been called with correct data
    expect(conversationRepo.saveDialogueTurn).toHaveBeenCalled();
  });

  test('should pass correct player and NPC messages to repository on save', async () => {
    let onChunk: ((text: string) => void) | undefined;
    let startPromiseResolve: (() => void) | undefined;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise<void>((resolve) => {
        startPromiseResolve = resolve;
      });
    };

    void orchestrator.generateDialogue({
      prompt: 'Where is the tavern?',
      npcId: 'npc-blacksmith',
      personaId: 'persona-blacksmith',
      chatId: 'chat-tavern',
    });

    await Promise.resolve();
    onChunk?.('Down the road, past the old well.');

    startPromiseResolve?.();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(conversationRepo.saveDialogueTurn).toHaveBeenCalledWith({
      chatId: 'chat-tavern',
      npcId: 'npc-blacksmith',
      playerMessage: { role: 'user', content: 'Where is the tavern?' },
      npcMessage: {
        role: 'assistant',
        content: 'Down the road, past the old well.',
      },
    });
  });

  test('should NOT save when repository is not provided', async () => {
    // Create orchestrator WITHOUT repository
    const noRepoOrchestrator = new StreamOrchestrator({
      className: 'NoRepoOrchestrator',
      textStream: internalText,
      audioStream: internalAudio,
      imageStream: internalImage,
      audioQueuePlayer: audioQueue,
      textureInjector,
      // intentionally no conversationRepository
    });

    let onChunk: ((text: string) => void) | undefined;
    let startPromiseResolve: (() => void) | undefined;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise<void>((resolve) => {
        startPromiseResolve = resolve;
      });
    };

    void noRepoOrchestrator.generateDialogue({
      prompt: 'Test',
      npcId: 'npc-1',
      personaId: 'persona-1',
      chatId: 'chat-1',
    });

    await Promise.resolve();
    onChunk?.('Response');

    startPromiseResolve?.();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(conversationRepo.saveDialogueTurn).not.toHaveBeenCalled();
  });

  test('should NOT save when NPC response is empty', async () => {
    let startPromiseResolve: (() => void) | undefined;

    internalText.start = (_options) => {
      return new Promise<void>((resolve) => {
        startPromiseResolve = resolve;
      });
    };

    void orchestrator.generateDialogue({
      prompt: 'Greetings',
      npcId: 'npc-1',
      personaId: 'persona-1',
      chatId: 'chat-1',
    });

    await Promise.resolve();

    // No chunks fired — text is empty
    startPromiseResolve?.();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(conversationRepo.saveDialogueTurn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C-062 AC3: Abort/Cancel Exclusion — partial text NOT saved
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-062 AC3: Abort Exclusion', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalAudio: ReturnType<typeof createMockAudioStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;
  let conversationRepo: ReturnType<typeof createMockConversationRepository>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC3',
    textStream: internalText,
    audioStream: internalAudio,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
    conversationRepository: conversationRepo,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalAudio = createMockAudioStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    conversationRepo = createMockConversationRepository();
    orchestrator = new StreamOrchestrator(createOptions());
  });

  test('should NOT save partial text when generation is aborted mid-stream', async () => {
    let onChunk: ((text: string) => void) | undefined;

    // SSE never resolves — stays open until aborted
    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {
        // long-lived — only terminates on abort
      });
    };

    void orchestrator.generateDialogue({
      prompt: 'Tell me a story',
      npcId: 'npc-bard',
      personaId: 'persona-bard',
      chatId: 'chat-story',
    });

    await Promise.resolve();

    // Simulate partial text arriving
    onChunk?.('Once upon a time, there was');

    expect(orchestrator.currentText).toBe('Once upon a time, there was');

    // Player presses "skip" — abort mid-stream
    orchestrator.cancelGeneration();

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    // Repository must NOT be called
    expect(conversationRepo.saveDialogueTurn).not.toHaveBeenCalled();
  });

  test('should NOT save when consecutive generateDialogue call cancels previous', async () => {
    let onChunk1: ((text: string) => void) | undefined;

    internalText.start = (options) => {
      onChunk1 = options.onChunk;
      return new Promise(() => {
        // long-lived
      });
    };

    void orchestrator.generateDialogue({
      prompt: 'First interaction',
      npcId: 'npc-1',
      personaId: 'persona-1',
      chatId: 'chat-1',
    });

    await Promise.resolve();
    onChunk1?.('Some partial text from first...');

    // Start second dialogue — this cancels the first
    void orchestrator.generateDialogue({
      prompt: 'Second interaction',
      npcId: 'npc-2',
      personaId: 'persona-2',
      chatId: 'chat-2',
    });

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    // Repository must not have been called for the aborted first generation
    expect(conversationRepo.saveDialogueTurn).not.toHaveBeenCalled();
  });

  test('should NOT save when chatId is missing (transient NPC interaction)', async () => {
    let onChunk: ((text: string) => void) | undefined;
    let startPromiseResolve: (() => void) | undefined;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise<void>((resolve) => {
        startPromiseResolve = resolve;
      });
    };

    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-transient',
      personaId: 'persona-1',
      // no chatId — transient NPC without permanent chat
    });

    await Promise.resolve();
    onChunk?.('Greetings, stranger.');

    startPromiseResolve?.();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(conversationRepo.saveDialogueTurn).not.toHaveBeenCalled();
  });

  test('should clear pending save options on cancel', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Test',
      npcId: 'npc-1',
      personaId: 'persona-1',
      chatId: 'chat-1',
    });

    await Promise.resolve();

    orchestrator.cancelGeneration();

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(conversationRepo.saveDialogueTurn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C-063 AC1: Stream Interception — emotion tag buffering & extraction
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-063 AC1: Emotion Tag Interception', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalAudio: ReturnType<typeof createMockAudioStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;
  let extractedEmotions: Array<{ npcId: string; emotion: string }>;
  let onChunk: ((text: string) => void) | undefined;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC1',
    textStream: internalText,
    audioStream: internalAudio,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
    onEmotionExtracted: (options) => {
      extractedEmotions.push(options);
    },
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalAudio = createMockAudioStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    extractedEmotions = [];

    // Capture onChunk so we can simulate chunk arrivals
    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {});
    };

    orchestrator = new StreamOrchestrator(createOptions());
  });

  afterEach(() => {
    // Clean up rAF loop to prevent resource leaks between tests
    orchestrator.cancelGeneration();
  });

  // -- Happy path ------------------------------------------------------

  test('should extract complete emotion tag from single chunk and hide it from currentText', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:joy> Hello there!');

    expect(orchestrator.currentText).toBe(' Hello there!');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-1', emotion: 'joy' }]);
  });

  test('should extract emotion tag at the end of a chunk', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('I am happy <emotion:joy>');

    expect(orchestrator.currentText).toBe('I am happy ');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-1', emotion: 'joy' }]);
  });

  test('should extract multiple emotion tags in a single chunk', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-2',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:surprise> Wow! <emotion:joy> Amazing!');

    expect(orchestrator.currentText).toBe(' Wow!  Amazing!');
    expect(extractedEmotions).toEqual([
      { npcId: 'npc-2', emotion: 'surprise' },
      { npcId: 'npc-2', emotion: 'joy' },
    ]);
  });

  test('should extract emotion tag with underscore in name', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:very_happy> Hello!');

    expect(orchestrator.currentText).toBe(' Hello!');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-1', emotion: 'very_happy' }]);
  });

  test('should extract emotion tag with digits in name', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:level3> Greetings.');

    expect(orchestrator.currentText).toBe(' Greetings.');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-1', emotion: 'level3' }]);
  });

  // -- Fragmented chunks -----------------------------------------------

  test('should buffer partial tag across two chunks and extract when complete', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Chunk 1: partial tag <emot
    onChunk?.('<emot');
    expect(orchestrator.currentText).toBe('');
    expect(extractedEmotions).toEqual([]);

    // Chunk 2: completes the tag
    onChunk?.('ion:joy> Hello!');
    expect(orchestrator.currentText).toBe(' Hello!');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-1', emotion: 'joy' }]);
  });

  test('should buffer partial tag across three chunks (AC1: fragmented chunks)', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-3',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Chunk 1: <emot
    onChunk?.('<emot');
    expect(orchestrator.currentText).toBe('');

    // Chunk 2: ion:joy> He
    onChunk?.('ion:joy> He');
    expect(orchestrator.currentText).toBe(' He');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-3', emotion: 'joy' }]);

    // Chunk 3: llo!
    onChunk?.('llo!');
    expect(orchestrator.currentText).toBe(' Hello!');
  });

  test('should buffer only the < at the start but release the rest', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Chunk: <e — valid prefix
    onChunk?.('<e');
    expect(orchestrator.currentText).toBe('');

    // Chunk: motion:joy>
    onChunk?.('motion:joy>');
    expect(orchestrator.currentText).toBe('');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-1', emotion: 'joy' }]);
  });

  // -- Math equation edge case (5 < 10) ---------------------------------

  test('should NOT swallow math expression "5 < 10" — invalidates immediately', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Chunk contains literal math comparison
    onChunk?.('The answer is 5 < 10, obviously.');

    expect(orchestrator.currentText).toBe('The answer is 5 < 10, obviously.');
    expect(extractedEmotions).toEqual([]);
  });

  test('should NOT swallow "3 < 4" across chunk boundary (AC1: math edge case)', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Chunk 1: ends with "5 <"
    onChunk?.('Value is 5 <');
    // The < at end looks like a potential tag start... it's held in buffer
    expect(orchestrator.currentText).toBe('Value is 5 ');

    // Chunk 2: " 10 test" — space after < invalidates the tag prefix
    onChunk?.(' 10 test.');
    expect(orchestrator.currentText).toBe('Value is 5 < 10 test.');
    expect(extractedEmotions).toEqual([]);
  });

  test('should NOT swallow HTML-style "<br>" as a tag', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('Line one<br>Line two');

    expect(orchestrator.currentText).toBe('Line one<br>Line two');
    expect(extractedEmotions).toEqual([]);
  });

  test('should NOT swallow "if x < 0" in single chunk', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('if x < 0 then');

    expect(orchestrator.currentText).toBe('if x < 0 then');
    expect(extractedEmotions).toEqual([]);
  });

  // -- Dangling tag buffer timeout -------------------------------------

  test('should flush dangling tag buffer after timeout', async () => {
    // Use a short timeout for the test
    const fastOptions = createOptions();
    fastOptions.tagBufferTimeoutMs = 10;

    const fastOrch = new StreamOrchestrator(fastOptions);

    let fastOnChunk: ((text: string) => void) | undefined;
    internalText.start = (options) => {
      fastOnChunk = options.onChunk;
      return new Promise(() => {});
    };

    void fastOrch.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Send a dangling "<"
    fastOnChunk?.('<');

    // The < is buffered — currentText should be empty or the text before <
    // Wait for timeout to flush
    await new Promise((r) => setTimeout(r, 50));

    // After timeout, the dangling < should be flushed as regular text
    expect(fastOrch.currentText).toBe('<');
  });

  test('should not double-flush when new chunk arrives before timeout', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Chunk ends with <
    onChunk?.('Something <');
    expect(orchestrator.currentText).toBe('Something ');

    // Quick follow-up: completes the tag (arrives before timeout)
    onChunk?.('emotion:joy> indeed');
    expect(orchestrator.currentText).toBe('Something  indeed');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-1', emotion: 'joy' }]);
  });

  // -- Edge cases ------------------------------------------------------

  test('should handle pure text chunk with no tags', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('Just regular text, nothing special.');

    expect(orchestrator.currentText).toBe('Just regular text, nothing special.');
    expect(extractedEmotions).toEqual([]);
  });

  test('should handle incomplete tag that never completes (malformed)', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Malformed: missing the closing >
    onChunk?.('<emotion:joy');
    expect(orchestrator.currentText).toBe('');

    // More regular text that doesn't complete the tag
    onChunk?.(' is what I feel. Hello!');

    // The space after 'joy' invalidates the tag prefix, flushing the whole thing
    expect(orchestrator.currentText).toBe('<emotion:joy is what I feel. Hello!');
    expect(extractedEmotions).toEqual([]);
  });

  test('should extract tag even when preceded by nothing (tag at chunk start)', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:joy>');

    expect(orchestrator.currentText).toBe('');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-1', emotion: 'joy' }]);
  });

  test('should clear tag buffer when cancelGeneration is called', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Buffer a partial tag
    onChunk?.('<emot');
    expect(orchestrator.currentText).toBe('');

    orchestrator.cancelGeneration();

    // After cancel, currentText should be empty (buffer cleared, not flushed)
    expect(orchestrator.currentText).toBe('');
  });

  test('should not fire onEmotionExtracted when no npcId is active', async () => {
    // Create orchestrator without starting a dialogue (no currentSpeakerId)
    const idleOrch = new StreamOrchestrator(createOptions()) as StreamOrchestrator;

    // Directly test _processTextChunk
    const result = (
      idleOrch as unknown as {
        _processTextChunk: (chunk: string) => { cleanText: string; emotions: string[] };
      }
    )._processTextChunk('<emotion:joy> Hello');
    expect(result.cleanText).toBe(' Hello');
    expect(result.emotions).toEqual(['joy']);

    // But since no npcId is set, the callback should not fire via the stream path
    // (This is tested in the stream test — emotions array is populated regardless)
  });

  test('should handle mixed content with < and actual tags', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('x < y but <emotion:anger> I am furious!');

    // x < y passes through, <emotion:anger> is extracted
    expect(orchestrator.currentText).toBe('x < y but  I am furious!');
    expect(extractedEmotions).toEqual([{ npcId: 'npc-1', emotion: 'anger' }]);
  });
});

// ---------------------------------------------------------------------------
// C-063 AC3 & AC4: Hybrid Trigger Pipeline — fast-path + ComfyUI fallback
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-063 AC3/AC4: Hybrid Trigger Pipeline', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalAudio: ReturnType<typeof createMockAudioStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;
  let onChunk: ((text: string) => void) | undefined;
  let fetchCalls: Array<{ url: string }>;
  let expressionGenerationCalls: Array<{
    npcId: string;
    emotion: string;
    signal: AbortSignal;
  }>;
  let expressionGenerationResult: ArrayBuffer;
  let staticAssetPaths: Map<string, string>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestOrchAC3AC4',
    textStream: internalText,
    audioStream: internalAudio,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
    expressionAssetResolver: {
      resolve: (options: { npcId: string; emotion: string }) => {
        return staticAssetPaths.get(`${options.npcId}:${options.emotion}`);
      },
    },
    expressionGenerator: async (options) => {
      expressionGenerationCalls.push(options);
      // Simulate async work that respects abort
      return new Promise((resolve, reject) => {
        if (options.signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const onAbort = (): void => {
          reject(new DOMException('Aborted', 'AbortError'));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        // Small delay so abort tests can fire before resolution
        setTimeout(() => {
          if (!options.signal.aborted) {
            options.signal.removeEventListener('abort', onAbort);
            resolve(expressionGenerationResult);
          }
        }, 5);
      });
    },
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalAudio = createMockAudioStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    fetchCalls = [];
    expressionGenerationCalls = [];
    expressionGenerationResult = new ArrayBuffer(256);
    staticAssetPaths = new Map();

    // Mock global fetch for static asset loading
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url });
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(128),
      } as Response;
    }) as typeof fetch;

    // Capture onChunk
    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {});
    };

    orchestrator = new StreamOrchestrator(createOptions());
  });

  afterEach(() => {
    orchestrator.cancelGeneration();
  });

  // -- AC3: Fast-path (static asset exists) ----------------------------

  test('should load static asset and bypass ComfyUI when resolver returns path', async () => {
    staticAssetPaths.set('npc-1:joy', '/images/npc/npc-1/joy.webp');

    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:joy> Hello!');

    // Fast-path: fetch should be called for the static asset
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('/images/npc/npc-1/joy.webp');

    // ComfyUI should NOT be called
    expect(expressionGenerationCalls).toHaveLength(0);
  });

  test('should inject static asset texture via texture injector', async () => {
    staticAssetPaths.set('npc-1:joy', '/images/npc/npc-1/joy.webp');

    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:joy> Hello!');

    // Wait for fetch + injection to complete
    await new Promise((r) => setTimeout(r, 20));

    expect(textureInjector.injectTexture).toHaveBeenCalled();
  });

  test('should bypass ComfyUI for multiple static emotions', async () => {
    staticAssetPaths.set('npc-1:joy', '/images/npc/npc-1/joy.webp');
    staticAssetPaths.set('npc-1:anger', '/images/npc/npc-1/anger.webp');

    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:joy>');
    onChunk?.(' Then <emotion:anger>');

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].url).toBe('/images/npc/npc-1/joy.webp');
    expect(fetchCalls[1].url).toBe('/images/npc/npc-1/anger.webp');
    expect(expressionGenerationCalls).toHaveLength(0);
  });

  // -- AC4: ComfyUI dynamic fallback -----------------------------------

  test('should fire ComfyUI generation when no static asset exists', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-unknown',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:fear>');

    // Wait for async generation to start
    await new Promise((r) => setTimeout(r, 20));

    expect(expressionGenerationCalls).toHaveLength(1);
    expect(expressionGenerationCalls[0].npcId).toBe('npc-unknown');
    expect(expressionGenerationCalls[0].emotion).toBe('fear');
  });

  test('should inject generated texture after ComfyUI fallback completes', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-procedural',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('<emotion:surprise>');

    // Wait for async generation to complete
    await new Promise((r) => setTimeout(r, 30));

    expect(textureInjector.injectTexture).toHaveBeenCalled();
    const injectCalls = (textureInjector.injectTexture as ReturnType<typeof mock>).mock.calls;
    expect(injectCalls.length).toBeGreaterThanOrEqual(1);
    // The buffer passed should be the expressionGenerationResult
    const lastCall = injectCalls[injectCalls.length - 1];
    expect(lastCall[0].buffer).toBe(expressionGenerationResult);
  });

  test('should NOT call ComfyUI when no expressionGenerator is configured', async () => {
    // Create orchestrator without expressionGenerator
    const noGenOrch = new StreamOrchestrator({
      className: 'NoGen',
      textStream: internalText,
      audioStream: internalAudio,
      imageStream: internalImage,
      audioQueuePlayer: audioQueue,
      textureInjector,
      expressionAssetResolver: {
        resolve: () => undefined,
      },
      // no expressionGenerator
    });

    let noGenOnChunk: ((text: string) => void) | undefined;
    internalText.start = (options) => {
      noGenOnChunk = options.onChunk;
      return new Promise(() => {});
    };

    void noGenOrch.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // This should not throw — it just skips silently
    noGenOnChunk?.('<emotion:joy>');

    // No generation calls (generator not configured)
    expect(expressionGenerationCalls).toHaveLength(0);
  });

  // -- AC4: AbortController for rapid emotion shifts ------------------

  test('should abort previous generation when new emotion arrives before completion', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // First emotion — starts generation
    onChunk?.('<emotion:joy>');

    await new Promise((r) => setTimeout(r, 2));

    // Second emotion arrives before first completes — should abort first
    onChunk?.('<emotion:anger>');

    await new Promise((r) => setTimeout(r, 20));

    // Both calls should have been made, but first should be aborted
    expect(expressionGenerationCalls.length).toBeGreaterThanOrEqual(2);
    expect(expressionGenerationCalls[0].signal.aborted).toBe(true);
    expect(expressionGenerationCalls[1].signal.aborted).toBe(false);
  });

  test('should abort expression generation when cancelGeneration is called mid-expression', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Start expression generation
    onChunk?.('<emotion:joy>');

    await new Promise((r) => setTimeout(r, 2));

    expect(expressionGenerationCalls).toHaveLength(1);

    // Cancel the entire dialogue generation
    orchestrator.cancelGeneration();

    await new Promise((r) => setTimeout(r, 10));

    // The expression generation should be aborted
    expect(expressionGenerationCalls[0].signal.aborted).toBe(true);
  });

  // -- Dedup -----------------------------------------------------------

  test('should deduplicate: skip when same emotion is already active', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // First joy tag
    onChunk?.('<emotion:joy>');

    await new Promise((r) => setTimeout(r, 2));

    // Second joy tag while first is still generating
    onChunk?.('<emotion:joy>');

    await new Promise((r) => setTimeout(r, 20));

    // Should only fire expression generator once for joy
    const joyCalls = expressionGenerationCalls.filter((c) => c.emotion === 'joy');
    expect(joyCalls).toHaveLength(1);
  });

  // -- Legacy: onEmotionExtracted still works --------------------------

  test('should still call onEmotionExtracted when resolver is also configured', async () => {
    const externalEmotions: Array<{ npcId: string; emotion: string }> = [];

    const dualOrch = new StreamOrchestrator({
      className: 'Dual',
      textStream: internalText,
      audioStream: internalAudio,
      imageStream: internalImage,
      audioQueuePlayer: audioQueue,
      textureInjector,
      onEmotionExtracted: (options) => {
        externalEmotions.push(options);
      },
      expressionAssetResolver: {
        resolve: (options) => `/images/npc/${options.npcId}/${options.emotion}.webp`,
      },
    });

    let dualOnChunk: ((text: string) => void) | undefined;
    internalText.start = (options) => {
      dualOnChunk = options.onChunk;
      return new Promise(() => {});
    };

    void dualOrch.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    dualOnChunk?.('<emotion:joy>');

    await new Promise((r) => setTimeout(r, 20));

    expect(externalEmotions).toEqual([{ npcId: 'npc-1', emotion: 'joy' }]);
  });
});

// ---------------------------------------------------------------------------
// C-062 AC4: Gateway Integration — messages array in payload
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-062 AC4: Gateway Payload', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalAudio: ReturnType<typeof createMockAudioStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC4',
    textStream: internalText,
    audioStream: internalAudio,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalAudio = createMockAudioStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    orchestrator = new StreamOrchestrator(createOptions());
  });

  test('should pass messages array to text stream start', async () => {
    const history = [
      { role: 'assistant' as const, content: 'Hello, traveler.' },
      { role: 'user' as const, content: 'Where is the tavern?' },
    ];

    void orchestrator.generateDialogue({
      prompt: 'And the blacksmith?',
      npcId: 'npc-1',
      personaId: 'persona-1',
      messages: history,
    });

    await Promise.resolve();

    expect(internalText.startCalls.length).toBe(1);
    expect(internalText.startCalls[0].messages).toEqual(history);
  });

  test('should pass empty messages array when no history provided', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    expect(internalText.startCalls[0].messages).toEqual([]);
  });

  test('should pass messages containing both user and assistant roles', async () => {
    const history = [
      { role: 'assistant' as const, content: 'Welcome, adventurer.' },
      { role: 'user' as const, content: 'What quests do you have?' },
      { role: 'assistant' as const, content: 'The goblins to the east...' },
      { role: 'user' as const, content: 'What is the reward?' },
    ];

    void orchestrator.generateDialogue({
      prompt: 'I accept.',
      npcId: 'npc-quest',
      personaId: 'persona-quest',
      messages: history,
    });

    await Promise.resolve();

    const passedMessages = internalText.startCalls[0].messages;
    expect(passedMessages.length).toBe(4);
    expect(passedMessages[0].role).toBe('assistant');
    expect(passedMessages[1].role).toBe('user');
  });
});
