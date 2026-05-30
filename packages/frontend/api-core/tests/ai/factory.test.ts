// packages/frontend/api-core/tests/ai/factory.test.ts

import { describe, expect, it } from 'bun:test';

import { GameApiClient } from '../../src/api/game_api_client.ts';
import { createAiClient } from '../../src/ai/factory.ts';
import type { MockAiClient } from '../../src/ai/mock/mock_ai_client.ts';

describe('createAiClient factory', () => {
  // -----------------------------------------------------------------------
  // AC-6: Factory creates correct provider
  // -----------------------------------------------------------------------

  it('creates OpenAiClient with openai provider', async () => {
    const apiClient = new GameApiClient({ baseUrl: 'http://localhost:5001' });
    const client = await createAiClient('openai', { apiClient });

    expect(client.name).toBe('openai');
    expect(client.capabilities.requiresBackend).toBe(true);
    expect(client.capabilities.isLocal).toBe(false);
  });

  it('creates GeminiClient with gemini provider', async () => {
    const apiClient = new GameApiClient({ baseUrl: 'http://localhost:5001' });
    const client = await createAiClient('gemini', { apiClient });

    expect(client.name).toBe('gemini');
    expect(client.capabilities.requiresBackend).toBe(true);
  });

  it('creates OllamaClient with ollama provider', async () => {
    const client = await createAiClient('ollama', {
      ollama: { model: 'llama3' },
    });

    expect(client.name).toBe('ollama');
    expect(client.capabilities.isLocal).toBe(true);
    expect(client.capabilities.requiresBackend).toBe(false);
  });

  it('creates ComfyUiClient with comfyui provider', async () => {
    const client = await createAiClient('comfyui', {
      comfyui: { workflowId: 'test-workflow' },
    });

    expect(client.name).toBe('comfyui');
    expect(client.capabilities.isLocal).toBe(true);
    expect(client.capabilities.image).toBe(true);
  });

  it('creates LocalTtsClient with local-tts provider', async () => {
    const client = await createAiClient('local-tts');

    expect(client.name).toBe('local-tts');
    expect(client.capabilities.isLocal).toBe(true);
    // speech capability depends on browser environment — may be false in headless/Bun
    expect(typeof client.capabilities.speech).toBe('boolean');
  });

  it('creates MockAiClient with mock provider', async () => {
    const client = await createAiClient('mock');
    const mockClient = client as unknown as MockAiClient;

    expect(client.name).toBe('mock');
    expect(mockClient.reset).toBeDefined();
    expect(mockClient.getCallHistory).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Error cases
  // -----------------------------------------------------------------------

  it('throws when openai provider is missing apiClient', async () => {
    expect(
      createAiClient('openai'),
    ).rejects.toThrow('requires an apiClient');
  });

  it('throws when gemini provider is missing apiClient', async () => {
    expect(
      createAiClient('gemini'),
    ).rejects.toThrow('requires an apiClient');
  });

  it('throws when comfyui provider is missing workflowId', async () => {
    expect(
      createAiClient('comfyui', { comfyui: {} }),
    ).rejects.toThrow('requires a workflowId');
  });

  it('throws for unknown provider', async () => {
    expect(
      createAiClient('unknown' as never),
    ).rejects.toThrow('Unsupported AI provider');
  });
});
