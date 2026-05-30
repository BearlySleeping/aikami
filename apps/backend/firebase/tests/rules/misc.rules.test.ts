import { beforeEach, describe, test } from 'bun:test';
import { getTestHelpers } from './helpers.ts';

describe('notifications subcollection', () => {
  let h: Awaited<ReturnType<typeof getTestHelpers>>;

  beforeEach(async () => {
    h = await getTestHelpers();
    await h.clear();
  });

  describe('owner', () => {
    test('can read own notification', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
        title: 'Hello',
      });
      await h.assertSucceeds(
        db.collection('users').doc('user-123').collection('notifications').doc('n-1').get(),
      );
    });

    test('can create own notification', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertSucceeds(
        db.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
          title: 'Hello',
        }),
      );
    });

    test('can update own notification', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
        title: 'Hello',
      });
      await h.assertSucceeds(
        db.collection('users').doc('user-123').collection('notifications').doc('n-1').update({
          title: 'Updated',
        }),
      );
    });

    test('can delete own notification', async () => {
      const db = h.db(h.user('user-123'));
      await db.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
        title: 'Hello',
      });
      await h.assertSucceeds(
        db.collection('users').doc('user-123').collection('notifications').doc('n-1').delete(),
      );
    });
  });

  describe('other authenticated user', () => {
    test('cannot read another notification', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
        title: 'Hello',
      });

      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('users').doc('user-123').collection('notifications').doc('n-1').get(),
      );
    });

    test('cannot create notification for another user', async () => {
      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
          title: 'Fake',
        }),
      );
    });

    test('cannot update another notification', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
        title: 'Hello',
      });

      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('users').doc('user-123').collection('notifications').doc('n-1').update({
          title: 'Hacked',
        }),
      );
    });

    test('cannot delete another notification', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
        title: 'Hello',
      });

      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('users').doc('user-123').collection('notifications').doc('n-1').delete(),
      );
    });
  });

  describe('unauthenticated', () => {
    test('cannot read any notification', async () => {
      const db = h.db(h.anon());
      await h.assertFails(
        db.collection('users').doc('user-123').collection('notifications').doc('n-1').get(),
      );
    });

    test('cannot create any notification', async () => {
      const db = h.db(h.anon());
      await h.assertFails(
        db.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
          title: 'Fake',
        }),
      );
    });
  });
});

describe('stats collection', () => {
  let h: Awaited<ReturnType<typeof getTestHelpers>>;

  beforeEach(async () => {
    h = await getTestHelpers();
    await h.clear();
  });

  test('admin can read total stats', async () => {
    const admin = h.db(h.admin('admin-1'));
    await h.assertSucceeds(admin.collection('stats').doc('total').get());
  });

  test('normal user cannot read total stats', async () => {
    const user = h.db(h.user('user-123'));
    await h.assertFails(user.collection('stats').doc('total').get());
  });

  test('unauthenticated cannot read total stats', async () => {
    const anon = h.db(h.anon());
    await h.assertFails(anon.collection('stats').doc('total').get());
  });

  test('admin cannot write total stats', async () => {
    const admin = h.db(h.admin('admin-1'));
    await h.assertFails(admin.collection('stats').doc('total').set({ count: 100 }));
  });

  test('normal user cannot write total stats', async () => {
    const user = h.db(h.user('user-123'));
    await h.assertFails(user.collection('stats').doc('total').set({ count: 100 }));
  });
});
