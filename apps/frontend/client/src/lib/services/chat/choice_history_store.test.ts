// apps/frontend/client/src/lib/services/chat/choice_history_store.test.ts
//
// Unit tests for the CYOA choice history store — per-chat tracking,
// history cap, GM prompt section formatting.
//
// Contract: C-245 CYOA Choices Branching Narrative

import { describe, expect, it } from 'bun:test';
import { CYOA_HISTORY_CAP, CYOA_HISTORY_HEADING } from '@aikami/constants';
import { ChoiceHistoryStore } from './choice_history_store.svelte.ts';

const createStore = () =>
  ChoiceHistoryStore.create({ className: 'ChoiceHistoryStore' }) as ChoiceHistoryStore;

describe('ChoiceHistoryStore', () => {
  it('should record and retrieve choices per chat', () => {
    const store = createStore();

    store.recordChoice({
      chatId: 'chat-1',
      entry: { choiceId: 'c1', label: 'Investigate the ruins', selectedAt: 1000 },
    });
    store.recordChoice({
      chatId: 'chat-1',
      entry: { choiceId: 'c2', label: 'Open the sarcophagus', selectedAt: 2000 },
    });

    const history = store.getHistory('chat-1');
    expect(history.length).toBe(2);
    expect(history[0].label).toBe('Investigate the ruins');
    expect(history[1].label).toBe('Open the sarcophagus');
  });

  it('should keep history per-chat, not global', () => {
    const store = createStore();

    store.recordChoice({
      chatId: 'chat-a',
      entry: { choiceId: 'c1', label: 'Choice A', selectedAt: 1 },
    });
    store.recordChoice({
      chatId: 'chat-b',
      entry: { choiceId: 'c2', label: 'Choice B', selectedAt: 2 },
    });

    expect(store.getHistory('chat-a').length).toBe(1);
    expect(store.getHistory('chat-b').length).toBe(1);
    expect(store.getHistory('chat-a')[0].label).toBe('Choice A');
  });

  it('should cap history at the configured limit', () => {
    const store = createStore();

    for (let i = 0; i < CYOA_HISTORY_CAP + 5; i++) {
      store.recordChoice({
        chatId: 'chat-1',
        entry: { choiceId: `c${i}`, label: `Choice ${i}`, selectedAt: i },
      });
    }

    const history = store.getHistory('chat-1');
    expect(history.length).toBe(CYOA_HISTORY_CAP);
    // Oldest entries evicted — first remaining should be Choice 5
    expect(history[0].label).toBe('Choice 5');
  });

  it('should format the GM prompt section with heading and entries', () => {
    const store = createStore();

    store.recordChoice({
      chatId: 'chat-1',
      entry: { choiceId: 'c1', label: 'Investigate the ruins', selectedAt: 1000 },
    });
    store.recordChoice({
      chatId: 'chat-1',
      entry: {
        choiceId: 'c2',
        label: 'Open the sarcophagus',
        selectedAt: 2000,
        context: 'impersonation',
      },
    });

    const section = store.formatHistorySection('chat-1');
    expect(section).toContain(CYOA_HISTORY_HEADING);
    expect(section).toContain('- Investigate the ruins');
    expect(section).toContain('- Open the sarcophagus (impersonation)');
  });

  it('should return empty string for chats with no history', () => {
    const store = createStore();
    expect(store.formatHistorySection('unknown-chat')).toBe('');
  });

  it('should clear history for a single chat only', () => {
    const store = createStore();

    store.recordChoice({
      chatId: 'chat-a',
      entry: { choiceId: 'c1', label: 'Choice A', selectedAt: 1 },
    });
    store.recordChoice({
      chatId: 'chat-b',
      entry: { choiceId: 'c2', label: 'Choice B', selectedAt: 2 },
    });

    store.clearHistory('chat-a');

    expect(store.getHistory('chat-a').length).toBe(0);
    expect(store.getHistory('chat-b').length).toBe(1);
  });
});
