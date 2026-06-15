// apps/frontend/client/src/lib/services/audio/tts_service.test.ts

/**
 * Unit tests for TtsService — verifies native Kokoro WebGPU TTS integration.
 *
 * Mocks the Worker global to test the initialization and synthesis lifecycle
 * without requiring a real WebGPU backend.
 *
 * Contract: C-131 Task 5
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Worker mock
// ---------------------------------------------------------------------------

type WorkerMockState = {
  postMessage: ReturnType<typeof mock>;
  onmessage: ((event: MessageEvent) => void) | null;
  instances: Worker[];
};

let workerMockState: WorkerMockState;

const setupWorkerMock = (): void => {
  workerMockState = {
    postMessage: mock(() => {}),
    onmessage: null,
    instances: [],
  };

  // @ts-expect-error — replacing native Worker with mock
  globalThis.Worker = class MockWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;

    constructor(_url: string | URL, _options?: WorkerOptions) {
      workerMockState.instances.push(this as unknown as Worker);

      Object.defineProperty(this, 'onmessage', {
        get: () => workerMockState.onmessage,
        set: (fn) => {
          workerMockState.onmessage = fn;
        },
      });
    }

    postMessage(data: unknown) {
      workerMockState.postMessage(data);
    }

    terminate() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return true;
    }
  } as unknown as typeof Worker;
};

const teardownWorkerMock = (): void => {
  delete (globalThis as Record<string, unknown>).Worker;
};

/** Simulate the worker posting a response to the main thread. */
const simulateWorkerMessage = (payload: unknown): void => {
  if (workerMockState.onmessage) {
    workerMockState.onmessage({ data: payload } as MessageEvent);
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TtsService — Native WebGPU Voice (C-131)', () => {
  beforeEach(() => {
    setupWorkerMock();
  });

  afterEach(() => {
    teardownWorkerMock();
  });

  // -----------------------------------------------------------------------
  // AC: initialize() posts the initialize action to the worker
  // -----------------------------------------------------------------------

  test('initialize() posts initialize action to worker', async () => {
    // Dynamic import so Worker mock is in place
    const { ttsService } = await import('./tts_service.svelte');

    // Force-reset the singleton state (previous test may have modified it)
    (ttsService as unknown as Record<string, unknown>).status = 'uninitialized';
    (ttsService as unknown as Record<string, unknown>)._worker = null;

    expect(ttsService.status).toBe('uninitialized');

    await ttsService.initialize();

    // A Worker should have been spawned
    expect(workerMockState.instances.length).toBeGreaterThan(0);

    // The worker should receive the initialize action
    expect(workerMockState.postMessage).toHaveBeenCalledWith({
      action: 'initialize',
    });
  });

  // -----------------------------------------------------------------------
  // AC: initialize() transitions status to ready when worker responds
  // -----------------------------------------------------------------------

  test('initialize() transitions status to ready on worker ready response', async () => {
    const { ttsService } = await import('./tts_service.svelte');

    (ttsService as unknown as Record<string, unknown>).status = 'uninitialized';
    (ttsService as unknown as Record<string, unknown>)._worker = null;

    const initPromise = ttsService.initialize();

    // Simulate worker responding with 'ready'
    simulateWorkerMessage({ type: 'ready' });

    await initPromise;

    expect(ttsService.status).toBe('ready');
  });

  // -----------------------------------------------------------------------
  // AC: synthesize() posts correct message when worker is ready
  // -----------------------------------------------------------------------

  test('synthesize() posts synthesize message with text and voice', async () => {
    const { ttsService } = await import('./tts_service.svelte');

    (ttsService as unknown as Record<string, unknown>).status = 'ready';
    (ttsService as unknown as Record<string, unknown>)._worker = {
      postMessage: workerMockState.postMessage,
    } as unknown as Worker;

    await ttsService.synthesize({
      text: 'Hello world.',
      voice: 'af_bella',
    });

    expect(workerMockState.postMessage).toHaveBeenCalledWith({
      action: 'synthesize',
      text: 'Hello world.',
      voice: 'af_bella',
    });
  });

  // -----------------------------------------------------------------------
  // AC: synthesize() is a no-op when worker is not ready
  // -----------------------------------------------------------------------

  test('synthesize() does nothing when status is not ready', async () => {
    const { ttsService } = await import('./tts_service.svelte');

    (ttsService as unknown as Record<string, unknown>).status = 'uninitialized';
    (ttsService as unknown as Record<string, unknown>)._worker = null;

    const callsBefore = (workerMockState.postMessage as ReturnType<typeof mock>).mock.calls.length;

    await ttsService.synthesize({
      text: 'Hello world.',
      voice: 'af_bella',
    });

    // No new postMessage calls
    const callsAfter = (workerMockState.postMessage as ReturnType<typeof mock>).mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });

  // -----------------------------------------------------------------------
  // AC: synthesize() is a no-op on empty text
  // -----------------------------------------------------------------------

  test('synthesize() does nothing with empty text', async () => {
    const { ttsService } = await import('./tts_service.svelte');

    (ttsService as unknown as Record<string, unknown>).status = 'ready';
    (ttsService as unknown as Record<string, unknown>)._worker = {
      postMessage: workerMockState.postMessage,
    } as unknown as Worker;

    const callsBefore = (workerMockState.postMessage as ReturnType<typeof mock>).mock.calls.length;

    await ttsService.synthesize({ text: '', voice: 'af_bella' });
    await ttsService.synthesize({ text: '   ', voice: 'af_bella' });

    const callsAfter = (workerMockState.postMessage as ReturnType<typeof mock>).mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });
});
