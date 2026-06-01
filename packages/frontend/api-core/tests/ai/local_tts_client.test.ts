// packages/frontend/api-core/tests/ai/local_tts_client.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { LocalTtsClient } from '../../src/ai/clients/local_tts_client.ts';

/**
 * Sets up a mock window.speechSynthesis for testing.
 */
function mockSpeechSynthesis(voices: string[] = ['Google US English']): void {
  // @ts-expect-error - spying on global
  globalThis.window = {
    speechSynthesis: {
      speak: () => {},
      getVoices: () =>
        voices.map((name) => ({
          name,
          lang: 'en-US',
          default: name.includes('default'),
          localService: false,
          voiceURI: name,
        })),
    },
  };

  // @ts-expect-error - mock SpeechSynthesisUtterance constructor
  globalThis.SpeechSynthesisUtterance = class MockUtterance {
    text: string;
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: unknown = null;
    constructor(text: string) {
      this.text = text;
    }
  };
}

/**
 * Removes mock speech synthesis (simulating SSR/headless).
 */
function _removeSpeechSynthesis(): void {
  // @ts-expect-error - cleanup
  delete globalThis.window;
  // @ts-expect-error - cleanup
  delete globalThis.SpeechSynthesisUtterance;
}

/**
 * Removes mock speech synthesis (simulating SSR/headless).
 */
function removeSpeechSynthesis(): void {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
}

describe('LocalTtsClient', () => {
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  // -----------------------------------------------------------------------
  // Construction and Capabilities
  // -----------------------------------------------------------------------

  it('has correct name and capabilities when TTS is available', () => {
    mockSpeechSynthesis();

    const client = new LocalTtsClient();

    expect(client.name).toBe('local-tts');
    expect(client.capabilities.speech).toBe(true);
    expect(client.capabilities.dialogue).toBe(false);
    expect(client.capabilities.contentDescription).toBe(false);
    expect(client.capabilities.image).toBe(false);
    expect(client.capabilities.structured).toBe(false);
    expect(client.capabilities.requiresBackend).toBe(false);
    expect(client.capabilities.isLocal).toBe(true);
  });

  it('sets capabilities.speech to false when TTS is unavailable', () => {
    removeSpeechSynthesis();

    const client = new LocalTtsClient();

    expect(client.capabilities.speech).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Unsupported methods throw
  // -----------------------------------------------------------------------

  it('generateDialogue throws', async () => {
    mockSpeechSynthesis();

    const client = new LocalTtsClient();

    expect(
      client.generateDialogue({ npcId: 'n1', npcName: 'N', playerInput: 'Hi' }),
    ).rejects.toThrow('does not support dialogue');
  });

  it('generateContentDescription throws', async () => {
    mockSpeechSynthesis();

    const client = new LocalTtsClient();

    expect(client.generateContentDescription('test')).rejects.toThrow(
      'does not support content description',
    );
  });

  it('generateImage throws', async () => {
    mockSpeechSynthesis();

    const client = new LocalTtsClient();

    expect(client.generateImage('test')).rejects.toThrow('does not support image generation');
  });

  it('generateStructured throws', async () => {
    mockSpeechSynthesis();

    const client = new LocalTtsClient();

    const { z } = await import('zod');

    expect(client.generateStructured('test', z.object({}))).rejects.toThrow(
      'does not support structured data',
    );
  });

  // -----------------------------------------------------------------------
  // synthesizeSpeech
  // -----------------------------------------------------------------------

  it('synthesizeSpeech returns result with live playback when TTS is available', async () => {
    mockSpeechSynthesis();

    const client = new LocalTtsClient();
    const result = await client.synthesizeSpeech('Hello, traveller!');

    expect(result.audioData).toBeNull();
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.voicesAvailable).toContain('Google US English');
  });

  it('synthesizeSpeech returns empty result when TTS is unavailable', async () => {
    removeSpeechSynthesis();

    const client = new LocalTtsClient();
    const result = await client.synthesizeSpeech('Hello');

    expect(result.audioData).toBeNull();
    expect(result.durationMs).toBe(0);
    expect(result.voicesAvailable).toHaveLength(0);
  });

  it('synthesizeSpeech accepts options', async () => {
    mockSpeechSynthesis();

    const client = new LocalTtsClient();
    const result = await client.synthesizeSpeech('Test', {
      rate: 1.5,
      pitch: 1.2,
      volume: 0.8,
    });

    expect(result.voicesAvailable).toContain('Google US English');
  });

  // -----------------------------------------------------------------------
  // healthCheck
  // -----------------------------------------------------------------------

  it('healthCheck returns available when TTS is available', async () => {
    mockSpeechSynthesis();

    const client = new LocalTtsClient();
    const result = await client.healthCheck();

    expect(result.available).toBe(true);
    expect(result.message).toContain('Web Speech API');
  });

  it('healthCheck returns unavailable when TTS is unavailable', async () => {
    removeSpeechSynthesis();

    const client = new LocalTtsClient();
    const result = await client.healthCheck();

    expect(result.available).toBe(false);
    expect(result.message).toContain('Web Speech API not available');
  });

  // -----------------------------------------------------------------------
  // Constructor options
  // -----------------------------------------------------------------------

  it('constructs with default options when none provided', () => {
    mockSpeechSynthesis();

    const client = new LocalTtsClient();
    expect(client.name).toBe('local-tts');
  });

  it('constructs with custom options', () => {
    mockSpeechSynthesis(['Microsoft Zira']);

    const client = new LocalTtsClient({
      preferredVoice: 'Zira',
      rate: 0.8,
      pitch: 1.5,
    });

    expect(client.name).toBe('local-tts');
  });
});
