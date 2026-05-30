import { beforeEach, describe, test } from 'bun:test';
import { getTestHelpers } from './helpers.ts';

describe('chats collection', () => {
  let h: Awaited<ReturnType<typeof getTestHelpers>>;

  beforeEach(async () => {
    h = await getTestHelpers();
    await h.clear();
  });

  // ═══════════════════════════════════════════
  // Chat Documents
  // ═══════════════════════════════════════════
  describe('chat document', () => {
    // ───────────────────────────────────────────
    // Owner
    // ───────────────────────────────────────────
    describe('owner', () => {
      test('can read own private chat', async () => {
        const db = h.db(h.user('user-123'));
        await db.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'private',
        });
        await h.assertSucceeds(db.collection('chats').doc('chat-1').get());
      });

      test('can read own public chat', async () => {
        const db = h.db(h.user('user-123'));
        await db.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'public',
        });
        await h.assertSucceeds(db.collection('chats').doc('chat-1').get());
      });

      test('can create chat', async () => {
        const db = h.db(h.user('user-123'));
        await h.assertSucceeds(
          db.collection('chats').doc('chat-1').set({
            uid: 'user-123',
            npcId: 'npc-1',
            visibility: 'private',
          }),
        );
      });

      test('can update own chat', async () => {
        const db = h.db(h.user('user-123'));
        await db.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'private',
        });
        await h.assertSucceeds(
          db.collection('chats').doc('chat-1').update({ visibility: 'public' }),
        );
      });

      test('can delete own chat', async () => {
        const db = h.db(h.user('user-123'));
        await db.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'private',
        });
        await h.assertSucceeds(db.collection('chats').doc('chat-1').delete());
      });
    });

    // ───────────────────────────────────────────
    // Other authenticated user
    // ───────────────────────────────────────────
    describe('other authenticated user', () => {
      test('can read public chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'public',
        });

        const other = h.db(h.user('user-456'));
        await h.assertSucceeds(other.collection('chats').doc('chat-1').get());
      });

      test('cannot read private chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'private',
        });

        const other = h.db(h.user('user-456'));
        await h.assertFails(other.collection('chats').doc('chat-1').get());
      });

      test('cannot create chat for another user', async () => {
        const other = h.db(h.user('user-456'));
        await h.assertFails(
          other.collection('chats').doc('chat-1').set({
            uid: 'user-123',
            npcId: 'npc-1',
            visibility: 'private',
          }),
        );
      });

      test('cannot update another chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'public',
        });

        const other = h.db(h.user('user-456'));
        await h.assertFails(
          other.collection('chats').doc('chat-1').update({ visibility: 'private' }),
        );
      });

      test('cannot delete another chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'public',
        });

        const other = h.db(h.user('user-456'));
        await h.assertFails(other.collection('chats').doc('chat-1').delete());
      });
    });

    // ───────────────────────────────────────────
    // Unauthenticated
    // ───────────────────────────────────────────
    describe('unauthenticated', () => {
      test('can read public chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'public',
        });

        const anon = h.db(h.anon());
        await h.assertSucceeds(anon.collection('chats').doc('chat-1').get());
      });

      test('cannot read private chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'private',
        });

        const anon = h.db(h.anon());
        await h.assertFails(anon.collection('chats').doc('chat-1').get());
      });

      test('cannot create chat', async () => {
        const anon = h.db(h.anon());
        await h.assertFails(
          anon.collection('chats').doc('chat-1').set({
            uid: 'user-123',
            npcId: 'npc-1',
            visibility: 'public',
          }),
        );
      });

      test('cannot update chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'public',
        });

        const anon = h.db(h.anon());
        await h.assertFails(
          anon.collection('chats').doc('chat-1').update({ visibility: 'private' }),
        );
      });

      test('cannot delete chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'public',
        });

        const anon = h.db(h.anon());
        await h.assertFails(anon.collection('chats').doc('chat-1').delete());
      });
    });

    // ───────────────────────────────────────────
    // Admin
    // ───────────────────────────────────────────
    describe('admin', () => {
      test('can read private chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'private',
        });

        const admin = h.db(h.admin('admin-1'));
        await h.assertSucceeds(admin.collection('chats').doc('chat-1').get());
      });

      test('can update any chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'public',
        });

        const admin = h.db(h.admin('admin-1'));
        await h.assertSucceeds(
          admin.collection('chats').doc('chat-1').update({ visibility: 'private' }),
        );
      });

      test('can delete any chat', async () => {
        const owner = h.db(h.user('user-123'));
        await owner.collection('chats').doc('chat-1').set({
          uid: 'user-123',
          npcId: 'npc-1',
          visibility: 'public',
        });

        const admin = h.db(h.admin('admin-1'));
        await h.assertSucceeds(admin.collection('chats').doc('chat-1').delete());
      });
    });
  });

  // ═══════════════════════════════════════════
  // Messages Subcollection
  // ═══════════════════════════════════════════
  describe('messages subcollection', () => {
    test('owner can read message in private chat', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('chats').doc('chat-1').set({
        uid: 'user-123',
        npcId: 'npc-1',
        visibility: 'private',
      });
      await owner.collection('chats').doc('chat-1').collection('messages').doc('msg-1').set({
        text: 'Hello',
        chatOwnerUid: 'user-123',
        chatVisibility: 'private',
      });

      await h.assertSucceeds(
        owner.collection('chats').doc('chat-1').collection('messages').doc('msg-1').get(),
      );
    });

    test('other user can read message in public chat', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('chats').doc('chat-1').set({
        uid: 'user-123',
        npcId: 'npc-1',
        visibility: 'public',
      });
      await owner.collection('chats').doc('chat-1').collection('messages').doc('msg-1').set({
        text: 'Hello',
        chatOwnerUid: 'user-123',
        chatVisibility: 'public',
      });

      const other = h.db(h.user('user-456'));
      await h.assertSucceeds(
        other.collection('chats').doc('chat-1').collection('messages').doc('msg-1').get(),
      );
    });

    test('other user cannot read message in private chat', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('chats').doc('chat-1').set({
        uid: 'user-123',
        npcId: 'npc-1',
        visibility: 'private',
      });
      await owner.collection('chats').doc('chat-1').collection('messages').doc('msg-1').set({
        text: 'Hello',
        chatOwnerUid: 'user-123',
        chatVisibility: 'private',
      });

      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('chats').doc('chat-1').collection('messages').doc('msg-1').get(),
      );
    });

    test('unauthenticated can read message in public chat', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('chats').doc('chat-1').set({
        uid: 'user-123',
        npcId: 'npc-1',
        visibility: 'public',
      });
      await owner.collection('chats').doc('chat-1').collection('messages').doc('msg-1').set({
        text: 'Hello',
        chatOwnerUid: 'user-123',
        chatVisibility: 'public',
      });

      const anon = h.db(h.anon());
      await h.assertSucceeds(
        anon.collection('chats').doc('chat-1').collection('messages').doc('msg-1').get(),
      );
    });

    test('unauthenticated cannot read message in private chat', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('chats').doc('chat-1').set({
        uid: 'user-123',
        npcId: 'npc-1',
        visibility: 'private',
      });
      await owner.collection('chats').doc('chat-1').collection('messages').doc('msg-1').set({
        text: 'Hello',
        chatOwnerUid: 'user-123',
        chatVisibility: 'private',
      });

      const anon = h.db(h.anon());
      await h.assertFails(
        anon.collection('chats').doc('chat-1').collection('messages').doc('msg-1').get(),
      );
    });

    test('owner can create message in own chat', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('chats').doc('chat-1').set({
        uid: 'user-123',
        npcId: 'npc-1',
        visibility: 'private',
      });

      await h.assertSucceeds(
        owner.collection('chats').doc('chat-1').collection('messages').doc('msg-1').set({
          text: 'Hello',
          chatOwnerUid: 'user-123',
          chatVisibility: 'private',
        }),
      );
    });

    test('other user cannot create message in private chat', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('chats').doc('chat-1').set({
        uid: 'user-123',
        npcId: 'npc-1',
        visibility: 'private',
      });

      const other = h.db(h.user('user-456'));
      await h.assertFails(
        other.collection('chats').doc('chat-1').collection('messages').doc('msg-1').set({
          text: 'Hello',
          chatOwnerUid: 'user-123',
          chatVisibility: 'private',
        }),
      );
    });

    test('admin can read message in private chat', async () => {
      const owner = h.db(h.user('user-123'));
      await owner.collection('chats').doc('chat-1').set({
        uid: 'user-123',
        npcId: 'npc-1',
        visibility: 'private',
      });
      await owner.collection('chats').doc('chat-1').collection('messages').doc('msg-1').set({
        text: 'Hello',
        chatOwnerUid: 'user-123',
        chatVisibility: 'private',
      });

      const admin = h.db(h.admin('admin-1'));
      await h.assertSucceeds(
        admin.collection('chats').doc('chat-1').collection('messages').doc('msg-1').get(),
      );
    });
  });
});
