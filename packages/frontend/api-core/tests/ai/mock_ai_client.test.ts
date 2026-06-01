// packages/frontend/api-core/tests/ai/mock_ai_client.test.ts

import { beforeEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { MockAiClient } from '../../src/ai/mock/mock_ai_client.ts';

const ItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  value: z.number().positive(),
  requiredLevel: z.number().min(1).max(100),
});

describe('MockAiClient', () => {
  let client: MockAiClient;

  beforeEach(() => {
    client = new MockAiClient();
  });

  // -----------------------------------------------------------------------
  // AC-5: MockAiClient implements FrontendAiInterface
  // -----------------------------------------------------------------------

  it('has the correct name', () => {
    expect(client.name).toBe('mock');
  });

  it('has all capabilities enabled and isLocal=true', () => {
    expect(client.capabilities.dialogue).toBe(true);
    expect(client.capabilities.contentDescription).toBe(true);
    expect(client.capabilities.speech).toBe(true);
    expect(client.capabilities.image).toBe(true);
    expect(client.capabilities.structured).toBe(true);
    expect(client.capabilities.requiresBackend).toBe(false);
    expect(client.capabilities.isLocal).toBe(true);
  });

  // -----------------------------------------------------------------------
  // generateDialogue
  // -----------------------------------------------------------------------

  it('generateDialogue returns a default response without seeds', async () => {
    const response = await client.generateDialogue({
      npcId: 'npc-01',
      npcName: 'Elder',
      playerInput: 'Hello',
    });

    expect(response.text).toBeTruthy();
    expect(response.text).toContain('Elder');
    expect(response.usage).toBeDefined();
    expect(response.usage?.promptTokens).toBeGreaterThan(0);
  });

  it('generateDialogue returns seeded response when input matches', async () => {
    client.seedDialogue('hello', { text: 'Hi there, traveller!' });

    const response = await client.generateDialogue({
      npcId: 'npc-01',
      npcName: 'Elder',
      playerInput: 'hello there',
    });

    expect(response.text).toBe('Hi there, traveller!');
  });

  it('generateDialogue records call in history', async () => {
    await client.generateDialogue({
      npcId: 'npc-01',
      npcName: 'Elder',
      playerInput: 'Hi',
    });

    const history = client.getCallHistory();
    expect(history).toHaveLength(1);
    expect(history[0].method).toBe('generateDialogue');
  });

  // -----------------------------------------------------------------------
  // generateContentDescription
  // -----------------------------------------------------------------------

  it('generateContentDescription returns a default response', async () => {
    const result = await client.generateContentDescription('Describe a castle');

    expect(result).toBeTruthy();
    expect(result).toContain('castle');
  });

  it('generateContentDescription returns seeded response', async () => {
    client.seedDescription('castle', 'A magnificent stone castle on a hill.');

    const result = await client.generateContentDescription('castle in the sky');

    expect(result).toBe('A magnificent stone castle on a hill.');
  });

  // -----------------------------------------------------------------------
  // synthesizeSpeech
  // -----------------------------------------------------------------------

  it('synthesizeSpeech returns mock result', async () => {
    const result = await client.synthesizeSpeech('Hello world');

    expect(result.audioData).toBeNull();
    expect(result.durationMs).toBe(0);
    expect(result.voicesAvailable).toContain('mock-default');
  });

  // -----------------------------------------------------------------------
  // generateImage
  // -----------------------------------------------------------------------

  it('generateImage returns a mock placeholder', async () => {
    const result = await client.generateImage('a castle');

    expect(result.imageUrl).toBe('mock://placeholder.png');
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.mimeType).toBe('image/png');
  });

  it('generateImage respects width/height options', async () => {
    const result = await client.generateImage('a sword', { width: 256, height: 256 });

    expect(result.width).toBe(256);
    expect(result.height).toBe(256);
  });

  // -----------------------------------------------------------------------
  // generateStructured
  // -----------------------------------------------------------------------

  it('generateStructured returns seeded data', async () => {
    const holySword = {
      name: 'Holy Sword',
      description: 'A radiant blade',
      value: 500,
      requiredLevel: 20,
    };
    client.seedStructured('sword', holySword);

    const result = await client.generateStructured('Generate a sword', ItemSchema);

    expect(result).toEqual(holySword);
  });

  // -----------------------------------------------------------------------
  // healthCheck
  // -----------------------------------------------------------------------

  it('healthCheck returns available', async () => {
    const result = await client.healthCheck();

    expect(result.available).toBe(true);
    expect(result.latencyMs).toBe(0);
  });

  // -----------------------------------------------------------------------
  // getCallHistory
  // -----------------------------------------------------------------------

  it('getCallHistory records all method calls', async () => {
    await client.generateDialogue({ npcId: 'n1', npcName: 'N', playerInput: 'Hi' });
    await client.generateContentDescription('test');
    await client.synthesizeSpeech('test');
    await client.generateImage('test');
    await client.healthCheck();

    const history = client.getCallHistory();
    expect(history).toHaveLength(5);
    expect(history.map((c) => c.method)).toEqual([
      'generateDialogue',
      'generateContentDescription',
      'synthesizeSpeech',
      'generateImage',
      'healthCheck',
    ]);
  });

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------

  it('reset clears call history and seeds', async () => {
    client.seedDialogue('hello', { text: 'Hi' });
    await client.generateDialogue({ npcId: 'n1', npcName: 'N', playerInput: 'hello' });

    expect(client.getCallHistory()).toHaveLength(1);

    client.reset();

    expect(client.getCallHistory()).toHaveLength(0);

    // After reset, seed is gone — returns default response
    const response = await client.generateDialogue({
      npcId: 'n1',
      npcName: 'N',
      playerInput: 'hello',
    });
    expect(response.text).not.toBe('Hi');
  });

  // -----------------------------------------------------------------------
  // setFailMode
  // -----------------------------------------------------------------------

  it('setFailMode(network_error) causes calls to throw', async () => {
    client.setFailMode('network_error');

    expect(
      client.generateDialogue({ npcId: 'n1', npcName: 'N', playerInput: 'Hi' }),
    ).rejects.toThrow('Simulated network error');
  });

  it('healthCheck returns unavailable when failMode is network_error', async () => {
    client.setFailMode('network_error');

    const result = await client.healthCheck();
    expect(result.available).toBe(false);
  });

  // -----------------------------------------------------------------------
  // setLatency
  // -----------------------------------------------------------------------

  it('setLatency delays responses', async () => {
    client.setLatency(50);

    const start = performance.now();
    await client.generateDialogue({ npcId: 'n1', npcName: 'N', playerInput: 'Hi' });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});
