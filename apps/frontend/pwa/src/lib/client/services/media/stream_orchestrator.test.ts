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

const createMockTextStream = (): TextStreamConnection & {
  startCalls: Array<{ signal: AbortSignal; onChunk: (text: string) => void }>;
  abortSpy: ReturnType<typeof mock>;
} => {
  const startCalls: Array<{ signal: AbortSignal; onChunk: (text: string) => void }> = [];

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
