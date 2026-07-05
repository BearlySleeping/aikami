// apps/frontend/client/src/lib/services/chat/draft_store.test.ts
//
// Unit tests for DraftStore — IndexedDB-backed per-chat input draft
// persistence.
//
// Contract: C-231 AC-2 Input Draft Persistence

import { afterEach, describe, expect, test } from 'bun:test';
import { draftStore } from './draft_store';

// ── Helpers ──────────────────────────────────────────────────────────────

const TEST_CHAT_ID = 'test-chat-draft-001';
const TEST_CHAT_ID_2 = 'test-chat-draft-002';

/** Clears test drafts between tests. */
const cleanupDrafts = async () => {
  await draftStore.clearDraft({ chatId: TEST_CHAT_ID }).catch(() => {});
  await draftStore.clearDraft({ chatId: TEST_CHAT_ID_2 }).catch(() => {});
};

// ── AC-2: Input Draft Persistence ────────────────────────────────────────

describe('DraftStore — AC-2: Input Draft Persistence', () => {
  afterEach(async () => {
    await cleanupDrafts();
  });

  test('saveDraft persists text to IndexedDB and loadDraft returns it', async () => {
    const text = 'Hello, what is in this cave?';
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID, text });

    const loaded = await draftStore.loadDraft({ chatId: TEST_CHAT_ID });
    expect(loaded).toBe(text);
  });

  test('loadDraft returns empty string for unknown chat', async () => {
    const loaded = await draftStore.loadDraft({ chatId: 'nonexistent-chat' });
    expect(loaded).toBe('');
  });

  test('clearDraft removes the draft from IndexedDB', async () => {
    const text = 'Some draft text';
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID, text });
    await draftStore.clearDraft({ chatId: TEST_CHAT_ID });

    const loaded = await draftStore.loadDraft({ chatId: TEST_CHAT_ID });
    expect(loaded).toBe('');
  });

  test('saveDraft overwrites previous draft for the same chat', async () => {
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID, text: 'First version' });
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID, text: 'Second version' });

    const loaded = await draftStore.loadDraft({ chatId: TEST_CHAT_ID });
    expect(loaded).toBe('Second version');
  });

  test('multiple chats have independent drafts', async () => {
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID, text: 'Draft A' });
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID_2, text: 'Draft B' });

    const loadedA = await draftStore.loadDraft({ chatId: TEST_CHAT_ID });
    const loadedB = await draftStore.loadDraft({ chatId: TEST_CHAT_ID_2 });

    expect(loadedA).toBe('Draft A');
    expect(loadedB).toBe('Draft B');
  });

  test('clearDraft on one chat does not affect another', async () => {
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID, text: 'Draft A' });
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID_2, text: 'Draft B' });
    await draftStore.clearDraft({ chatId: TEST_CHAT_ID });

    const loadedB = await draftStore.loadDraft({ chatId: TEST_CHAT_ID_2 });
    expect(loadedB).toBe('Draft B');
  });

  test('deleteOrphanedDrafts removes drafts for inactive chats', async () => {
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID, text: 'Active draft' });
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID_2, text: 'Orphaned draft' });

    await draftStore.deleteOrphanedDrafts({ activeChatIds: [TEST_CHAT_ID] });

    const loadedActive = await draftStore.loadDraft({ chatId: TEST_CHAT_ID });
    const loadedOrphaned = await draftStore.loadDraft({ chatId: TEST_CHAT_ID_2 });

    expect(loadedActive).toBe('Active draft');
    expect(loadedOrphaned).toBe('');
  });

  test('saveDraft handles empty text', async () => {
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID, text: '' });

    const loaded = await draftStore.loadDraft({ chatId: TEST_CHAT_ID });
    expect(loaded).toBe('');
  });

  test('saveDraft handles very long text', async () => {
    const longText = 'A'.repeat(10000);
    await draftStore.saveDraft({ chatId: TEST_CHAT_ID, text: longText });

    const loaded = await draftStore.loadDraft({ chatId: TEST_CHAT_ID });
    expect(loaded).toBe(longText);
  });
});
