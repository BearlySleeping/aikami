// apps/frontend/client/src/lib/services/gm/impersonation.test.ts
//
// Unit tests for ImpersonationService — AC-1: slash command drafting,
// LLM prompt assembly with persona, result placed in input field.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json
//     src/lib/services/gm/impersonation.test.ts

import { describe, expect, mock, test } from 'bun:test';

const TEXT_GEN_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts';

mock.module(TEXT_GEN_SVC_PATH, () => ({
  textGenerationService: {
    streamChat: mock(async () => {}),
    extractStructure: mock(async () => ({})),
    cancelAll: mock(() => {}),
  },
}));

import { DEFAULT_IMPERSONATION_PROMPT_TEMPLATE, IMPERSONATION_COMMAND } from '@aikami/constants';
import { textGenerationService } from '$services';
import { impersonationService } from './impersonation_service.svelte.ts';

describe('ImpersonationService — AC-1', () => {
  const mockPersona = {
    personaName: 'Kael Thornwood',
    personaTraits: 'Sarcastic rogue with a heart of gold. Speaks in quick, clipped sentences.',
    recentMessages: [
      { sender: 'user', text: 'What do we do about the guards?' },
      { sender: 'ai', text: 'We could try the sewers. Unless you prefer a frontal assault.' },
      { sender: 'user', text: 'Sewers sound safer. Lead the way.' },
    ],
    direction: 'I examine the ancient runes carefully',
  };

  test('constructs a system prompt with persona name and traits', async () => {
    // Access internal _buildPrompt via a real invocation — we verify the
    // textGenerationService was called with the right messages
    let capturedMessages: Array<{ role: string; content: string }> = [];

    const origStream = textGenerationService.streamChat as ReturnType<typeof mock>;
    origStream.mockImplementation(
      async (options: { messages: Array<{ role: string; content: string }> }) => {
        capturedMessages = options.messages;
        options.onChunk?.('"Carefully, I trace the weathered grooves..."');
      },
    );

    const draft = await impersonationService.generateDraft(mockPersona);

    expect(draft).toContain('Carefully');
    expect(capturedMessages.length).toBeGreaterThanOrEqual(1);
    // Verify the system prompt includes persona data
    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg?.content).toContain('Kael Thornwood');
    expect(systemMsg?.content).toContain('Sarcastic rogue');
    expect(systemMsg?.content).toContain('ancient runes');
  });

  test('includes direction text in the prompt when provided', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];

    const origStream = textGenerationService.streamChat as ReturnType<typeof mock>;
    origStream.mockImplementation(
      async (options: { messages: Array<{ role: string; content: string }> }) => {
        capturedMessages = options.messages;
        options.onChunk?.('"The runes glow faintly..."');
      },
    );

    await impersonationService.generateDraft(mockPersona);

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Direction:');
    expect(systemMsg?.content).toContain('ancient runes');
  });

  test('excludes direction block when no direction given', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];

    const origStream = textGenerationService.streamChat as ReturnType<typeof mock>;
    origStream.mockImplementation(
      async (options: { messages: Array<{ role: string; content: string }> }) => {
        capturedMessages = options.messages;
        options.onChunk?.('"Without a word, I draw my blade..."');
      },
    );

    await impersonationService.generateDraft({
      ...mockPersona,
      direction: undefined,
    });

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).not.toContain('{{#direction}}');
    expect(systemMsg?.content).not.toContain('Direction:');
  });

  test('returns trimmed draft text', async () => {
    const origStream = textGenerationService.streamChat as ReturnType<typeof mock>;
    origStream.mockImplementation(async (options: { onChunk: (chunk: string) => void }) => {
      options.onChunk?.('"');
      options.onChunk?.('  Hello world  ');
      options.onChunk?.('"');
    });

    const draft = await impersonationService.generateDraft(mockPersona);
    expect(draft).toBe('"  Hello world  "');
  });

  test('throws on empty response', async () => {
    const origStream = textGenerationService.streamChat as ReturnType<typeof mock>;
    origStream.mockImplementation(async () => {
      // No chunks fired
    });

    await expect(impersonationService.generateDraft(mockPersona)).rejects.toThrow(
      'Impersonation draft returned empty',
    );
  });

  test('includes recent context in prompt', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];

    const origStream = textGenerationService.streamChat as ReturnType<typeof mock>;
    origStream.mockImplementation(
      async (options: { messages: Array<{ role: string; content: string }> }) => {
        capturedMessages = options.messages;
        options.onChunk?.('"Alright..."');
      },
    );

    await impersonationService.generateDraft({
      ...mockPersona,
      direction: undefined,
    });

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('guards');
    expect(systemMsg?.content).toContain('sewers');
  });

  test('handles empty recent messages gracefully', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];

    const origStream = textGenerationService.streamChat as ReturnType<typeof mock>;
    origStream.mockImplementation(
      async (options: { messages: Array<{ role: string; content: string }> }) => {
        capturedMessages = options.messages;
        options.onChunk?.('"I remain silent."');
      },
    );

    await impersonationService.generateDraft({
      ...mockPersona,
      recentMessages: [],
    });

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('(No recent messages)');
  });
});

describe('Impersonation constants', () => {
  test('IMPERSONATION_COMMAND is the correct slash command name', () => {
    expect(IMPERSONATION_COMMAND).toBe('impersonate');
  });

  test('DEFAULT_IMPERSONATION_PROMPT_TEMPLATE contains required placeholders', () => {
    const template = DEFAULT_IMPERSONATION_PROMPT_TEMPLATE;
    expect(template).toContain('{{personaName}}');
    expect(template).toContain('{{personaTraits}}');
    expect(template).toContain('{{direction}}');
    expect(template).toContain('{{recentContext}}');
  });
});
