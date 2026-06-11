// apps/frontend/client/src/lib/services/media/stream_orchestrator.test.ts
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
  type ImageStreamConnection,
  StreamOrchestrator,
  type StreamOrchestratorInterface,
  type StreamOrchestratorOptions,
  type TextStreamConnection,
} from './stream_orchestrator.svelte';

// Default fetch mock — tests override per describe() block as needed.
// Silences "ConnectionRefused" noise from Kokoro dispatch in tests that
// don't explicitly mock fetch.
let _originalFetch: typeof globalThis.fetch;

beforeAll(() => {
  _originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return {
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(128),
    } as Response;
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = _originalFetch;
});

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
} => {
  const startCalls: TextStreamStartCall[] = [];

  const conn: TextStreamConnection = {
    start: (options) => {
      startCalls.push(options);
      return new Promise(() => {
        /* long-lived SSE */
      });
    },
  };

  return Object.assign(conn, { startCalls });
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
// AC1: Unified Lifecycle & Abort Management
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — AC1: Unified Lifecycle & Abort Management', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestrator',
    textStream: internalText,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
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
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();
    expect(orchestrator.isGenerating).toBe(true);
  });

  test('should pass AbortSignal to text and image layers', async () => {
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

    // Image stream should have been connected with the same signal
    expect(internalImage.connectCall).toBeDefined();
    expect(internalImage.connectCall?.signal).toBe(textSignal);
  });

  test('should abort both connections and close image WS when cancelGeneration is called', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Test abort',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    const textSignal = internalText.startCalls[0].signal;
    const textAbortSpy = mock(() => {});
    textSignal.addEventListener('abort', textAbortSpy);

    orchestrator.cancelGeneration();

    expect(textSignal.aborted).toBe(true);
    expect(textAbortSpy).toHaveBeenCalled();
    expect(internalImage.closeSpy).toHaveBeenCalled();
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

    void orchestrator.generateDialogue({
      prompt: 'Second',
      npcId: 'npc-2',
      personaId: 'persona-2',
    });

    await Promise.resolve();

    expect(internalImage.closeSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC2: Progressive Text Consumption
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — AC2: Progressive Text Consumption', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC2',
    textStream: internalText,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    orchestrator = new StreamOrchestrator(createOptions());
  });

  test('should update currentText reactively as SSE chunks arrive', async () => {
    let onChunk: ((text: string) => void) | undefined;

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
// C-062 AC2: Orchestrator Memory Hook
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-062 AC2: Memory Hook (save on success)', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;
  let conversationRepo: ReturnType<typeof createMockConversationRepository>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC2',
    textStream: internalText,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
    conversationRepository: conversationRepo,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    conversationRepo = createMockConversationRepository();
    orchestrator = new StreamOrchestrator(createOptions());
  });

  test('should save dialogue turn when text stream completes successfully', async () => {
    let onChunk: ((text: string) => void) | undefined;
    let startPromiseResolve: (() => void) | undefined;

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
    onChunk?.('Welcome to the');
    onChunk?.(' village.');
    expect(orchestrator.currentText).toBe('Welcome to the village.');

    startPromiseResolve?.();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

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
      npcMessage: { role: 'assistant', content: 'Down the road, past the old well.' },
    });
  });

  test('should NOT save when repository is not provided', async () => {
    const noRepoOrch = new StreamOrchestrator({
      className: 'NoRepoOrchestrator',
      textStream: internalText,
      imageStream: internalImage,
      audioQueuePlayer: audioQueue,
      textureInjector,
    });

    let onChunk: ((text: string) => void) | undefined;
    let startPromiseResolve: (() => void) | undefined;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise<void>((resolve) => {
        startPromiseResolve = resolve;
      });
    };

    void noRepoOrch.generateDialogue({
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
    startPromiseResolve?.();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(conversationRepo.saveDialogueTurn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C-062 AC3: Abort Exclusion
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-062 AC3: Abort Exclusion', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;
  let conversationRepo: ReturnType<typeof createMockConversationRepository>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC3',
    textStream: internalText,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
    conversationRepository: conversationRepo,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    conversationRepo = createMockConversationRepository();
    orchestrator = new StreamOrchestrator(createOptions());
  });

  test('should NOT save partial text when generation is aborted mid-stream', async () => {
    let onChunk: ((text: string) => void) | undefined;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {});
    };

    void orchestrator.generateDialogue({
      prompt: 'Tell me a story',
      npcId: 'npc-bard',
      personaId: 'persona-bard',
      chatId: 'chat-story',
    });

    await Promise.resolve();
    onChunk?.('Once upon a time, there was');
    expect(orchestrator.currentText).toBe('Once upon a time, there was');

    orchestrator.cancelGeneration();

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(conversationRepo.saveDialogueTurn).not.toHaveBeenCalled();
  });

  test('should NOT save when consecutive generateDialogue call cancels previous', async () => {
    let onChunk1: ((text: string) => void) | undefined;

    internalText.start = (options) => {
      onChunk1 = options.onChunk;
      return new Promise(() => {});
    };

    void orchestrator.generateDialogue({
      prompt: 'First interaction',
      npcId: 'npc-1',
      personaId: 'persona-1',
      chatId: 'chat-1',
    });

    await Promise.resolve();
    onChunk1?.('Some partial text from first...');

    void orchestrator.generateDialogue({
      prompt: 'Second interaction',
      npcId: 'npc-2',
      personaId: 'persona-2',
      chatId: 'chat-2',
    });

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

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
// C-063 AC1: Emotion Tag Interception
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-063 AC1: Emotion Tag Interception', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;
  let extractedEmotions: Array<{ npcId: string; emotion: string }>;
  let onChunk: ((text: string) => void) | undefined;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC1',
    textStream: internalText,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
    onEmotionExtracted: (options) => {
      extractedEmotions.push(options);
    },
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    extractedEmotions = [];

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {});
    };

    orchestrator = new StreamOrchestrator(createOptions());
  });

  afterEach(() => {
    orchestrator.cancelGeneration();
  });

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

  test('should clear tag buffer when cancelGeneration is called', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();
    onChunk?.('<emot');
    expect(orchestrator.currentText).toBe('');

    orchestrator.cancelGeneration();
    expect(orchestrator.currentText).toBe('');
  });
});

// ---------------------------------------------------------------------------
// C-063 AC3/AC4: Hybrid Trigger Pipeline
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-063 AC3/AC4: Hybrid Trigger Pipeline', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
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
      return new Promise((resolve, reject) => {
        if (options.signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const onAbort = (): void => {
          reject(new DOMException('Aborted', 'AbortError'));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
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
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    fetchCalls = [];
    expressionGenerationCalls = [];
    expressionGenerationResult = new ArrayBuffer(256);
    staticAssetPaths = new Map();

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url });
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(128),
      } as Response;
    }) as typeof fetch;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {});
    };

    orchestrator = new StreamOrchestrator(createOptions());
  });

  afterEach(() => {
    orchestrator.cancelGeneration();
  });

  test('should load static asset and bypass ComfyUI when resolver returns path', async () => {
    staticAssetPaths.set('npc-1:joy', '/images/npc/npc-1/joy.webp');

    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();
    onChunk?.('<emotion:joy> Hello!');

    // The static asset should have been fetched (ignore any Kokoro calls from the chunker)
    const assetCalls = fetchCalls.filter((c) => c.url === '/images/npc/npc-1/joy.webp');
    expect(assetCalls).toHaveLength(1);
    expect(expressionGenerationCalls).toHaveLength(0);
  });

  test('should fire ComfyUI generation when no static asset exists', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-unknown',
      personaId: 'persona-1',
    });

    await Promise.resolve();
    onChunk?.('<emotion:fear>');

    await new Promise((r) => setTimeout(r, 20));

    expect(expressionGenerationCalls).toHaveLength(1);
    expect(expressionGenerationCalls[0].npcId).toBe('npc-unknown');
    expect(expressionGenerationCalls[0].emotion).toBe('fear');
  });

  test('should deduplicate: skip when same emotion is already active', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();
    onChunk?.('<emotion:joy>');

    await new Promise((r) => setTimeout(r, 2));
    onChunk?.('<emotion:joy>');

    await new Promise((r) => setTimeout(r, 20));

    const joyCalls = expressionGenerationCalls.filter((c) => c.emotion === 'joy');
    expect(joyCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// C-069 AC3: Direct TTS HTTP Trigger (Kokoro)
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-069 AC3: Direct Kokoro HTTP', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;
  let onChunk: ((text: string) => void) | undefined;
  let kokoroCalls: Array<{ url: string; method: string; body: string }>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestOrchKokoro',
    textStream: internalText,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
    internalImage = createMockImageStream();
    audioQueue = createMockAudioQueue();
    textureInjector = createMockTextureInjector();
    kokoroCalls = [];

    // Mock fetch: track Kokoro calls, return mock WAV
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Only intercept Kokoro calls
      if (url.includes('/v1/audio/speech')) {
        kokoroCalls.push({
          url,
          method: init?.method ?? 'GET',
          body: init?.body as string,
        });
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(512),
        } as Response;
      }

      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(128),
      } as Response;
    }) as typeof fetch;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise(() => {});
    };

    orchestrator = new StreamOrchestrator(createOptions());
  });

  afterEach(() => {
    orchestrator.cancelGeneration();
  });

  test('should chunk sentence-ending text and POST to Kokoro', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Feed a complete sentence
    onChunk?.('Hello there.');

    // Wait for the fetch to fire
    await new Promise((r) => setTimeout(r, 20));

    expect(kokoroCalls.length).toBe(1);
    expect(kokoroCalls[0].method).toBe('POST');
    expect(kokoroCalls[0].url).toBe('http://localhost:8089/v1/audio/speech');

    const body = JSON.parse(kokoroCalls[0].body);
    expect(body.model).toBe('tts-1');
    expect(body.input).toBe('Hello there.');
    expect(body.voice).toBe('af_bella');
    expect(body.response_format).toBe('wav');
  });

  test('should dispatch multiple sentences to Kokoro', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Feed text with two complete sentences
    onChunk?.('Hello! How are you?');

    await new Promise((r) => setTimeout(r, 20));

    expect(kokoroCalls.length).toBe(2);

    const body1 = JSON.parse(kokoroCalls[0].body);
    expect(body1.input).toBe('Hello!');

    const body2 = JSON.parse(kokoroCalls[1].body);
    expect(body2.input).toBe('How are you?');
  });

  test('should NOT dispatch to Kokoro for incomplete sentences', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Feed text without sentence-ending punctuation
    onChunk?.('Hello there');

    await new Promise((r) => setTimeout(r, 20));

    expect(kokoroCalls.length).toBe(0);
  });

  test('should enqueue decoded WAV buffer into audio queue', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    onChunk?.('Test sentence.');

    await new Promise((r) => setTimeout(r, 30));

    expect(audioQueue.enqueueChunk).toHaveBeenCalled();
  });

  test('should not call Kokoro when signal is aborted', async () => {
    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Abort before the sentence completes
    orchestrator.cancelGeneration();

    // Feed would try to dispatch but signal is aborted
    onChunk?.('This should not trigger.');

    await new Promise((r) => setTimeout(r, 10));

    expect(kokoroCalls.length).toBe(0);
  });

  test('should flush chunker buffer on stream close (trailing text)', async () => {
    let startPromiseResolve: (() => void) | undefined;

    internalText.start = (options) => {
      onChunk = options.onChunk;
      return new Promise<void>((resolve) => {
        startPromiseResolve = resolve;
      });
    };

    void orchestrator.generateDialogue({
      prompt: 'Hello',
      npcId: 'npc-1',
      personaId: 'persona-1',
    });

    await Promise.resolve();

    // Feed text WITHOUT terminal punctuation
    onChunk?.('No punctuation here');

    // Resolve stream — triggers chunker.close() which flushes
    startPromiseResolve?.();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 30));

    // The trailing text should be dispatched to Kokoro as a final sentence
    expect(kokoroCalls.length).toBe(1);
    const body = JSON.parse(kokoroCalls[0].body);
    expect(body.input).toBe('No punctuation here');
  });
});

// ---------------------------------------------------------------------------
// C-062 AC4: Gateway Integration
// ---------------------------------------------------------------------------

describe('StreamOrchestrator — C-062 AC4: Gateway Payload', () => {
  let orchestrator: StreamOrchestratorInterface;
  let internalText: ReturnType<typeof createMockTextStream>;
  let internalImage: ReturnType<typeof createMockImageStream>;
  let audioQueue: ReturnType<typeof createMockAudioQueue>;
  let textureInjector: ReturnType<typeof createMockTextureInjector>;

  const createOptions = (): StreamOrchestratorOptions => ({
    className: 'TestStreamOrchestratorAC4',
    textStream: internalText,
    imageStream: internalImage,
    audioQueuePlayer: audioQueue,
    textureInjector,
  });

  beforeEach(() => {
    internalText = createMockTextStream();
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
});
