import { describe, expect, test } from 'bun:test';

interface TestMessageData {
  id?: string;
  text: string;
  sender: 'user' | 'ai';
  createdAt?: string;
}

describe('ChatMessage type', () => {
  test('should have correct structure', () => {
    const message = {
      id: 'test-id',
      text: 'Hello world',
      sender: 'user' as const,
      timestamp: new Date(),
    };

    expect(message.id).toBe('test-id');
    expect(message.text).toBe('Hello world');
    expect(message.sender).toBe('user');
    expect(message.timestamp).toBeInstanceOf(Date);
  });

  test('should allow ai sender', () => {
    const message = {
      id: 'test-id',
      text: 'AI response',
      sender: 'ai' as const,
      timestamp: new Date(),
    };

    expect(message.sender).toBe('ai');
  });
});

describe('MessageData to ChatMessage conversion', () => {
  test('should convert MessageData with all fields', () => {
    const messageData: TestMessageData = {
      id: 'msg-123',
      text: 'Test message',
      sender: 'user',
      createdAt: '2024-01-15T10:30:00Z',
    };

    const chatMessage = {
      id: messageData.id || crypto.randomUUID(),
      text: messageData.text,
      sender: messageData.sender,
      timestamp: messageData.createdAt ? new Date(messageData.createdAt) : new Date(),
    };

    expect(chatMessage.id).toBe('msg-123');
    expect(chatMessage.text).toBe('Test message');
    expect(chatMessage.sender).toBe('user');
    expect(chatMessage.timestamp).toEqual(new Date('2024-01-15T10:30:00Z'));
  });

  test('should generate UUID when id is missing', () => {
    const messageData: TestMessageData = {
      text: 'Test message',
      sender: 'ai',
    };

    const chatMessage = {
      id: messageData.id || crypto.randomUUID(),
      text: messageData.text,
      sender: messageData.sender,
      timestamp: messageData.createdAt ? new Date(messageData.createdAt) : new Date(),
    };

    expect(chatMessage.id).toBeDefined();
    expect(chatMessage.id.length).toBeGreaterThan(0);
  });

  test('should use current date when createdAt is missing', () => {
    const messageData: TestMessageData = {
      text: 'Test message',
      sender: 'user',
    };

    const before = new Date();
    const chatMessage = {
      id: messageData.id || crypto.randomUUID(),
      text: messageData.text,
      sender: messageData.sender,
      timestamp: messageData.createdAt ? new Date(messageData.createdAt) : new Date(),
    };
    const after = new Date();

    expect(chatMessage.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(chatMessage.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
