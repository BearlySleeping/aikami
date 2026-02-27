import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { MessageCreateSchema, MessageSchema, MessageUpdateSchema } from './message.ts';

describe('MessageSchema', () => {
  const validMessageData = {
    id: 'msg-123',
    text: 'Hello, world!',
    sender: 'user',
  };

  test('should parse valid message data', () => {
    const result = MessageSchema.parse(validMessageData);
    expect(result.id).toBe('msg-123');
    expect(result.text).toBe('Hello, world!');
    expect(result.sender).toBe('user');
  });

  test('should parse ai sender', () => {
    const data = { ...validMessageData, sender: 'ai' as const };
    const result = MessageSchema.parse(data);
    expect(result.sender).toBe('ai');
  });

  test('should reject invalid sender', () => {
    const invalidData = { ...validMessageData, sender: 'bot' };
    expect(() => MessageSchema.parse(invalidData)).toThrow(z.ZodError);
  });

  test('should reject missing required fields', () => {
    const invalidData = { id: 'msg-123' };
    expect(() => MessageSchema.parse(invalidData)).toThrow(z.ZodError);
  });
});

describe('MessageCreateSchema', () => {
  test('should parse valid message create data', () => {
    const validData = {
      text: 'New message',
      sender: 'user' as const,
    };
    const result = MessageCreateSchema.parse(validData);
    expect(result.text).toBe('New message');
    expect(result.sender).toBe('user');
  });

  test('should reject when text is missing', () => {
    const invalidData = {
      sender: 'user' as const,
    };
    expect(() => MessageCreateSchema.parse(invalidData)).toThrow(z.ZodError);
  });
});

describe('MessageUpdateSchema', () => {
  test('should parse valid message update data', () => {
    const validData = {
      updatedAt: { seconds: 1700000000, nanoseconds: 0 },
      text: 'Updated message text',
      sender: 'user' as const,
    };
    const result = MessageUpdateSchema.parse(validData);
    expect(result.text).toBe('Updated message text');
  });
});
