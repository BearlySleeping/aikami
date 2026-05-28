import { beforeEach, describe, test } from 'bun:test';
import { getTestHelpers } from './helpers.ts';

describe('users collection', () => {
  let h: Awaited<ReturnType<typeof getTestHelpers>>;

  beforeEach(async () => {
    h = await getTestHelpers();
    await h.clear();
  });

  // ───────────────────────────────────────────
  // Owner
  // ───────────────────────────────────────────
  describe('owner', () => {
    test('can read own profile', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertSucceeds(db.collection('users').doc('user-123').get());
    });

    test('can create own profile', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertSucceeds(
        db.collection('users').doc('user-123').set({
          displayName: 'Alice',
          email: 'alice@example.com',
        }),
      );
    });

    test('can update own profile', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('users').doc('user-123').set({ displayName: 'Alice' });
      await h.assertSucceeds(
        db.collection('users').doc('user-123').update({ displayName: 'Alice Updated' }),
      );
    });

    test('can delete own profile', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('users').doc('user-123').set({ displayName: 'Alice' });
      await h.assertSucceeds(db.collection('users').doc('user-123').delete());
    });
  });

  // ───────────────────────────────────────────
  // Other authenticated user
  // ───────────────────────────────────────────
  describe('other authenticated user', () => {
    test('can read another profile', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('users').doc('user-123').set({ displayName: 'Alice' });

      const other = h.db(h.user('user-456'));
      await h.assertSucceeds(other.collection('users').doc('user-123').get());
    });

    test('cannot create another profile', async () => {
      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('users').doc('user-123').set({ displayName: 'Fake Alice' }),
      );
    });

    test('cannot update another profile', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('users').doc('user-123').set({ displayName: 'Alice' });

      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('users').doc('user-123').update({ displayName: 'Hacked' }),
      );
    });

    test('cannot delete another profile', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('users').doc('user-123').set({ displayName: 'Alice' });

      const other = h.db(h.user('user-456'));
      await h.assertFails(other.collection('users').doc('user-123').delete());
    });
  });

  // ───────────────────────────────────────────
  // Unauthenticated
  // ───────────────────────────────────────────
  describe('unauthenticated', () => {
    test('cannot read any profile', async () => {
      const db = h.db(h.anon());
      await h.assertFails(db.collection('users').doc('user-123').get());
    });

    test('cannot create any profile', async () => {
      const db = h.db(h.anon());
      await h.assertFails(db.collection('users').doc('user-123').set({ displayName: 'Alice' }));
    });

    test('cannot update any profile', async () => {
      const db = h.db(h.anon());
      await h.assertFails(db.collection('users').doc('user-123').update({ displayName: 'Hacked' }));
    });

    test('cannot delete any profile', async () => {
      const db = h.db(h.anon());
      await h.assertFails(db.collection('users').doc('user-123').delete());
    });
  });

  // ───────────────────────────────────────────
  // Admin
  // ───────────────────────────────────────────
  describe('admin', () => {
    test('can read any profile', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('users').doc('user-123').set({ displayName: 'Alice' });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(admin.collection('users').doc('user-123').get());
    });

    test('can create any profile', async () => {
      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(
        admin.collection('users').doc('user-123').set({ displayName: 'Admin Created' }),
      );
    });

    test('can update any profile', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('users').doc('user-123').set({ displayName: 'Alice' });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(
        admin.collection('users').doc('user-123').update({ displayName: 'Admin Updated' }),
      );
    });

    test('can delete any profile', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('users').doc('user-123').set({ displayName: 'Alice' });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(admin.collection('users').doc('user-123').delete());
    });
  });
});
