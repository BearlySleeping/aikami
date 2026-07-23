// packages/frontend/ai-gateway/tests/adapter_contract.test.ts
//
// AC-4 (C-320): shared adapter-contract suite. Every registered adapter —
// offline text, byok text, service stub text, image, voice — must surface
// failures exclusively as AiGatewayException, honor AbortSignal with
// 'cancelled', and never crash with raw errors. Also covers the service
// mode_unavailable guard at resolution and dispatch.

import { describe, expect, test } from 'bun:test';
import type { AiModeResolution } from '@aikami/types';
import {
  createAdapterRegistry,
  createAiProviderGateway,
  createDelegatingImageAdapter,
  createDelegatingVoiceAdapter,
  createModeResolver,
  createOpenAiCompatibleTextAdapter,
  createServiceStubTextAdapter,
  isAiGatewayError,
} from '../src/index.ts';
import { createJsonFetchMock, createSseFetchMock, mixedModeConfig } from './helpers.ts';

const textResolution: AiModeResolution = {
  capability: 'text',
  mode: 'offline',
  provider: 'ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'llama3',
};

const abortedSignal = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

// ---------------------------------------------------------------------------
// Shared contract: every adapter normalizes failures to AiGatewayException
// ---------------------------------------------------------------------------

describe('Adapter contract — uniform AiGatewayError surface', () => {
  const failingFetch = (() =>
    Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;

  type ContractCase = {
    name: string;
    run: (signal: AbortSignal) => Promise<unknown>;
  };

  const cases: ContractCase[] = [
    {
      name: 'openai-compatible text adapter (offline)',
      run: (signal) =>
        createOpenAiCompatibleTextAdapter({ fetchFn: failingFetch }).generateText({
          resolution: textResolution,
          signal,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
    },
    {
      name: 'openai-compatible text adapter (byok)',
      run: (signal) =>
        createOpenAiCompatibleTextAdapter({ fetchFn: failingFetch }).generateText({
          resolution: { ...textResolution, mode: 'byok', provider: 'openrouter' },
          signal,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
    },
    {
      name: 'service stub text adapter',
      run: (signal) =>
        createServiceStubTextAdapter({ failWith: 'provider_unreachable' }).generateText({
          resolution: { ...textResolution, mode: 'service', provider: 'aikami_service_stub' },
          signal,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
    },
    {
      name: 'image adapter',
      run: (signal) =>
        createDelegatingImageAdapter({
          generate: () => Promise.reject(new Error('ComfyUI API error (500): boom')),
        }).generateImage({
          resolution: { capability: 'image', mode: 'offline', provider: 'comfyui' },
          signal,
          prompt: 'a castle',
        }),
    },
    {
      name: 'voice adapter',
      run: (signal) =>
        createDelegatingVoiceAdapter({
          synthesize: () => Promise.reject(new Error('Kokoro server unreachable')),
        }).generateVoice({
          resolution: { capability: 'voice', mode: 'offline', provider: 'kokoro' },
          signal,
          text: 'Hello',
        }),
    },
  ];

  for (const contractCase of cases) {
    test(`${contractCase.name} — failure surfaces as AiGatewayException`, async () => {
      const controller = new AbortController();
      try {
        await contractCase.run(controller.signal);
        throw new Error('expected rejection');
      } catch (error) {
        expect(isAiGatewayError(error)).toBe(true);
        if (isAiGatewayError(error)) {
          expect(error.capability).toBeDefined();
          expect(error.mode).toBeDefined();
          expect(typeof error.retryable).toBe('boolean');
          expect(error.message.length).toBeGreaterThan(0);
        }
      }
    });

    test(`${contractCase.name} — pre-aborted signal yields 'cancelled'`, async () => {
      try {
        await contractCase.run(abortedSignal());
        throw new Error('expected rejection');
      } catch (error) {
        expect(isAiGatewayError(error)).toBe(true);
        if (isAiGatewayError(error)) {
          expect(error.code).toBe('cancelled');
          expect(error.retryable).toBe(false);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Stub adapter passes the same happy-path contract as real adapters
// ---------------------------------------------------------------------------

describe('Service stub adapter — deterministic behavior', () => {
  test('emits chunks in order and returns accumulated text', async () => {
    const adapter = createServiceStubTextAdapter({ chunks: ['A', 'B', 'C'] });
    const received: string[] = [];
    const controller = new AbortController();

    const result = await adapter.generateText({
      resolution: { capability: 'text', mode: 'service', provider: 'aikami_service_stub' },
      signal: controller.signal,
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text) => received.push(text),
    });

    expect(received).toEqual(['A', 'B', 'C']);
    expect(result.text).toBe('ABC');
  });

  test('returns structured payload when a schema is requested', async () => {
    const adapter = createServiceStubTextAdapter({ structured: { name: 'Stub' } });
    const controller = new AbortController();

    const result = await adapter.generateText({
      resolution: { capability: 'text', mode: 'service', provider: 'aikami_service_stub' },
      signal: controller.signal,
      messages: [{ role: 'user', content: 'Hi' }],
      schema: { type: 'object', properties: { name: { type: 'string' } } },
      schemaName: 'StubSchema',
    });

    expect(result.structured).toEqual({ name: 'Stub' });
  });
});

// ---------------------------------------------------------------------------
// Service mode guard (mode_unavailable) at resolution and dispatch
// ---------------------------------------------------------------------------

describe('Service mode guard — mode_unavailable', () => {
  test('resolveMode throws mode_unavailable when service is not activated', () => {
    const resolver = createModeResolver({
      getConfig: () => ({
        text: { mode: 'service', provider: 'aikami_service' },
        serviceActivated: false,
      }),
    });

    try {
      resolver({ capability: 'text' });
      throw new Error('expected throw');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.code).toBe('mode_unavailable');
        expect(error.mode).toBe('service');
      }
    }
  });

  test('resolveMode succeeds when service is activated', () => {
    const resolver = createModeResolver({
      getConfig: () => ({
        text: { mode: 'service', provider: 'aikami_service' },
        serviceActivated: true,
      }),
    });

    const resolution = resolver({ capability: 'text' });
    expect(resolution.mode).toBe('service');
    expect(resolution.provider).toBe('aikami_service');
  });

  test('explicit service-mode dispatch with no registered adapter throws mode_unavailable', async () => {
    const registry = createAdapterRegistry();
    const gateway = createAiProviderGateway({
      registry,
      resolveMode: createModeResolver({ getConfig: mixedModeConfig }),
    });

    try {
      await gateway.generateText({
        messages: [{ role: 'user', content: 'Hi' }],
        mode: 'service',
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.code).toBe('mode_unavailable');
      }
    }
  });

  test('unconfigured capability resolves to not_configured', () => {
    const resolver = createModeResolver({ getConfig: () => ({}) });
    try {
      resolver({ capability: 'image' });
      throw new Error('expected throw');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.code).toBe('not_configured');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Gateway-level dispatch: mixed modes per capability + cancelAll
// ---------------------------------------------------------------------------

describe('Gateway dispatch — mixed-mode resolution and cancellation', () => {
  test('mixed modes: text offline + image byok resolve independently', async () => {
    const registry = createAdapterRegistry();
    // Ollama offline text uses native /api/chat → plain JSON response
    const { fetchFn } = createJsonFetchMock();
    registry.registerText({
      mode: 'offline',
      adapter: createOpenAiCompatibleTextAdapter({ fetchFn }),
    });
    registry.registerImage({
      mode: 'byok',
      adapter: createDelegatingImageAdapter({
        generate: () => Promise.resolve({ url: 'blob:image' }),
      }),
    });

    const dispatched: AiModeResolution[] = [];
    const gateway = createAiProviderGateway({
      registry,
      resolveMode: createModeResolver({ getConfig: mixedModeConfig }),
      onDispatch: (resolution) => dispatched.push(resolution),
    });

    const textResult = await gateway.generateText({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const imageResult = await gateway.generateImage({ prompt: 'a castle' });

    expect(textResult.text.length).toBeGreaterThan(0);
    expect(imageResult.url).toBe('blob:image');
    expect(dispatched[0].mode).toBe('offline');
    expect(dispatched[0].capability).toBe('text');
    expect(dispatched[1].mode).toBe('byok');
    expect(dispatched[1].capability).toBe('image');
  });

  test('resolution is exposed exactly once per call via onResolve', async () => {
    const registry = createAdapterRegistry();
    // Ollama offline text uses native /api/chat → plain JSON response
    const { fetchFn } = createJsonFetchMock();
    registry.registerText({
      mode: 'offline',
      adapter: createOpenAiCompatibleTextAdapter({ fetchFn }),
    });

    const gateway = createAiProviderGateway({
      registry,
      resolveMode: createModeResolver({ getConfig: mixedModeConfig }),
    });

    const resolutions: AiModeResolution[] = [];
    await gateway.generateText({
      messages: [{ role: 'user', content: 'Hi' }],
      onResolve: (resolution) => resolutions.push(resolution),
    });

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].provider).toBe('ollama');
  });

  test('cancelAll aborts in-flight calls with cancelled errors', async () => {
    const registry = createAdapterRegistry();
    // A fetch that never resolves until aborted.
    const hangingFetch = ((_input: unknown, init?: RequestInit): Promise<Response> =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      })) as typeof fetch;
    registry.registerText({
      mode: 'offline',
      adapter: createOpenAiCompatibleTextAdapter({ fetchFn: hangingFetch }),
    });

    const gateway = createAiProviderGateway({
      registry,
      resolveMode: createModeResolver({ getConfig: mixedModeConfig }),
    });

    const pending = gateway.generateText({ messages: [{ role: 'user', content: 'Hi' }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    gateway.cancelAll();

    try {
      await pending;
      throw new Error('expected rejection');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.code).toBe('cancelled');
      }
    }
  });
});
