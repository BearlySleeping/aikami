// apps/frontend/client/src/lib/services/config/provider_endpoints.test.ts
//
// Registry coverage for model discovery and model testing:
//  - transport-policy coverage for credentialed model discovery
//  - per-provider chat-test request shapes (every provider that can chat)

import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ModelFetchConfig } from './provider_endpoints.ts';
import {
  fetchModelsFromProvider,
  PROVIDER_MODEL_FETCH,
  resolveChatTestRequest,
} from './provider_endpoints.ts';

const originalFetch = globalThis.fetch;

const configFor = (url: string): ModelFetchConfig => ({
  url,
  auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
  parseResponse: (json) => (json as { data: Array<{ id: string; name: string }> }).data,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchModelsFromProvider transport policy', () => {
  test('does not send credentials over HTTP', async () => {
    const fetchMock = mock(async () => Response.json({ data: [] }));
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('http://models.example.test/v1/models'),
      apiKey: 'secret-key',
    });

    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('permits keyless model discovery over HTTP', async () => {
    const fetchMock = mock(async () =>
      Response.json({ data: [{ id: 'local-model', name: 'Local model' }] }),
    );
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('http://localhost:11434/v1/models'),
    });

    expect(models).toEqual([{ id: 'local-model', name: 'Local model' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('does not forward credentials to an unapproved redirect origin', async () => {
    const fetchMock = mock(
      async () =>
        new Response(undefined, {
          status: 302,
          headers: { location: 'https://other.example.test/v1/models' },
        }),
    );
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('https://models.example.test/v1/models'),
      apiKey: 'secret-key',
    });

    expect(models).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('allows credential forwarding across approved HTTPS hops', async () => {
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (String(url).endsWith('/v1/models')) {
        return new Response(undefined, {
          status: 302,
          headers: { location: '/v2/models' },
        });
      }
      return Response.json({ data: [{ id: 'secure-model', name: 'Secure model' }] });
    });
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('https://models.example.test/v1/models'),
      apiKey: 'secret-key',
    });

    expect(models).toEqual([{ id: 'secure-model', name: 'Secure model' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('rejects URL user-info credentials before sending a request', async () => {
    const fetchMock = mock(async () => Response.json({ data: [] }));
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('https://user:password@models.example.test/v1/models'),
    });

    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resolveChatTestRequest', () => {
  test('openrouter uses the OpenAI-compatible chat endpoint', () => {
    const request = resolveChatTestRequest({
      registryId: 'openrouter',
      model: 'anthropic/claude-sonnet',
      apiKey: 'sk-or-v1-test',
    });

    expect(request?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request?.headers.Authorization).toBe('Bearer sk-or-v1-test');
    const body = JSON.parse(request?.body ?? '{}') as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('anthropic/claude-sonnet');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  test('google builds a generateContent request with a query key', () => {
    const request = resolveChatTestRequest({
      registryId: 'google',
      model: 'gemini-2.0-flash',
      apiKey: 'AIza-test-key',
    });

    expect(request?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIza-test-key',
    );
    const body = JSON.parse(request?.body ?? '{}') as {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.contents[0].parts[0].text).toBe('hi');
    expect(body.generationConfig.maxOutputTokens).toBe(5);
  });

  test('google strips a models/ prefix from the model id', () => {
    const request = resolveChatTestRequest({
      registryId: 'google',
      model: 'models/gemini-2.0-flash',
      apiKey: 'k',
    });

    expect(request?.url).toContain('/v1beta/models/gemini-2.0-flash:generateContent');
  });

  test('anthropic builds a /v1/messages request', () => {
    const request = resolveChatTestRequest({
      registryId: 'anthropic',
      model: 'claude-3-opus-20240229',
      apiKey: 'sk-ant-test',
    });

    expect(request?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request?.headers['x-api-key']).toBe('sk-ant-test');
    expect(request?.headers['anthropic-version']).toBe('2023-06-01');
    // biome-ignore lint/style/useNamingConvention: Anthropic API contract field name
    const body = JSON.parse(request?.body ?? '{}') as { model: string; max_tokens: number };
    expect(body.model).toBe('claude-3-opus-20240229');
    expect(body.max_tokens).toBe(5);
  });

  test('ollama resolves against the draft base URL', () => {
    const request = resolveChatTestRequest({
      registryId: 'ollama',
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
    });

    expect(request?.url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(request?.body ?? '{}') as { stream: boolean };
    expect(body.stream).toBe(false);
  });

  test('an unknown provider yields no request', () => {
    expect(resolveChatTestRequest({ registryId: 'does-not-exist', model: 'x' })).toBeUndefined();
  });
});

describe('google models parsing', () => {
  test('strips models/ prefixes and filters out non-chat models', () => {
    const parse = PROVIDER_MODEL_FETCH.google.parseResponse;
    const models = parse({
      models: [
        {
          name: 'models/gemini-2.0-flash',
          displayName: 'Gemini 2.0 Flash',
          supportedGenerationMethods: ['generateContent'],
        },
        {
          name: 'models/gemini-embedding-001',
          displayName: 'Embedding',
          supportedGenerationMethods: ['generateEmbeddingContent'],
        },
      ],
    });

    expect(models).toEqual([{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }]);
  });
});

describe('fetchModelsFromProvider query-param auth', () => {
  test('google appends the key as a query param on the models list', async () => {
    let calledUrl: string | undefined;
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return Response.json({ models: [] });
    });
    globalThis.fetch = fetchMock;

    const result = await fetchModelsFromProvider({
      config: PROVIDER_MODEL_FETCH.google,
      apiKey: 'AIza-test-key',
    });

    expect(calledUrl).toContain('?key=AIza-test-key');
    expect(result).toEqual([]);
  });
});
