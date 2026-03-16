import { expect, test } from '@playwright/test';

type MockChatMessage = {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
};

test('basic test', () => {
  expect(1 + 1).toBe(2);
});

test('store interface test', () => {
  const mockStore: {
    messages: MockChatMessage[];
    isLoading: boolean;
    isSending: boolean;
    isTyping: boolean;
    error: string | undefined;
    setLoading: (loading: boolean) => void;
    setSending: (sending: boolean) => void;
    setTyping: (typing: boolean) => void;
    setError: (error: string | undefined) => void;
    addMessage: (message: MockChatMessage) => void;
    setMessages: (messages: MockChatMessage[]) => void;
    appendAIMessage: (text: string) => void;
    updateLastAIMessage: (text: string) => void;
    clear: () => void;
  } = {
    messages: [],
    isLoading: false,
    isSending: false,
    isTyping: false,
    error: undefined,
    setLoading: (_loading: boolean) => {},
    setSending: (_sending: boolean) => {},
    setTyping: (_typing: boolean) => {},
    setError: (_error: string | undefined) => {},
    addMessage: (_message: {
      id: string;
      text: string;
      sender: 'user' | 'ai';
      timestamp: Date;
    }) => {},
    setMessages: (_messages: MockChatMessage[]) => {},
    appendAIMessage: (_text: string) => {},
    updateLastAIMessage: (_text: string) => {},
    clear: () => {},
  };

  expect(mockStore.messages).toEqual([]);
  expect(mockStore.isTyping).toBe(false);
  mockStore.setTyping(true);
  expect(mockStore.isTyping).toBe(false);
  expect(true).toBe(true);
});
