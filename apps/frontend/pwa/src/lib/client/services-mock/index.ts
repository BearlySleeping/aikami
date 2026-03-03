import type { Character } from '../../types/character.ts';

type Message = {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  createdAt?: Date;
};

const chatState = {
  messages: [] as Message[],
  isLoading: false,
  isSending: false,
  isTyping: false,
  error: null as string | null,
};

class MockChatService {
  get messages() {
    return chatState.messages;
  }
  get isLoading() {
    return chatState.isLoading;
  }
  get isSending() {
    return chatState.isSending;
  }
  get isTyping() {
    return chatState.isTyping;
  }
  get error() {
    return chatState.error;
  }

  setLoading(v: boolean) {
    chatState.isLoading = v;
  }
  setSending(v: boolean) {
    chatState.isSending = v;
  }
  setTyping(v: boolean) {
    chatState.isTyping = v;
  }
  setError(v: string | null) {
    chatState.error = v;
  }

  addMessage(m: Message) {
    chatState.messages.push(m);
  }

  setMessages(msgs: Message[]) {
    chatState.messages = msgs.map((msg) => ({
      ...msg,
      id: msg.id || crypto.randomUUID(),
      timestamp: msg.createdAt ? new Date(msg.createdAt) : new Date(),
    }));
  }

  appendAIMessage(text: string) {
    chatState.messages.push({
      id: crypto.randomUUID(),
      text,
      sender: 'ai' as const,
      timestamp: new Date(),
    });
  }

  updateLastAIMessage(text: string) {
    if (chatState.messages.length > 0) {
      const lastIndex = chatState.messages.length - 1;
      if (chatState.messages[lastIndex].sender === 'ai') {
        chatState.messages[lastIndex].text = text;
      }
    }
  }

  clear() {
    chatState.messages = [];
    chatState.isLoading = false;
    chatState.isSending = false;
    chatState.isTyping = false;
    chatState.error = null;
  }
}

class MockAIMessageService {
  // biome-ignore lint/suspicious/noExplicitAny: Mock service returns simplified persona
  async createPersona(prompt: string): Promise<any> {
    return {
      id: 'mock-persona-id',
      name: 'Mock Persona',
      description: prompt.slice(0, 100),
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '',
      extensions: {},
    };
  }

  // biome-ignore lint/suspicious/noExplicitAny: Mock service
  async sendMessageToAI(text: string, _character?: any): Promise<string> {
    return `Mock response to: ${text}`;
  }
}

class MockNpcService {
  // biome-ignore lint/suspicious/noExplicitAny: Mock service returns simplified NPC
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
  }

  // biome-ignore lint/suspicious/noExplicitAny: Mock service returns empty array
  async getAll(): Promise<any[]> {
    return [];
  }
}

class MockMessageService {
  // biome-ignore lint/suspicious/noExplicitAny: Mock service returns empty array
  async getMessages(_uid: string, _npcId: string): Promise<any[]> {
    return [];
  }

  // biome-ignore lint/suspicious/noExplicitAny: Mock service returns empty object
  async createMessage(_uid: string, _npcId: string, _data: any): Promise<any> {
    return {};
  }

  async deleteMessage(_uid: string, _messageId: string): Promise<void> {}
  // biome-ignore lint/suspicious/noExplicitAny: Mock service
  async updateMessage(_uid: string, _messageId: string, _data: any): Promise<any> {}
}

class MockAuthService {
  get uid() {
    return 'mock-uid';
  }
  get currentUser() {
    return null;
  }
  get isAuthenticated() {
    return true;
  }
  async signInWithEmailAndPassword(_email: string, _password: string) {
    return { user: null };
  }
  async createUserWithEmailAndPassword(_email: string, _password: string) {
    return { user: null };
  }
  async signOut() {}
  // biome-ignore lint/suspicious/noExplicitAny: Mock service callback type not relevant
  onAuthStateChanged(_callback: any) {}
  async getIdToken() {
    return 'mock-token';
  }
  async getIdTokenResult() {
    return { token: 'mock-token', expirationTime: '' };
  }
  async sendPasswordResetEmail(_email: string) {}
  // biome-ignore lint/suspicious/noExplicitAny: Mock service profile type not relevant
  async updateProfile(_profile: any) {}
  async deleteAccount() {}
  async verifyBeforeUpdateEmail(_email: string) {}
  async sendEmailVerification() {}
  // biome-ignore lint/suspicious/noExplicitAny: Mock service provider type not relevant
  async signInWithPopup(_provider: any) {
    return { user: null };
  }
  // biome-ignore lint/suspicious/noExplicitAny: Mock service provider type not relevant
  async linkWithPopup(_provider: any) {
    return { user: null };
  }
  // biome-ignore lint/suspicious/noExplicitAny: Mock service provider type not relevant
  async reauthenticateWithPopup(_provider: any) {
    return { user: null };
  }
  // biome-ignore lint/suspicious/noExplicitAny: Mock service provider type not relevant
  async unlinkWithPopup(_provider: any) {
    return { user: null };
  }
  async signInWithPhoneNumber(_phone: string) {
    return { confirmationResult: null };
  }
  async linkWithPhoneNumber(_phone: string) {
    return { confirmationResult: null };
  }
  async reauthenticateWithPhoneNumber(_phone: string) {
    return { confirmationResult: null };
  }
  async setSession(_idToken: string) {}
  async getSession() {
    return null;
  }
  async refreshToken() {}
}

// Export singleton instances
export const chatService = new MockChatService();
export const aiService = new MockAIMessageService();
export const npcService = new MockNpcService();
export const messageService = new MockMessageService();
export const authService = new MockAuthService();

// Export empty objects for other services
export const analyticService = {};
export const storageService = {};
export const internalAPIService = {};
export const appService = {};
export const preferenceService = {};
export const characterService = {};
export const notificationService = {};
export const personaService = {};
export const userService = {};
export const dialogService = {};
export const routerService = {};
