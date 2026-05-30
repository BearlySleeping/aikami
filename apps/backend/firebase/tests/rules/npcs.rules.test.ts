import { beforeEach, describe, test } from 'bun:test';
import { getTestHelpers } from './helpers.ts';

describe('npcs collection', () => {
  let h: Awaited<ReturnType<typeof getTestHelpers>>;

  beforeEach(async () => {
    h = await getTestHelpers();
    await h.clear();
  });

  // ───────────────────────────────────────────
  // Creator
  // ───────────────────────────────────────────
  describe('creator', () => {
    test('can read own public npc', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });
      await h.assertSucceeds(db.collection('npcs').doc('npc-1').get());
    });

    test('can read own private npc', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Secret Boss',
        visibility: 'private',
      });
      await h.assertSucceeds(db.collection('npcs').doc('npc-1').get());
    });

    test('can create npc', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertSucceeds(
        db.collection('npcs').doc('npc-1').set({
          creatorUid: 'user-123',
          name: 'Goblin',
          visibility: 'public',
        }),
      );
    });

    test('can update own npc', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });
      await h.assertSucceeds(db.collection('npcs').doc('npc-1').update({ name: 'Orc' }));
    });

    test('can delete own npc', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });
      await h.assertSucceeds(db.collection('npcs').doc('npc-1').delete());
    });
  });

  // ───────────────────────────────────────────
  // Other authenticated user
  // ───────────────────────────────────────────
  describe('other authenticated user', () => {
    test('can read public npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });

      const other = h.db(h.user('user-456'));
      await h.assertSucceeds(other.collection('npcs').doc('npc-1').get());
    });

    test('cannot read private npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Secret Boss',
        visibility: 'private',
      });

      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('npcs').doc('npc-1').get());
    });

    test('cannot create npc for another user', async () => {
      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('npcs').doc('npc-1').set({
          creatorUid: 'user-123',
          name: 'Fake',
          visibility: 'public',
        }),
      );
    });

    test('cannot update another npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });

      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('npcs').doc('npc-1').update({ name: 'Hacked' }));
    });

    test('cannot delete another npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });

      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('npcs').doc('npc-1').delete());
    });
  });

  // ───────────────────────────────────────────
  // Unauthenticated
  // ───────────────────────────────────────────
  describe('unauthenticated', () => {
    test('can read public npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });

      const anon = h.db(h.anon());
      await h.assertSucceeds(anon.collection('npcs').doc('npc-1').get());
    });

    test('cannot read private npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Secret Boss',
        visibility: 'private',
      });

      const anon = h.db(h.anon());
      await h.assertFails(anon.collection('npcs').doc('npc-1').get());
    });

    test('cannot create npc', async () => {
      const anon = h.db(h.anon());
      await h.assertFails(
        anon.collection('npcs').doc('npc-1').set({
          creatorUid: 'user-123',
          name: 'Fake',
          visibility: 'public',
        }),
      );
    });

    test('cannot update npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });

      const anon = h.db(h.anon());
      await h.assertFails(anon.collection('npcs').doc('npc-1').update({ name: 'Hacked' }));
    });

    test('cannot delete npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });

      const anon = h.db(h.anon());
      await h.assertFails(anon.collection('npcs').doc('npc-1').delete());
    });
  });

  // ───────────────────────────────────────────
  // Admin
  // ───────────────────────────────────────────
  describe('admin', () => {
    test('can read private npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Secret Boss',
        visibility: 'private',
      });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(admin.collection('npcs').doc('npc-1').get());
    });

    test('can update any npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(
        admin.collection('npcs').doc('npc-1').update({ name: 'Admin Updated' }),
      );
    });

    test('can delete any npc', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('npcs').doc('npc-1').set({
        creatorUid: 'user-123',
        name: 'Goblin',
        visibility: 'public',
      });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(admin.collection('npcs').doc('npc-1').delete());
    });
  });
});
