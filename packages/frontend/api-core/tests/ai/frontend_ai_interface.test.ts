// packages/frontend/api-core/tests/ai/frontend_ai_interface.test.ts

import { describe, expect, it } from 'bun:test';
import type { z } from 'zod';

import type { FrontendAiInterface } from '../../src/ai/frontend_ai_interface.ts';
import { MockAiClient } from '../../src/ai/mock/mock_ai_client.ts';

/**
 * Contract test suite for the FrontendAiInterface.
 *
 * These tests verify that the interface contract is correctly implemented
 * by all providers. Currently run against MockAiClient. The same test
 * patterns apply when run against real providers (integration-tagged).
 */
describe('FrontendAiInterface contract (MockAiClient)', () => {
  let client: FrontendAiInterface;
  let mock: MockAiClient;

  /**
   * Helper: creates a fresh MockAiClient before each test.
   * For integration tests against real providers, replace this.
   */
  const createClient = (): FrontendAiInterface => {
    mock = new MockAiClient();

    return mock;
  };

  // -----------------------------------------------------------------------
  // Interface shape
  // -----------------------------------------------------------------------

  it('has name and capabilities properties', () => {
    client = createClient();

    expect(typeof client.name).toBe('string');
    expect(typeof client.capabilities).toBe('object');
    expect(typeof client.capabilities.dialogue).toBe('boolean');
    expect(typeof client.capabilities.contentDescription).toBe('boolean');
    expect(typeof client.capabilities.speech).toBe('boolean');
    expect(typeof client.capabilities.image).toBe('boolean');
    expect(typeof client.capabilities.structured).toBe('boolean');
    expect(typeof client.capabilities.requiresBackend).toBe('boolean');
    expect(typeof client.capabilities.isLocal).toBe('boolean');
  });

  it('exposes all 6 methods from FrontendAiInterface', () => {
    client = createClient();

    expect(typeof client.generateDialogue).toBe('function');
    expect(typeof client.generateContentDescription).toBe('function');
    expect(typeof client.synthesizeSpeech).toBe('function');
    expect(typeof client.generateImage).toBe('function');
    expect(typeof client.generateStructured).toBe('function');
    expect(typeof client.healthCheck).toBe('function');
  });

  // -----------------------------------------------------------------------
  // generateDialogue contract
  // -----------------------------------------------------------------------

  it('generateDialogue accepts DialogueContext and returns DialogueResponse', async () => {
    client = createClient();

    const response = await client.generateDialogue({
      npcId: 'test-npc',
      npcName: 'Test NPC',
      playerInput: 'Hello there',
    });

    expect(typeof response.text).toBe('string');
    expect(response.text.length).toBeGreaterThan(0);
  });

  it('generateDialogue accepts optional DialogueOptions', async () => {
    client = createClient();

    const response = await client.generateDialogue(
      { npcId: 'n1', npcName: 'N', playerInput: 'Hi' },
      { temperature: 0.5, maxTokens: 100 },
    );

    expect(typeof response.text).toBe('string');
  });

  it('generateDialogue includes usage metadata', async () => {
    mock = new MockAiClient();

    const response = await mock.generateDialogue({
      npcId: 'n1',
      npcName: 'N',
      playerInput: 'Hi',
    });

    expect(response.usage).toBeDefined();
    expect(response.usage?.promptTokens).toBeGreaterThanOrEqual(0);
    expect(response.usage?.completionTokens).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // generateContentDescription contract
  // -----------------------------------------------------------------------

  it('generateContentDescription accepts a prompt and returns a string', async () => {
    client = createClient();

    const result = await client.generateContentDescription('Describe a forest clearing');

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('generateContentDescription accepts optional options', async () => {
    client = createClient();

    const result = await client.generateContentDescription('Describe a cave', { temperature: 0.3 });

    expect(typeof result).toBe('string');
  });

  // -----------------------------------------------------------------------
  // synthesizeSpeech contract
  // -----------------------------------------------------------------------

  it('synthesizeSpeech accepts text and returns SpeechResult', async () => {
    client = createClient();

    const result = await client.synthesizeSpeech('Hello, traveller!');

    expect(result).toHaveProperty('audioData');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('voicesAvailable');
    expect(Array.isArray(result.voicesAvailable)).toBe(true);
  });

  it('synthesizeSpeech accepts optional TtsOptions', async () => {
    client = createClient();

    const result = await client.synthesizeSpeech('Welcome', { rate: 1.5, pitch: 1.2 });

    expect(typeof result.durationMs).toBe('number');
  });

  // -----------------------------------------------------------------------
  // generateImage contract
  // -----------------------------------------------------------------------

  it('generateImage accepts a prompt and returns ImageResult', async () => {
    client = createClient();

    const result = await client.generateImage('a fantasy landscape');

    expect(result).toHaveProperty('imageUrl');
    expect(typeof result.imageUrl).toBe('string');
    expect(result).toHaveProperty('width');
    expect(result).toHaveProperty('height');
    expect(result).toHaveProperty('mimeType');
  });

  it('generateImage accepts optional ImageOptions', async () => {
    client = createClient();

    const result = await client.generateImage('a sword', { width: 256, height: 256, steps: 30 });

    expect(result.width).toBe(256);
    expect(result.height).toBe(256);
  });

  // -----------------------------------------------------------------------
  // generateStructured contract
  // -----------------------------------------------------------------------

  it('generateStructured accepts instruction, schema, context and returns typed data', async () => {
    client = createClient();

    const { z } = await import('zod');
    const schema = z.object({ name: z.string(), level: z.number() });

    // Seed a response for deterministic test
    mock.seedStructured('quest', { name: 'Dragon Hunt', level: 5 });
    const result = (await client.generateStructured(
      'Generate a quest',
      schema,
      'fantasy world',
    )) as { name: string; level: number };

    expect(result.name).toBe('Dragon Hunt');
    expect(result.level).toBe(5);
  });

  // -----------------------------------------------------------------------
  // healthCheck contract
  // -----------------------------------------------------------------------

  it('healthCheck returns HealthCheckResult with available and latencyMs', async () => {
    client = createClient();

    const result = await client.healthCheck();

    expect(result).toHaveProperty('available');
    expect(typeof result.available).toBe('boolean');
    expect(result).toHaveProperty('latencyMs');
    expect(typeof result.latencyMs).toBe('number');
  });
});
