import { beforeEach, describe, test } from 'bun:test';
import { getTestHelpers } from './helpers.ts';

describe('configs collection', () => {
  let h: Awaited<ReturnType<typeof getTestHelpers>>;

  beforeEach(async () => {
    h = await getTestHelpers();
    await h.clear();
  });

  // ───────────────────────────────────────────
  // Owner
  // ───────────────────────────────────────────
  describe('owner', () => {
    test('can read own config', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertSucceeds(db.collection('configs').doc('user-123').get());
    });

    test('can create own config', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertSucceeds(db.collection('configs').doc('user-123').set({ theme: 'dark' }));
    });

    test('can update own config', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('configs').doc('user-123').set({ theme: 'dark' });
      await h.assertSucceeds(db.collection('configs').doc('user-123').update({ theme: 'light' }));
    });

    test('can delete own config', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('configs').doc('user-123').set({ theme: 'dark' });
      await h.assertSucceeds(db.collection('configs').doc('user-123').delete());
    });
  });

  // ───────────────────────────────────────────
  // Other authenticated user
  // ───────────────────────────────────────────
  describe('other authenticated user', () => {
    test('cannot read another config', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('configs').doc('user-123').set({ theme: 'dark' });

      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('configs').doc('user-123').get());
    });

    test('cannot create another config', async () => {
      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('configs').doc('user-123').set({ theme: 'dark' }));
    });

    test('cannot update another config', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('configs').doc('user-123').set({ theme: 'dark' });

      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('configs').doc('user-123').update({ theme: 'light' }));
    });

    test('cannot delete another config', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('configs').doc('user-123').set({ theme: 'dark' });

      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('configs').doc('user-123').delete());
    });
  });

  // ───────────────────────────────────────────
  // Unauthenticated
  // ───────────────────────────────────────────
  describe('unauthenticated', () => {
    test('cannot read any config', async () => {
      const db = h.db(h.anon());
      await h.assertFails(db.collection('configs').doc('user-123').get());
    });

    test('cannot create any config', async () => {
      const db = h.db(h.anon());
      await h.assertFails(db.collection('configs').doc('user-123').set({ theme: 'dark' }));
    });

    test('cannot update any config', async () => {
      const db = h.db(h.anon());
      await h.assertFails(db.collection('configs').doc('user-123').update({ theme: 'light' }));
    });

    test('cannot delete any config', async () => {
      const db = h.db(h.anon());
      await h.assertFails(db.collection('configs').doc('user-123').delete());
    });
  });

  // ───────────────────────────────────────────
  // Admin
  // ───────────────────────────────────────────
  describe('admin', () => {
    test('cannot read another config (admin has no special access)', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('configs').doc('user-123').set({ theme: 'dark' });

      const admin = h.db(h.admin('admin-1'));
      await h.assertFails(admin.collection('configs').doc('user-123').get());
    });

    test('cannot update another config', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('configs').doc('user-123').set({ theme: 'dark' });

      const admin = h.db(h.admin('admin-1'));
      await h.assertFails(admin.collection('configs').doc('user-123').update({ theme: 'light' }));
    });
  });
});
