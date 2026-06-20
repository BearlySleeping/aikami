import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { MessageCreateSchema, MessageSchema, MessageUpdateSchema } from './message.ts';

describe('MessageSchema', () => {
  const validMessageData = {
    id: 'msg-123',
    text: 'Hello, world!',
    sender: 'user',
  };

  test('should parse valid message data', () => {
    const result = Value.Parse(MessageSchema, validMessageData);
    expect(result.id).toBe('msg-123');
    expect(result.text).toBe('Hello, world!');
    expect(result.sender).toBe('user');
  });

  test('should parse ai sender', () => {
    const data = { ...validMessageData, sender: 'ai' as const };
    const result = Value.Parse(MessageSchema, data);
    expect(result.sender).toBe('ai');
  });

  test('should reject invalid sender', () => {
    const invalidData = { ...validMessageData, sender: 'bot' };
    expect(() => Value.Parse(MessageSchema, invalidData)).toThrow();
  });

  test('should reject missing required fields', () => {
    const invalidData = { id: 'msg-123' };
    expect(() => Value.Parse(MessageSchema, invalidData)).toThrow();
  });
});

describe('MessageCreateSchema', () => {
  test('should parse valid message create data', () => {
    const validData = {
      text: 'New message',
      sender: 'user' as const,
    };
    const result = Value.Parse(MessageCreateSchema, validData);
    expect(result.text).toBe('New message');
    expect(result.sender).toBe('user');
  });

  test('should reject when text is missing', () => {
    const invalidData = {
      sender: 'user' as const,
    };
    expect(() => Value.Parse(MessageCreateSchema, invalidData)).toThrow();
  });
});

describe('MessageUpdateSchema', () => {
  test('should parse valid message update data', () => {
    const validData = {
      updatedAt: { seconds: 1700000000, nanoseconds: 0 },
      text: 'Updated message text',
      sender: 'user' as const,
    };
    const result = Value.Parse(MessageUpdateSchema, validData);
    expect(result.text).toBe('Updated message text');
  });
});
