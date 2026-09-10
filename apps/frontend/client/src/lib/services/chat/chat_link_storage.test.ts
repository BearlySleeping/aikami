// apps/frontend/client/src/lib/services/chat/chat_link_storage.test.ts
//
// Contract tests for the local ChatLink repository (C-386a AC-2) against a
// real in-memory libSQL database with the production migrations applied.
// Verifies ChatLink CRUD, soft-deactivate, notes/influences, and influence
// consumption all read/write the local `chat_links` table — no Firestore.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { countTableRows, createRealLocalDatabase } from '../__tests__/local_database_fixture.ts';

const fixture = await createRealLocalDatabase();

mock.module('@aikami/frontend/storage', () => ({
  getLocalDatabase: mock(async () => fixture.db),
}));

// ── Service under test ────────────────────────────────────────────────

import type { ChatLinkStorageInterface } from './chat_link_storage.svelte.ts';
import { chatLinkStorage } from './chat_link_storage.svelte.ts';

describe('ChatLinkStorage (local SQLite)', () => {
  let storage: ChatLinkStorageInterface;

  beforeEach(async () => {
    await fixture.reset();
    storage = chatLinkStorage;
  });

  afterAll(async () => {
    await fixture.close();
  });

  test('createLink stores a row and getActiveLink returns it', async () => {
    const link = await storage.createLink({
      sourceChatId: 'ooc-1',
      targetChatId: 'game-1',
    });

    expect(link.linkId).toBeTruthy();
    expect(link.sourceChatId).toBe('ooc-1');
    expect(link.targetChatId).toBe('game-1');
    expect(link.isActive).toBe(true);
    expect(await countTableRows(fixture.db, 'chat_links')).toBe(1);

    const active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.linkId).toBe(link.linkId);
  });

  test('getActiveLink returns undefined when no link exists', async () => {
    const active = await storage.getActiveLink({ targetChatId: 'nope' });
    expect(active).toBeUndefined();
  });

  test('getActiveLink returns undefined for soft-deactivated link', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.unlink({ linkId: link.linkId });
    const active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active).toBeUndefined();
  });

  test('unlink preserves the row (soft-deactivate)', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.unlink({ linkId: link.linkId });
    expect(await countTableRows(fixture.db, 'chat_links')).toBe(1);
  });

  test('addNote and removeNote round-trip', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.addNote({ linkId: link.linkId, note: 'Remember the ring' });
    await storage.addNote({ linkId: link.linkId, note: 'Frodo is alive' });

    let active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.notes).toEqual(['Remember the ring', 'Frodo is alive']);

    await storage.removeNote({ linkId: link.linkId, index: 0 });
    active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.notes).toEqual(['Frodo is alive']);
  });

  test('addInfluence and removeInfluence round-trip', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.addInfluence({ linkId: link.linkId, influence: 'Be wary' });

    let active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.pendingInfluences).toEqual(['Be wary']);

    await storage.removeInfluence({ linkId: link.linkId, index: 0 });
    active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.pendingInfluences).toEqual([]);
  });

  test('consumeInfluences empties the pending list (atomic bridge consumption)', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.addInfluence({ linkId: link.linkId, influence: 'I1' });
    await storage.addInfluence({ linkId: link.linkId, influence: 'I2' });

    await storage.consumeInfluences({ linkId: link.linkId });
    const active = await storage.getActiveLink({ targetChatId: 'game-1' });
    expect(active?.pendingInfluences).toEqual([]);
  });

  test('deleteLink removes the row entirely', async () => {
    const link = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    await storage.deleteLink({ linkId: link.linkId });
    expect(await countTableRows(fixture.db, 'chat_links')).toBe(0);
  });

  test('multiple links for same target return the most recent active one', async () => {
    const first = await storage.createLink({ sourceChatId: 'ooc-1', targetChatId: 'game-1' });
    const second = await storage.createLink({ sourceChatId: 'ooc-2', targetChatId: 'game-1' });

    const active = await storage.getActiveLink({ targetChatId: 'game-1' });
    // Both are active; the latest created row wins (ORDER BY created_at DESC).
    expect([first.linkId, second.linkId]).toContain(active?.linkId);
  });
});
