// apps/frontend/client/src/lib/services/audio/tts_service.test.ts

/**
 * Unit tests for TtsService (C-389): config-driven modes, honest backend
 * reporting, no blind voice probing (AC-7), server-mode on the configured
 * port (AC-8), and the never-implicit voice-model download gate (AC-4b).
 *
 * Mocks the Worker global to test the initialization and synthesis
 * lifecycle without requiring a real WebGPU backend.
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
// Shared state resets
// ---------------------------------------------------------------------------

type Service = Record<string, unknown>;

const resetTtsService = async (): Promise<{
  ttsService: import('./tts_service.svelte.ts').TtsServiceInterface;
}> => {
  const mod = await import('./tts_service.svelte.ts');
  const svc = mod.ttsService as unknown as Service;
  svc.status = 'uninitialized';
  svc.errorMessage = null;
  svc.backend = 'unavailable';
  svc._worker = null;
  svc._kokoroServerUrl = undefined;
  svc.isKokoroServerAvailable = false;
  return mod as unknown as {
    ttsService: import('./tts_service.svelte.ts').TtsServiceInterface;
  };
};

const setupFetchSpy = (): ReturnType<typeof mock> => {
  const fetchMock = mock(async () => new Response('', { status: 404 }));
  // @ts-expect-error — replacing global fetch
  globalThis.fetch = fetchMock;
  return fetchMock;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TtsService — C-389 config-driven TTS', () => {
  beforeEach(() => {
    setupWorkerMock();
  });

  afterEach(() => {
    teardownWorkerMock();
    delete (globalThis as Record<string, unknown>).fetch;
  });

  // -----------------------------------------------------------------------
  // AC-4b: the voice model is never downloaded implicitly
  // -----------------------------------------------------------------------

  test('initialize() reports not-downloaded and spawns no worker when the model is missing', async () => {
    const fetchMock = setupFetchSpy();
    const { ttsService } = await resetTtsService();

    await ttsService.initialize();

    expect(ttsService.status).toBe('not-downloaded');
    expect(ttsService.backend).toBe('unavailable');
    expect(workerMockState.instances.length).toBe(0);
    // AC-7: no blind probing — the only fetch may be config.json, never a
    // voice port or speech endpoint.
    for (const call of (fetchMock as ReturnType<typeof mock>).mock.calls) {
      const href = typeof call[0] === 'string' ? call[0] : (call[0] as URL).href;
      expect(href).not.toContain('8880');
      expect(href).not.toContain('/v1/audio/speech');
      expect(href).not.toContain(':6006');
    }
  });

  test('synthesize() is a no-op when the model is not downloaded (no implicit download)', async () => {
    const fetchMock = setupFetchSpy();
    const { ttsService } = await resetTtsService();
    (ttsService as unknown as Service).status = 'not-downloaded';
    (ttsService as unknown as Service).backend = 'unavailable';

    await ttsService.synthesize({ text: 'Hello', voice: 'af_heart' });

    expect(workerMockState.postMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // AC-4 / AC-6: browser mode happy path + honest backend reporting
  // -----------------------------------------------------------------------

  test('initialize() spawns the worker with vendored wasm path when the model is ready', async () => {
    setupFetchSpy();
    const { ttsService } = await resetTtsService();

    // Stub the voice model as already downloaded.
    const voiceModel = await import('./voice_model_service.svelte.ts');
    (voiceModel.voiceModelService as unknown as Service).checkStatus = mock(async () => ({
      status: 'ready',
    }));

    await ttsService.initialize();

    expect(workerMockState.instances.length).toBeGreaterThan(0);
    const initCall = (workerMockState.postMessage as ReturnType<typeof mock>).mock.calls[0]?.[0];
    expect(initCall.action).toBe('initialize');
    expect(initCall.wasmPath).toContain('/ort/');
    expect(initCall.modelId).toBe('onnx-community/Kokoro-82M-ONNX');
    expect(initCall.revision).not.toBe('main');
  });

  test('worker ready response reports the wasm backend when WebGPU is absent', async () => {
    setupFetchSpy();
    const { ttsService } = await resetTtsService();
    const voiceModel = await import('./voice_model_service.svelte.ts');
    (voiceModel.voiceModelService as unknown as Service).checkStatus = mock(async () => ({
      status: 'ready',
    }));
    // No WebGPU in the test environment.
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });

    const initPromise = ttsService.initialize();
    await new Promise((r) => setTimeout(r, 10));
    simulateWorkerMessage({ type: 'ready', backend: 'wasm' });
    await initPromise;

    expect(ttsService.status).toBe('ready');
    expect(ttsService.backend).toBe('wasm');
  });

  test('synthesize() posts synthesize message when the worker is ready', async () => {
    setupFetchSpy();
    const { ttsService } = await resetTtsService();
    (ttsService as unknown as Service).status = 'ready';
    (ttsService as unknown as Service).backend = 'wasm';
    (ttsService as unknown as Service)._worker = {
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
  // AC-7: no blind voice probing
  // -----------------------------------------------------------------------

  test('checkKokoroServer() performs no fetch when no URL is configured', async () => {
    const fetchMock = setupFetchSpy();
    const { ttsService } = await resetTtsService();

    await ttsService.checkKokoroServer();

    expect(ttsService.isKokoroServerAvailable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // AC-8: server mode works on the configured port
  // -----------------------------------------------------------------------

  test('initialize() probes only the configured server URL in server mode', async () => {
    const fetchMock = setupFetchSpy();
    const { ttsService } = await resetTtsService();

    // Configure server-mode TTS pointing at a non-default port.
    const runtimeConfig = await import('../config/runtime_config_service.svelte.ts');
    const runtimeSvc = runtimeConfig.runtimeConfigService as unknown as Service & {
      loadConfig: () => Promise<unknown>;
    };
    runtimeSvc.engineConfig = {
      text: { url: undefined, model: undefined },
      image: { url: undefined, engine: 'auto' },
      voice: {
        tts: { mode: 'server', url: 'http://10.0.0.7:6006' },
        stt: { url: undefined },
      },
      models: { originUrl: undefined },
    };
    // C-389 CR: stub loadConfig — when this test runs before any other
    // initialize() call has primed the cache, the first loadConfig() would
    // overwrite engineConfig above. Stub it so the assignment is stable
    // regardless of test order; restore afterwards.
    const originalLoadConfig = runtimeSvc.loadConfig;
    runtimeSvc.loadConfig = mock(async () => ({}));
    try {
      fetchMock.mockImplementation(async (url: string | URL) => {
        const href = typeof url === 'string' ? url : url.href;
        if (href.includes(':6006')) {
          return new Response('ok', { status: 200 });
        }
        return new Response('nope', { status: 404 });
      });

      await ttsService.initialize();

      expect(ttsService.status).toBe('ready');
      expect(ttsService.backend).toBe('server');
      // Every fetch targeted the configured port — never a localhost literal.
      for (const call of (fetchMock as ReturnType<typeof mock>).mock.calls) {
        const href = typeof call[0] === 'string' ? call[0] : (call[0] as URL).href;
        expect(href).toContain(':6006');
        expect(href).not.toContain('localhost');
      }
    } finally {
      runtimeSvc.loadConfig = originalLoadConfig;
    }
  });

  test('server mode synthesize() posts to the configured URL', async () => {
    const fetchMock = mock(async () => {
      const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
      return new Response(wav, { status: 200 });
    });
    // @ts-expect-error — replacing global fetch
    globalThis.fetch = fetchMock;
    const { ttsService } = await resetTtsService();
    (ttsService as unknown as Service).status = 'ready';
    (ttsService as unknown as Service).backend = 'server';
    (ttsService as unknown as Service).isKokoroServerAvailable = true;
    (ttsService as unknown as Service)._kokoroServerUrl = 'http://10.0.0.7:6006';

    await ttsService.synthesize({ text: 'Hello', voice: 'af_heart' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = (fetchMock as ReturnType<typeof mock>).mock.calls[0][0];
    expect(String(url)).toContain('http://10.0.0.7:6006/v1/audio/speech');
  });
});
