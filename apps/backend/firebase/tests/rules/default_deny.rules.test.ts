// apps/backend/firebase/tests/rules/default_deny.rules.test.ts
//
// C-386 AC-9: firestore.rules is default-deny only. Every collection that the
// product used to store (chat, ChatLink, personas, NPCs, custom agents, user
// profiles, notifications, configs, stats, FCM tokens) now lives in the
// client's local SQLite database — reads and writes must be DENIED for all of
// them, for every auth state.

import { beforeEach, describe, test } from 'bun:test';
import { getTestHelpers } from './helpers.ts';

describe('firestore default-deny (C-386 AC-9)', () => {
  let h: Awaited<ReturnType<typeof getTestHelpers>>;

  beforeEach(async () => {
    h = await getTestHelpers();
    await h.clear();
  });

  // ── Vacated collections ──────────────────────────────────────────────

  const vacatedCollections = [
    'chats',
    'users',
    'personas',
    'npcs',
    'agent_definitions',
    'configs',
    'stats',
  ] as const;

  for (const collection of vacatedCollections) {
    describe(`${collection} collection`, () => {
      test('owner cannot create a document', async () => {
        const db = h.db(h.user('user-123'));
        await h.assertFails(db.collection(collection).doc('doc-1').set({ uid: 'user-123' }));
      });

      test('owner cannot read a document', async () => {
        // Seed bypassing rules, then assert owner read is denied.
        await h.seed({ path: [collection, 'doc-1'], data: { uid: 'user-123' } });
        const db = h.db(h.user('user-123'));
        await h.assertFails(db.collection(collection).doc('doc-1').get());
      });

      test('owner cannot list the collection', async () => {
        const db = h.db(h.user('user-123'));
        await h.assertFails(db.collection(collection).get());
      });

      test('owner cannot update a document', async () => {
        await h.seed({ path: [collection, 'doc-1'], data: { uid: 'user-123' } });
        const db = h.db(h.user('user-123'));
        await h.assertFails(db.collection(collection).doc('doc-1').update({ name: 'x' }));
      });

      test('owner cannot delete a document', async () => {
        await h.seed({ path: [collection, 'doc-1'], data: { uid: 'user-123' } });
        const db = h.db(h.user('user-123'));
        await h.assertFails(db.collection(collection).doc('doc-1').delete());
      });

      test('admin cannot read or write either', async () => {
        const db = h.db(h.admin('admin-1'));
        await h.assertFails(db.collection(collection).doc('doc-1').set({ uid: 'admin-1' }));
        await h.assertFails(db.collection(collection).doc('doc-1').get());
      });

      test('anonymous cannot read or write', async () => {
        const db = h.db(h.anon());
        await h.assertFails(db.collection(collection).doc('doc-1').set({ name: 'x' }));
        await h.assertFails(db.collection(collection).doc('doc-1').get());
      });
    });
  }

  // ── Subcollections that were vacated with their parents ─────────────

  describe('chats/{chatId}/chatLinks (ChatLink, C-386a)', () => {
    test('owner cannot create or read a ChatLink', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertFails(
        db.collection('chats').doc('chat-1').collection('chatLinks').doc('link-1').set({
          isActive: true,
        }),
      );
      await h.assertFails(
        db.collection('chats').doc('chat-1').collection('chatLinks').doc('link-1').get(),
      );
    });
  });

  describe('chats/{chatId}/messages (legacy Firestore messages)', () => {
    test('owner cannot read or write messages', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertFails(
        db.collection('chats').doc('chat-1').collection('messages').doc('m-1').set({
          text: 'hello',
        }),
      );
      await h.assertFails(
        db.collection('chats').doc('chat-1').collection('messages').doc('m-1').get(),
      );
    });
  });

  describe('users/{uid}/notifications (C-386c)', () => {
    test('owner cannot read or write notifications', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertFails(
        db.collection('users').doc('user-123').collection('notifications').doc('n-1').set({
          title: 'Hello',
        }),
      );
      await h.assertFails(
        db.collection('users').doc('user-123').collection('notifications').doc('n-1').get(),
      );
    });
  });

  describe('users/{uid}/tokens (FCM tokens)', () => {
    test('owner cannot read or write tokens', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertFails(
        db.collection('users').doc('user-123').collection('tokens').doc('t-1').set({
          token: 'abc',
        }),
      );
      await h.assertFails(
        db.collection('users').doc('user-123').collection('tokens').doc('t-1').get(),
      );
    });
  });

  describe('device_handoffs (auth bridge)', () => {
    test('no client can read or write device handoff docs', async () => {
      const db = h.db(h.user('user-123'));
      await h.assertFails(db.collection('device_handoffs').doc('code-1').set({ token: 'x' }));
      await h.assertFails(db.collection('device_handoffs').doc('code-1').get());
    });
  });
});
