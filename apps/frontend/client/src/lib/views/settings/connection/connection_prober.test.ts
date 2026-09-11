// apps/frontend/client/src/lib/views/settings/connection/connection_prober.test.ts
//
// Unit tests for the Connection Manager's transport helpers. These functions
// own timeouts, abort handling, and response-shape parsing, so they are tested
// without a ViewModel by installing a stubbed global fetch.

import { afterEach, describe, expect, test } from 'bun:test';
import type { Connection } from '@aikami/types';
import {
  probeDraftConnection,
  probeOllamaRuntime,
  probeSavedConnection,
} from './connection_prober.ts';

const originalFetch = globalThis.fetch;

const installFetch = (handler: (url: string | URL) => Promise<Response>): void => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: handler,
  });
};

afterEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
});

const createConnection = (overrides: Partial<Connection> = {}): Connection => ({
  id: 'conn-1',
  provider: 'openrouter',
  capability: 'text',
  name: 'Test',
  model: '',
  apiKey: 'sk-test',
  baseUrl: '',
  isDefault: false,
  generationParams: {
    temperature: 0.7,
    topP: 1,
    topK: 40,
    repetitionPenalty: 1,
    presencePenalty: 0,
    maxTokens: 2048,
    contextSize: 4096,
  },
  ...overrides,
});

describe('probeSavedConnection', () => {
  test('records an explicit failure for an unknown provider', async () => {
    const result = await probeSavedConnection({
      connection: createConnection({ provider: 'mystery' }),
      ollamaUrl: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown provider');
  });

  test('reports a missing API key for a cloud provider', async () => {
    const result = await probeSavedConnection({
      connection: createConnection({ apiKey: '' }),
      ollamaUrl: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('No API key configured');
  });

  test('reports a missing Ollama endpoint', async () => {
    const result = await probeSavedConnection({
      connection: createConnection({ provider: 'ollama' }),
      ollamaUrl: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('No Ollama endpoint configured');
  });

  test('parses the Ollama model count on success', async () => {
    installFetch(
      async () => new Response(JSON.stringify({ models: [{}, {}, {}] }), { status: 200 }),
    );
    const result = await probeSavedConnection({
      connection: createConnection({ provider: 'ollama' }),
      ollamaUrl: 'http://localhost:11434/api/tags',
    });
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(3);
  });

  test('parses the OpenAI-compatible model count on success', async () => {
    installFetch(async () => new Response(JSON.stringify({ data: [{}, {}] }), { status: 200 }));
    const result = await probeSavedConnection({
      connection: createConnection({ provider: 'openrouter' }),
      ollamaUrl: undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(2);
  });

  test('surfaces an HTTP failure status', async () => {
    installFetch(async () => new Response('nope', { status: 503 }));
    const result = await probeSavedConnection({
      connection: createConnection({ provider: 'openrouter' }),
      ollamaUrl: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('HTTP 503');
  });
});

describe('probeDraftConnection', () => {
  test('records an explicit failure for an unknown provider', async () => {
    const result = await probeDraftConnection({
      draft: { provider: 'mystery', apiKey: 'key' },
      ollamaUrl: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown provider');
  });

  test('reports a missing Ollama endpoint with the config hint', async () => {
    const result = await probeDraftConnection({
      draft: { provider: 'ollama' },
      ollamaUrl: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('text.url');
  });
});

describe('probeOllamaRuntime', () => {
  test('reports a missing endpoint without probing', async () => {
    const result = await probeOllamaRuntime({ ollamaUrl: undefined });
    expect(result.checking).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('text.url');
  });

  test('reports reachability and model count', async () => {
    installFetch(async () => new Response(JSON.stringify({ models: [{}] }), { status: 200 }));
    const result = await probeOllamaRuntime({ ollamaUrl: 'http://localhost:11434/api/tags' });
    expect(result.checking).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(1);
  });
});
