// apps/frontend/pwa/src/lib/client/services/media/context_builder.test.ts
import { describe, expect, test } from 'bun:test';
import { buildSlidingWindowContext, type ConversationMessage } from './context_builder.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateMessages = (count: number): ConversationMessage[] => {
  const messages: ConversationMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1}: ${'x'.repeat(50)}`,
    });
  }
  return messages;
};

const heavyMessage = (label: string, charCount: number): ConversationMessage => ({
  role: 'assistant',
  content: `${label}: ${'A'.repeat(charCount - label.length - 2)}`,
});

// ---------------------------------------------------------------------------
// AC1: Sliding Window Context Builder
// ---------------------------------------------------------------------------

describe('ContextBuilder — AC1: Sliding Window', () => {
  test('returns only the most recent N messages when history exceeds maxMessages', () => {
    const messages = generateMessages(50);

    const result = buildSlidingWindowContext({
      messages,
      maxMessages: 10,
    });

    expect(result.length).toBeLessThanOrEqual(10);
    // Should contain the last messages, not the first
    expect(result[0].content).toContain('Message 41');
    expect(result[result.length - 1].content).toContain('Message 50');
  });

  test('returns an empty array when given no messages', () => {
    const result = buildSlidingWindowContext({
      messages: [],
    });

    expect(result).toEqual([]);
  });

  test('returns all messages when count is below maxMessages', () => {
    const messages = generateMessages(3);

    const result = buildSlidingWindowContext({
      messages,
      maxMessages: 10,
    });

    expect(result.length).toBe(3);
  });

  test('enforces character budget — truncates older messages when limit exceeded', () => {
    const messages = [
      heavyMessage('m1', 300),
      heavyMessage('m2', 300),
      heavyMessage('m3', 300),
      heavyMessage('m4', 300),
      heavyMessage('m5', 300),
    ];

    const result = buildSlidingWindowContext({
      messages,
      maxMessages: 10,
      maxCharacters: 800,
      systemPromptReservation: 100,
    });

    // Budget = 800 - 100 = 700. Each message = ~300 chars.
    // Only 2 fit (600 < 700, but 3 would be 900 > 700)
    expect(result.length).toBe(2);
    expect(result[0].content).toContain('m4');
    expect(result[1].content).toContain('m5');
  });

  test('respects system prompt reservation — leaves headroom', () => {
    const messages = generateMessages(5);

    const result = buildSlidingWindowContext({
      messages,
      maxMessages: 10,
      maxCharacters: 1_000,
      systemPromptReservation: 700,
    });

    // Budget = 1000 - 700 = 300. Each message ~60 chars.
    // Should get at most floor(300 / ~60) = 5 messages (all fit)
    expect(result.length).toBeGreaterThanOrEqual(3);
    // Ensure total chars <= 300
    const totalChars = result.reduce((sum, m) => sum + m.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(300);
  });

  test('message count cap takes priority over character budget cap', () => {
    const messages = generateMessages(20);

    const result = buildSlidingWindowContext({
      messages,
      maxMessages: 3,
      maxCharacters: 10_000, // huge budget, should not limit
      systemPromptReservation: 0,
    });

    expect(result.length).toBe(3);
    expect(result[0].content).toContain('Message 18');
    expect(result[2].content).toContain('Message 20');
  });

  test('character budget cap takes priority over message count cap', () => {
    const messages = generateMessages(50);

    const result = buildSlidingWindowContext({
      messages,
      maxMessages: 20,
      maxCharacters: 200, // tiny budget
      systemPromptReservation: 0,
    });

    // Each message ~60 chars. 200 / 60 ≈ 3 messages max
    expect(result.length).toBeLessThanOrEqual(4);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('preserves message order — oldest to newest', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
      { role: 'user', content: 'C' },
      { role: 'assistant', content: 'D' },
    ];

    const result = buildSlidingWindowContext({
      messages,
      maxMessages: 10,
    });

    expect(result[0].content).toBe('A');
    expect(result[1].content).toBe('B');
    expect(result[2].content).toBe('C');
    expect(result[3].content).toBe('D');
  });

  test('defaults: maxMessages=10, maxCharacters=4000, systemPromptReservation=1500', () => {
    const messages = generateMessages(50);

    const result = buildSlidingWindowContext({
      messages,
    });

    // With defaults: budget = 4000 - 1500 = 2500
    // Each message ~60 chars → fits ~41, but capped at 10 by maxMessages
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result[0].content).toContain('Message 41');
  });
});
