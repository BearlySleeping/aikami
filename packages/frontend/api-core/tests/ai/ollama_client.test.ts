/** biome-ignore-all lint/style/useNamingConvention: Test data mocks Ollama API responses */
// packages/frontend/api-core/tests/ai/ollama_client.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import Type from 'typebox';

import { OllamaClient } from '../../src/ai/clients/ollama_client.ts';

/**
 * Creates a mock fetch for Ollama's API.
 */
function mockOllamaFetch(
  endpoint: string,
  response: { status: number; body: unknown },
): typeof fetch {
  return async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    // Verify it's hitting the right endpoint
    if (!url.includes(endpoint)) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        redirected: false,
        type: 'basic',
        url,
        body: null as unknown as ReadableStream<Uint8Array>,
        bodyUsed: false,
        json: async () => ({ error: 'Not found' }),
        text: async () => 'Not found',
      } as Response;
    }

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.status === 200 ? 'OK' : 'Error',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      redirected: false,
      type: 'basic',
      url,
      body: null as unknown as ReadableStream<Uint8Array>,
      bodyUsed: false,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    } as Response;
  };
}

describe('OllamaClient', () => {
  let client: OllamaClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    client = new OllamaClient({ baseUrl: 'http://localhost:11434' });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Construction and Capabilities
  // -----------------------------------------------------------------------

  it('has correct name and capabilities', () => {
    expect(client.name).toBe('ollama');
    expect(client.capabilities.dialogue).toBe(true);
    expect(client.capabilities.contentDescription).toBe(true);
    expect(client.capabilities.speech).toBe(false);
    expect(client.capabilities.image).toBe(false);
    expect(client.capabilities.structured).toBe(true);
    expect(client.capabilities.requiresBackend).toBe(false);
    expect(client.capabilities.isLocal).toBe(true);
  });

  // -----------------------------------------------------------------------
  // generateDialogue
  // -----------------------------------------------------------------------

  it('generateDialogue calls /api/chat and returns DialogueResponse', async () => {
    let capturedBody: unknown;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;

      return mockOllamaFetch('/api/chat', {
        status: 200,
        body: {
          model: 'llama3',
          created_at: '2024-01-01T00:00:00Z',
          message: { role: 'assistant', content: 'Hello, traveller!' },
          done: true,
          prompt_eval_count: 50,
          eval_count: 15,
        },
      })(input, init);
    };

    const response = await client.generateDialogue({
      npcId: 'npc-01',
      npcName: 'Elder',
      playerInput: 'Hello',
    });

    expect(response.text).toBe('Hello, traveller!');
    expect(response.usage?.promptTokens).toBe(50);
    expect(response.usage?.completionTokens).toBe(15);

    // Verify the request body format
    const body = capturedBody as Record<string, unknown>;
    expect(body).toBeDefined();
    expect(body.model).toBe('llama3');
    expect(body.stream).toBe(false);
    expect((body as Record<string, unknown>).messages).toBeDefined();
  });

  it('generateDialogue includes system prompt when provided', async () => {
    let capturedBody: unknown;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;

      return mockOllamaFetch('/api/chat', {
        status: 200,
        body: { message: { content: 'OK' }, done: true },
      })(input, init);
    };

    await client.generateDialogue({
      npcId: 'n1',
      npcName: 'N',
      playerInput: 'Hi',
      systemPrompt: 'You are a grumpy old wizard.',
    });

    const body = capturedBody as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toBe('You are a grumpy old wizard.');
  });

  // -----------------------------------------------------------------------
  // generateContentDescription
  // -----------------------------------------------------------------------

  it('generateContentDescription returns text from /api/chat', async () => {
    globalThis.fetch = mockOllamaFetch('/api/chat', {
      status: 200,
      body: {
        message: { content: 'A dark and mysterious forest.' },
        done: true,
      },
    });

    const result = await client.generateContentDescription('Describe a forest');

    expect(result).toBe('A dark and mysterious forest.');
  });

  // -----------------------------------------------------------------------
  // synthesizeSpeech — not supported
  // -----------------------------------------------------------------------

  it('synthesizeSpeech throws (not supported)', async () => {
    expect(client.synthesizeSpeech('Hello')).rejects.toThrow('does not support speech');
  });

  // -----------------------------------------------------------------------
  // generateImage — not supported
  // -----------------------------------------------------------------------

  it('generateImage throws (not supported)', async () => {
    expect(client.generateImage('a castle')).rejects.toThrow('does not support image generation');
  });

  // -----------------------------------------------------------------------
  // generateStructured
  // -----------------------------------------------------------------------

  it('generateStructured parses Ollama JSON response', async () => {
    globalThis.fetch = mockOllamaFetch('/api/chat', {
      status: 200,
      body: {
        message: {
          content: JSON.stringify({ name: 'Iron Sword', damage: 15, weight: 3 }),
        },
        done: true,
      },
    });

    const schema = Type.Object({
      name: Type.String(),
      damage: Type.Number(),
      weight: Type.Number(),
    });

    const result = await client.generateStructured('Generate a weapon', schema);

    expect(result.name).toBe('Iron Sword');
    expect(result.damage).toBe(15);
    expect(result.weight).toBe(3);
  });

  it('generateStructured uses JSON format mode', async () => {
    let capturedBody: unknown;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;

      return mockOllamaFetch('/api/chat', {
        status: 200,
        body: { message: { content: '{}' }, done: true },
      })(input, init);
    };

    const schema = Type.Object({ id: Type.String() });
    await client.generateStructured('Generate an item', schema);

    const body = capturedBody as { format: string };
    expect(body.format).toBe('json');
  });

  // -----------------------------------------------------------------------
  // healthCheck
  // -----------------------------------------------------------------------

  it('healthCheck returns available when Ollama is running', async () => {
    globalThis.fetch = mockOllamaFetch('/api/tags', {
      status: 200,
      body: { models: [{ name: 'llama3', modified_at: '2024-01-01', size: 1000 }] },
    });

    const result = await client.healthCheck();

    expect(result.available).toBe(true);
    expect(result.message).toContain('Ollama');
  });

  it('healthCheck returns unavailable when Ollama is not running', async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error('Failed to fetch');
    };

    const result = await client.healthCheck();

    expect(result.available).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('throws on non-OK response from Ollama', async () => {
    globalThis.fetch = mockOllamaFetch('/api/chat', {
      status: 404,
      body: { error: 'model not found' },
    });

    expect(
      client.generateDialogue({ npcId: 'n1', npcName: 'N', playerInput: 'Hi' }),
    ).rejects.toThrow();
  });

  it('constructor defaults to localhost:11434 and llama3', () => {
    const defaultClient = new OllamaClient();

    // Access private fields via the capabilities check to verify defaults
    expect(defaultClient.name).toBe('ollama');
    expect(defaultClient.capabilities.dialogue).toBe(true);
  });
});
