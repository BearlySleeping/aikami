/** biome-ignore-all lint/style/useNamingConvention: Test data mocks ComfyUI API responses */
// packages/frontend/api-core/tests/ai/comfyui_client.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ComfyUiClient } from '../../src/ai/clients/comfyui_client.ts';

describe('ComfyUiClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  it('constructs with valid options', () => {
    const client = new ComfyUiClient({ workflowId: 'test-wf' });

    expect(client.name).toBe('comfyui');
  });

  it('throws when workflowId is missing', () => {
    expect(() => new ComfyUiClient({})).toThrow('requires a workflowId');
  });

  // -----------------------------------------------------------------------
  // Capabilities
  // -----------------------------------------------------------------------

  it('has correct capabilities', () => {
    const client = new ComfyUiClient({ workflowId: 'test-wf' });

    expect(client.capabilities.dialogue).toBe(false);
    expect(client.capabilities.contentDescription).toBe(false);
    expect(client.capabilities.speech).toBe(false);
    expect(client.capabilities.image).toBe(true);
    expect(client.capabilities.structured).toBe(false);
    expect(client.capabilities.requiresBackend).toBe(false);
    expect(client.capabilities.isLocal).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Unsupported methods throw
  // -----------------------------------------------------------------------

  it('generateDialogue throws (not supported)', async () => {
    const client = new ComfyUiClient({ workflowId: 'test-wf' });

    expect(
      client.generateDialogue({ npcId: 'n1', npcName: 'N', playerInput: 'Hi' }),
    ).rejects.toThrow('does not support dialogue');
  });

  it('generateContentDescription throws (not supported)', async () => {
    const client = new ComfyUiClient({ workflowId: 'test-wf' });

    expect(client.generateContentDescription('test')).rejects.toThrow(
      'does not support content description',
    );
  });

  it('synthesizeSpeech throws (not supported)', async () => {
    const client = new ComfyUiClient({ workflowId: 'test-wf' });

    expect(client.synthesizeSpeech('hello')).rejects.toThrow('does not support speech');
  });

  it('generateStructured throws (not supported)', async () => {
    const client = new ComfyUiClient({ workflowId: 'test-wf' });

    const { z } = await import('zod');

    expect(client.generateStructured('test', z.object({}))).rejects.toThrow(
      'does not support structured data',
    );
  });

  // -----------------------------------------------------------------------
  // generateImage — full workflow (mock 2-phase API)
  // -----------------------------------------------------------------------

  it('generateImage queues prompt and polls for result', async () => {
    let callCount = 0;
    let promptId = '';

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      callCount++;

      if (url.includes('/prompt') && callCount === 1) {
        // First call: queue prompt
        promptId = 'prompt-123';

        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          redirected: false,
          type: 'basic',
          url,
          body: null as unknown as ReadableStream<Uint8Array>,
          bodyUsed: false,
          json: async () => ({ prompt_id: promptId, number: 1, node_errors: {} }),
          text: async () => JSON.stringify({ prompt_id: promptId, number: 1, node_errors: {} }),
        } as Response;
      }

      if (url.includes(`/history/${promptId}`)) {
        // Second call: poll for result
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          redirected: false,
          type: 'basic',
          url,
          body: null as unknown as ReadableStream<Uint8Array>,
          bodyUsed: false,
          json: async () => ({
            [promptId]: {
              outputs: {
                '9': {
                  images: [{ filename: 'game-gen_0001.png', subfolder: null, type: 'output' }],
                },
              },
              status: { completed: true, messages: [] },
            },
          }),
          text: async () => '{}',
        } as Response;
      }

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
    };

    const client = new ComfyUiClient({ workflowId: 'test-wf', timeoutMs: 10000 });
    const result = await client.generateImage('a fantasy castle', { width: 512, height: 512 });

    expect(result.imageUrl).toContain('game-gen_0001.png');
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.mimeType).toBe('image/png');
  });

  // -----------------------------------------------------------------------
  // healthCheck
  // -----------------------------------------------------------------------

  it('healthCheck returns available when ComfyUI is running', async () => {
    globalThis.fetch = async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        redirected: false,
        type: 'basic',
        url: '',
        body: null as unknown as ReadableStream<Uint8Array>,
        bodyUsed: false,
        json: async () => ({}),
        text: async () => '{}',
      } as Response;
    };

    const client = new ComfyUiClient({ workflowId: 'test-wf' });
    const result = await client.healthCheck();

    expect(result.available).toBe(true);
    expect(result.message).toContain('ComfyUI');
  });

  it('healthCheck returns unavailable when ComfyUI is not running', async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error('Failed to fetch');
    };

    const client = new ComfyUiClient({ workflowId: 'test-wf' });
    const result = await client.healthCheck();

    expect(result.available).toBe(false);
  });
});
