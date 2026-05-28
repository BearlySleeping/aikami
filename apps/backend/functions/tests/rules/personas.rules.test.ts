import { beforeEach, describe, test } from 'bun:test';
import { getTestHelpers } from './helpers.ts';

describe('personas collection', () => {
  let h: Awaited<ReturnType<typeof getTestHelpers>>;

  beforeEach(async () => {
    h = await getTestHelpers();
    await h.clear();
  });

  // ───────────────────────────────────────────
  // Creator
  // ───────────────────────────────────────────
  describe('creator', () => {
    test('can read own persona', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });
      await h.assertSucceeds(db.collection('personas').doc('p-1').get());
    });

    test('can create persona', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertSucceeds(
        db.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' }),
      );
    });

    test('can update own persona', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });
      await h.assertSucceeds(db.collection('personas').doc('p-1').update({ name: 'Mage' }));
    });

    test('can delete own persona', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });
      await h.assertSucceeds(db.collection('personas').doc('p-1').delete());
    });
  });

  // ───────────────────────────────────────────
  // Other authenticated user
  // ───────────────────────────────────────────
  describe('other authenticated user', () => {
    test('can read public persona', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });

      const other = h.db(h.user('user-456'));
      await h.assertSucceeds(other.collection('personas').doc('p-1').get());
    });

    test('cannot create persona for another user', async () => {
      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Fake' }),
      );
    });

    test('cannot update another persona', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });

      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('personas').doc('p-1').update({ name: 'Hacked' }));
    });

    test('cannot delete another persona', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });

      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('personas').doc('p-1').delete());
    });
  });

  // ───────────────────────────────────────────
  // Unauthenticated
  // ───────────────────────────────────────────
  describe('unauthenticated', () => {
    test('can read public persona', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });

      const anon = h.db(h.anon());
      await h.assertSucceeds(anon.collection('personas').doc('p-1').get());
    });

    test('cannot create persona', async () => {
      const anon = h.db(h.anon());
      await h.assertFails(
        anon.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Fake' }),
      );
    });

    test('cannot update persona', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });

      const anon = h.db(h.anon());
      await h.assertFails(anon.collection('personas').doc('p-1').update({ name: 'Hacked' }));
    });

    test('cannot delete persona', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });

      const anon = h.db(h.anon());
      await h.assertFails(anon.collection('personas').doc('p-1').delete());
    });
  });

  // ───────────────────────────────────────────
  // Admin
  // ───────────────────────────────────────────
  describe('admin', () => {
    test('can read any persona', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(admin.collection('personas').doc('p-1').get());
    });

    test('can update any persona', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(
        admin.collection('personas').doc('p-1').update({ name: 'Admin Updated' }),
      );
    });

    test('can delete any persona', async () => {
      const creator = h.db(h.user('user-123'));
      await creator.collection('personas').doc('p-1').set({ uid: 'user-123', name: 'Warrior' });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(admin.collection('personas').doc('p-1').delete());
    });
  });
});
