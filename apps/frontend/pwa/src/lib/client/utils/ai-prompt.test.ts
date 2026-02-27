import { describe, expect, test } from 'bun:test';
import { createAIContext, formatCharacterPrompt, formatChatHistory } from './ai-prompt.ts';

describe('formatCharacterPrompt', () => {
  test('should format basic character', () => {
    const prompt = formatCharacterPrompt({
      name: 'Test Character',
      description: 'A test character',
    });

    expect(prompt).toContain('You are Test Character.');
    expect(prompt).toContain('Description: A test character');
  });

  test('should include personality', () => {
    const prompt = formatCharacterPrompt({
      name: 'Warrior',
      personality: 'Brave and loyal',
    });

    expect(prompt).toContain('Personality: Brave and loyal');
  });

  test('should include scenario', () => {
    const prompt = formatCharacterPrompt({
      name: 'NPC',
      scenario: 'In a medieval tavern',
    });

    expect(prompt).toContain('Scenario: In a medieval tavern');
  });

  test('should include all fields', () => {
    const prompt = formatCharacterPrompt({
      name: 'Full Character',
      description: 'A detailed description',
      personality: 'Friendly but mysterious',
      scenario: 'In a fantasy world',
      first_mes: 'Hello traveler!',
      mes_example: 'Greetings! How can I help you?',
      creator_notes: 'Created for testing',
      system_prompt: 'Always be helpful',
      post_history_instructions: 'Remember previous conversations',
    });

    expect(prompt).toContain('You are Full Character.');
    expect(prompt).toContain('Description: A detailed description');
    expect(prompt).toContain('Personality: Friendly but mysterious');
    expect(prompt).toContain('Scenario: In a fantasy world');
    expect(prompt).toContain('Example of how you speak: Greetings! How can I help you?');
    expect(prompt).toContain('Note from creator: Created for testing');
    expect(prompt).toContain('System Instructions: Always be helpful');
    expect(prompt).toContain('Remember: Remember previous conversations');
  });

  test('should handle missing optional fields', () => {
    const prompt = formatCharacterPrompt({
      name: 'Minimal Character',
    });

    expect(prompt).toBe('You are Minimal Character.');
  });
});

describe('formatChatHistory', () => {
  test('should convert user message', () => {
    const messages = [{ text: 'Hello', sender: 'user' as const, timestamp: new Date() }];

    const formatted = formatChatHistory(messages);

    expect(formatted).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  test('should convert AI message', () => {
    const messages = [{ text: 'Hello to you!', sender: 'ai' as const, timestamp: new Date() }];

    const formatted = formatChatHistory(messages);

    expect(formatted).toEqual([{ role: 'assistant', content: 'Hello to you!' }]);
  });

  test('should convert multiple messages', () => {
    const messages = [
      { text: 'Hi there!', sender: 'user' as const, timestamp: new Date() },
      { text: 'Hello! How can I help?', sender: 'ai' as const, timestamp: new Date() },
      { text: 'Tell me a story.', sender: 'user' as const, timestamp: new Date() },
    ];

    const formatted = formatChatHistory(messages);

    expect(formatted).toEqual([
      { role: 'user', content: 'Hi there!' },
      { role: 'assistant', content: 'Hello! How can I help?' },
      { role: 'user', content: 'Tell me a story.' },
    ]);
  });
});

describe('createAIContext', () => {
  test('should create context with system prompt and messages', () => {
    const character = {
      name: 'Test NPC',
      description: 'A helpful NPC',
      personality: 'Friendly',
    };

    const messages = [
      { text: 'Hello', sender: 'user' as const },
      { text: 'Hi there!', sender: 'ai' as const },
    ];

    const context = createAIContext(character, messages);

    expect(context.systemPrompt).toContain('You are Test NPC.');
    expect(context.systemPrompt).toContain('Description: A helpful NPC');
    expect(context.systemPrompt).toContain('Personality: Friendly');
    expect(context.messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });
});
