// apps/frontend/pwa/src/lib/client/services/media/stream_orchestrator.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

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
