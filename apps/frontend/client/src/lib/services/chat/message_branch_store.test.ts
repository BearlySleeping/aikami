// apps/frontend/client/src/lib/services/chat/message_branch_store.test.ts
//
// Unit tests for MessageBranchStore — alternative tracking for message
// branching and swiping.
//
// Contract: C-231 AC-1 Message Branching & Swiping

import { beforeEach, describe, expect, test } from 'bun:test';
import { messageBranchStore } from './message_branch_store.svelte.ts';

// ── Helpers ──────────────────────────────────────────────────────────────

const MESSAGE_ID = 'msg-001';
const MESSAGE_ID_2 = 'msg-002';

/** Clears all alternatives between tests. */
const cleanupBranches = () => {
  messageBranchStore.clearAlternatives(MESSAGE_ID);
  messageBranchStore.clearAlternatives(MESSAGE_ID_2);
};

// ── AC-1: Message Branching & Swiping ─────────────────────────────────────

describe('MessageBranchStore — AC-1: Message Branching & Swiping', () => {
  beforeEach(() => {
    cleanupBranches();
  });

  test('addAlternative stores current text as alternative[0] and new text as [1]', () => {
    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Original response',
      newText: 'Regenerated response',
    });

    const alternatives = messageBranchStore.getAlternatives(MESSAGE_ID);
    expect(alternatives).toEqual(['Original response', 'Regenerated response']);
    expect(messageBranchStore.getActiveAlternative(MESSAGE_ID)).toBe('Regenerated response');
  });

  test('addAlternative appends to existing alternatives', () => {
    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Response 1',
      newText: 'Response 2',
    });

    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Response 2',
      newText: 'Response 3',
    });

    const alternatives = messageBranchStore.getAlternatives(MESSAGE_ID);
    expect(alternatives).toEqual(['Response 1', 'Response 2', 'Response 3']);
  });

  test('swipeAlternative changes active index', () => {
    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Response 1',
      newText: 'Response 2',
    });
    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Response 2',
      newText: 'Response 3',
    });

    // Swipe left twice to go to index 0
    messageBranchStore.swipeAlternative({ messageId: MESSAGE_ID, direction: 'left' });
    expect(messageBranchStore.getActiveAlternative(MESSAGE_ID)).toBe('Response 2');

    messageBranchStore.swipeAlternative({ messageId: MESSAGE_ID, direction: 'left' });
    expect(messageBranchStore.getActiveAlternative(MESSAGE_ID)).toBe('Response 1');

    // Swipe right back
    messageBranchStore.swipeAlternative({ messageId: MESSAGE_ID, direction: 'right' });
    expect(messageBranchStore.getActiveAlternative(MESSAGE_ID)).toBe('Response 2');
  });

  test('swipeAlternative clamps at boundaries', () => {
    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Response 1',
      newText: 'Response 2',
    });

    // Try to swipe left past index 0
    messageBranchStore.swipeAlternative({ messageId: MESSAGE_ID, direction: 'left' });
    expect(messageBranchStore.getActiveAlternative(MESSAGE_ID)).toBe('Response 1');

    // Already at index 1 (last), try to go right past it
    // First go to Response 1, then back to Response 2, then try to go past
    messageBranchStore.swipeAlternative({ messageId: MESSAGE_ID, direction: 'left' });
    messageBranchStore.swipeAlternative({ messageId: MESSAGE_ID, direction: 'right' });
    messageBranchStore.swipeAlternative({ messageId: MESSAGE_ID, direction: 'right' });
    expect(messageBranchStore.getActiveAlternative(MESSAGE_ID)).toBe('Response 2');
  });

  test('swipeAlternative is no-op for unknown message', () => {
    messageBranchStore.swipeAlternative({ messageId: 'nonexistent', direction: 'left' });
    expect(messageBranchStore.getAlternatives('nonexistent')).toEqual([]);
  });

  test('getActiveAlternative returns undefined for unknown message', () => {
    expect(messageBranchStore.getActiveAlternative('nonexistent')).toBeUndefined();
  });

  test('clearAlternatives removes all alternatives for a message', () => {
    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Response 1',
      newText: 'Response 2',
    });

    messageBranchStore.clearAlternatives(MESSAGE_ID);
    expect(messageBranchStore.getAlternatives(MESSAGE_ID)).toEqual([]);
  });

  test('alternatives are capped at 20 — oldest evicted', () => {
    // Add 20 alternatives starting from "Response 1"
    for (let i = 1; i <= 22; i++) {
      messageBranchStore.addAlternative({
        messageId: MESSAGE_ID,
        currentText: `Response ${i}`,
        newText: `Response ${i + 1}`,
      });
    }

    const alternatives = messageBranchStore.getAlternatives(MESSAGE_ID);
    expect(alternatives.length).toBeLessThanOrEqual(20);
  });

  test('prepareRegeneration returns alternatives array for existing entry', () => {
    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Response 1',
      newText: 'Response 2',
    });

    const result = messageBranchStore.prepareRegeneration({
      messageId: MESSAGE_ID,
      currentText: 'Response 2',
    });

    expect(result.alternatives).toEqual(['Response 1', 'Response 2', 'Response 2']);
  });

  test('prepareRegeneration returns initial array for new entry', () => {
    const result = messageBranchStore.prepareRegeneration({
      messageId: 'new-msg',
      currentText: 'First response',
    });

    expect(result.alternatives).toEqual(['First response']);
  });

  test('enrichMessage adds alternative tracking to message', () => {
    messageBranchStore.addAlternative({
      messageId: MESSAGE_ID,
      currentText: 'Response 1',
      newText: 'Response 2',
    });

    const enriched = messageBranchStore.enrichMessage({
      id: MESSAGE_ID,
      text: 'Response 2',
      sender: 'ai',
      timestamp: new Date(),
    });

    expect(enriched.alternativeCount).toBe(2);
    expect(enriched.alternativeLabel).toBe('2/2');
    expect(enriched.canSwipeLeft).toBe(true);
    expect(enriched.canSwipeRight).toBe(false);
  });

  test('enrichMessage with single alternative shows no label', () => {
    const enriched = messageBranchStore.enrichMessage({
      id: 'single-msg',
      text: 'Only response',
      sender: 'ai',
      timestamp: new Date(),
    });

    expect(enriched.alternativeCount).toBe(1);
    expect(enriched.alternativeLabel).toBe('');
    expect(enriched.canSwipeLeft).toBe(false);
    expect(enriched.canSwipeRight).toBe(false);
  });

  test('enrichMessage with user message has alternativeCount 0', () => {
    const enriched = messageBranchStore.enrichMessage({
      id: 'user-msg',
      text: 'Hello',
      sender: 'user',
      timestamp: new Date(),
    });

    expect(enriched.alternativeCount).toBe(0);
  });
});
