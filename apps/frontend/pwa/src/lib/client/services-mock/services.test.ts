import { beforeEach, describe, expect, test } from 'bun:test';

describe('ChatService Mock', () => {
  // biome-ignore lint/suspicious/noExplicitAny: Test mock service
  let mockChatService: any;

  beforeEach(() => {
    // Import fresh for each test
    mockChatService = {
      messages: [],
      isLoading: false,
      isSending: false,
      isTyping: false,
      error: null,

      setLoading(v: boolean) {
        this.isLoading = v;
      },
      setSending(v: boolean) {
        this.isSending = v;
      },
      setTyping(v: boolean) {
        this.isTyping = v;
      },
      setError(v: string | null) {
        this.error = v;
      },

      // biome-ignore lint/suspicious/noExplicitAny: Test mock service
      addMessage(m: any) {
        this.messages.push(m);
      },

      // biome-ignore lint/suspicious/noExplicitAny: Test mock service
      setMessages(msgs: any[]) {
        // biome-ignore lint/suspicious/noExplicitAny: Test mock service
        this.messages = msgs.map((msg: any) => ({
          id: msg.id || crypto.randomUUID(),
          text: msg.text,
          sender: msg.sender,
          timestamp: msg.createdAt ? new Date(msg.createdAt) : new Date(),
        }));
      },

      appendAIMessage(text: string) {
        this.messages.push({
          id: crypto.randomUUID(),
          text,
          sender: 'ai' as const,
          timestamp: new Date(),
        });
      },

      updateLastAIMessage(text: string) {
        if (this.messages.length > 0) {
          const lastIndex = this.messages.length - 1;
          if (this.messages[lastIndex].sender === 'ai') {
            this.messages[lastIndex].text = text;
          }
        }
      },

      clear() {
        this.messages = [];
        this.isLoading = false;
        this.isSending = false;
        this.isTyping = false;
        this.error = null;
      },
    };
  });

  test('should start with empty messages', () => {
    expect(mockChatService.messages).toEqual([]);
  });

  test('should add user message', () => {
    mockChatService.addMessage({
      id: '1',
      text: 'Hello AI',
      sender: 'user' as const,
      timestamp: new Date(),
    });
    expect(mockChatService.messages.length).toBe(1);
    expect(mockChatService.messages[0].text).toBe('Hello AI');
    expect(mockChatService.messages[0].sender).toBe('user');
  });

  test('should append AI message', () => {
    mockChatService.appendAIMessage('Hello human');
    expect(mockChatService.messages.length).toBe(1);
    expect(mockChatService.messages[0].sender).toBe('ai');
    expect(mockChatService.messages[0].text).toBe('Hello human');
  });

  test('should update last AI message', () => {
    mockChatService.appendAIMessage('Hello');
    mockChatService.updateLastAIMessage('Hello world');
    expect(mockChatService.messages[0].text).toBe('Hello world');
  });

  test('should not update if last message is not AI', () => {
    mockChatService.addMessage({
      id: '1',
      text: 'User message',
      sender: 'user' as const,
      timestamp: new Date(),
    });
    mockChatService.updateLastAIMessage('Should not update');
    expect(mockChatService.messages[0].text).toBe('User message');
  });

  test('should set loading state', () => {
    mockChatService.setLoading(true);
    expect(mockChatService.isLoading).toBe(true);
    mockChatService.setLoading(false);
    expect(mockChatService.isLoading).toBe(false);
  });

  test('should set sending state', () => {
    mockChatService.setSending(true);
    expect(mockChatService.isSending).toBe(true);
  });

  test('should set typing state', () => {
    mockChatService.setTyping(true);
    expect(mockChatService.isTyping).toBe(true);
  });

  test('should set error', () => {
    mockChatService.setError('Something went wrong');
    expect(mockChatService.error).toBe('Something went wrong');
    mockChatService.setError(null);
    expect(mockChatService.error).toBeNull();
  });

  test('should convert and set messages from data', () => {
    const messageData = [
      { id: 'msg-1', text: 'First', sender: 'user' as const, createdAt: '2024-01-01T00:00:00Z' },
      { id: 'msg-2', text: 'Second', sender: 'ai' as const, createdAt: '2024-01-01T01:00:00Z' },
    ];

    mockChatService.setMessages(messageData);

    expect(mockChatService.messages.length).toBe(2);
    expect(mockChatService.messages[0].id).toBe('msg-1');
    expect(mockChatService.messages[0].timestamp).toEqual(new Date('2024-01-01T00:00:00Z'));
  });

  test('should clear all state', () => {
    mockChatService.addMessage({
      id: '1',
      text: 'test',
      sender: 'user' as const,
      timestamp: new Date(),
    });
    mockChatService.setLoading(true);
    mockChatService.setSending(true);
    mockChatService.setTyping(true);
    mockChatService.setError('Error');

    mockChatService.clear();

    expect(mockChatService.messages.length).toBe(0);
    expect(mockChatService.isLoading).toBe(false);
    expect(mockChatService.isSending).toBe(false);
    expect(mockChatService.isTyping).toBe(false);
    expect(mockChatService.error).toBeNull();
  });
});

describe('AIService Mock', () => {
  test('should return mock AI response', async () => {
    const mockAIService = {
      // biome-ignore lint/suspicious/noExplicitAny: Test mock service
      async sendMessageToAI(text: string, _character?: any): Promise<string> {
        return `Mock response to: ${text}`;
      },
      // biome-ignore lint/suspicious/noExplicitAny: Test mock service
      async createPersona(prompt: string): Promise<any> {
        return {
          id: 'mock-persona-id',
          name: 'Mock Persona',
          description: prompt.slice(0, 100),
        };
      },
    };

    const response = await mockAIService.sendMessageToAI('Hello');
    expect(response).toBe('Mock response to: Hello');
  });

  test('should create persona from prompt', async () => {
    const mockAIService = {
      async sendMessageToAI(text: string): Promise<string> {
        return `Mock: ${text}`;
      },
      // biome-ignore lint/suspicious/noExplicitAny: Test mock service
      async createPersona(prompt: string): Promise<any> {
        return {
          id: 'mock-persona-id',
          name: 'Mock Persona',
          description: prompt.slice(0, 100),
        };
      },
    };

    const persona = await mockAIService.createPersona('Create a brave warrior');
    expect(persona.name).toBe('Mock Persona');
    expect(persona.description).toBe('Create a brave warrior'.slice(0, 100));
  });
});

describe('NPC Service Mock', () => {
  test('should return mock NPC', async () => {
    const mockNpcService = {
      // biome-ignore lint/suspicious/noExplicitAny: Test mock service
      async get(id: string): Promise<any> {
        return {
          id,
          name: 'Test NPC',
          description: 'Mock NPC description',
          avatarUrl: undefined,
          race: 'Human',
          class: 'Warrior',
          level: 5,
          personalityTraits: 'Brave and noble',
          background: 'Test background',
          notes: 'Test notes',
        };
      },
      // biome-ignore lint/suspicious/noExplicitAny: Test mock service
      async getAll(): Promise<any[]> {
        return [];
      },
    };

    const npc = await mockNpcService.get('test-npc-id');
    expect(npc.name).toBe('Test NPC');
    expect(npc.race).toBe('Human');
    expect(npc.class).toBe('Warrior');
    expect(npc.level).toBe(5);
  });

  test('should return empty array for getAll', async () => {
    const mockNpcService = {
      // biome-ignore lint/suspicious/noExplicitAny: Test mock service
      async get(id: string): Promise<any> {
        return { id, name: 'Test' };
      },
      // biome-ignore lint/suspicious/noExplicitAny: Test mock service
      async getAll(): Promise<any[]> {
        return [];
      },
    };

    const npcs = await mockNpcService.getAll();
    expect(npcs).toEqual([]);
  });
});
