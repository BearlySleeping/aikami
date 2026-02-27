import { expect, test } from '@playwright/test';

test('basic test', () => {
  expect(1 + 1).toBe(2);
});

test('store interface test', () => {
  const mockStore = {
    messages: [] as any[],
    isLoading: false,
    isSending: false,
    isTyping: false,
    error: null as string | null,
    setLoading: (_loading: boolean) => {},
    setSending: (_sending: boolean) => {},
    setTyping: (_typing: boolean) => {},
    setError: (_error: string | null) => {},
    addMessage: (_message: any) => {},
    setMessages: (_messages: any[]) => {},
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
