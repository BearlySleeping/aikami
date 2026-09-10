// apps/frontend/client/src/lib/services/npc/npc_storage.test.ts
//
// Contract tests for the local NPC repository (C-386b AC-5) against a real
// in-memory libSQL database with the production migrations applied. Verifies
// NPCs resolve fully from the local table — no Firestore calls — with SQLite
// actually enforcing the schema, ordering and conflict semantics.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRealLocalDatabase } from '../__tests__/local_database_fixture.ts';

const fixture = await createRealLocalDatabase();

mock.module('@aikami/frontend/storage', () => ({
  getLocalDatabase: mock(async () => fixture.db),
}));

// ── Service under test ────────────────────────────────────────────────

import type { NpcStorageInterface } from './npc_storage.svelte.ts';
import { npcStorage } from './npc_storage.svelte.ts';

describe('NpcStorage (local SQLite)', () => {
  let storage: NpcStorageInterface;

  beforeEach(async () => {
    await fixture.reset();
    storage = npcStorage;
  });

  afterAll(async () => {
    await fixture.close();
  });

  test('createNpc then get returns it', async () => {
    const id = await storage.createNpc({
      uid: 'user-1',
      data: { name: 'Gandalf', race: 'Maiar', visibility: 'private' },
    });
    const npc = await storage.get({ npcId: id });
    expect(npc?.name).toBe('Gandalf');
    expect(npc?.race).toBe('Maiar');
    expect(npc?.visibility).toBe('private');
  });

  test('getSystemNpcs returns all NPCs', async () => {
    await storage.createNpc({ uid: 'u1', data: { name: 'One' } });
    await storage.createNpc({ uid: 'u1', data: { name: 'Two' } });
    const npcs = await storage.getSystemNpcs();
    expect(npcs).toHaveLength(2);
  });

  test('getUserNpcs is per-install (uid is API parity)', async () => {
    await storage.createNpc({ uid: 'u1', data: { name: 'One' } });
    const npcs = await storage.getUserNpcs({ uid: 'different-user' });
    expect(npcs).toHaveLength(1);
  });

  test('getPublicNpcs filters by visibility', async () => {
    await storage.createNpc({ uid: 'u1', data: { name: 'Public', visibility: 'public' } });
    await storage.createNpc({ uid: 'u1', data: { name: 'Private', visibility: 'private' } });
    const npcs = await storage.getPublicNpcs();
    expect(npcs).toHaveLength(1);
    expect(npcs[0]?.name).toBe('Public');
  });

  test('get returns undefined for missing NPC', async () => {
    expect(await storage.get({ npcId: 'missing' })).toBeUndefined();
  });

  test('updateNpc merges fields', async () => {
    const id = await storage.createNpc({ uid: 'u1', data: { name: 'Gandalf' } });
    await storage.updateNpc({ npcId: id, data: { name: 'Gandalf the Grey' } });
    const npc = await storage.get({ npcId: id });
    expect(npc?.name).toBe('Gandalf the Grey');
  });

  test('deleteNpc removes the row', async () => {
    const id = await storage.createNpc({ uid: 'u1', data: { name: 'Gandalf' } });
    await storage.deleteNpc({ npcId: id });
    expect(await storage.get({ npcId: id })).toBeUndefined();
  });

  test('forkNpc copies the source NPC', async () => {
    const id = await storage.createNpc({
      uid: 'u1',
      data: { name: 'Gandalf', race: 'Maiar', visibility: 'public' },
    });
    const forkId = await storage.forkNpc({ systemNpcId: id, uid: 'u2' });
    expect(forkId).not.toBe(id);
    const fork = await storage.get({ npcId: forkId });
    expect(fork?.name).toBe('Gandalf');
    expect(fork?.race).toBe('Maiar');
    expect(fork?.forkedFromNpcId).toBe(id);
  });

  test('forkNpc throws for missing source', async () => {
    expect(storage.forkNpc({ systemNpcId: 'missing', uid: 'u2' })).rejects.toThrow();
  });
});
