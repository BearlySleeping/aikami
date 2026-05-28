import { beforeEach, describe, test } from 'bun:test';
import { assertFails, assertSucceeds, rulesTest } from '@snorreks/firestack/testing';

describe('storage rules', () => {
  let env: Awaited<ReturnType<typeof rulesTest.firestore>>['env'];
  let clearStorage: Awaited<ReturnType<typeof rulesTest.firestore>>['clearStorage'];

  beforeEach(async () => {
    const result = await rulesTest.firestore();
    env = result.env;
    clearStorage = result.clearStorage;
    await clearStorage();
  });

  // ═══════════════════════════════════════════
  // User files
  // ═══════════════════════════════════════════
  describe('user files', () => {
    test('owner can read own file', async () => {
      const user = env.authenticatedContext('user-123');
      const storage = user.storage();
      const ref = storage.ref('users/user-123/avatar.png');
      await assertSucceeds(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
      await assertSucceeds(ref.getDownloadURL());
    });

    test('owner can upload image to own folder', async () => {
      const user = env.authenticatedContext('user-123');
      const storage = user.storage();
      const ref = storage.ref('users/user-123/avatar.png');
      await assertSucceeds(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
    });

    test('owner cannot upload non-image to own folder', async () => {
      const user = env.authenticatedContext('user-123');
      const storage = user.storage();
      const ref = storage.ref('users/user-123/document.pdf');
      await assertFails(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' }));
    });

    test('other authenticated user can read user file', async () => {
      const owner = env.authenticatedContext('user-123');
      await owner
        .storage()
        .ref('users/user-123/avatar.png')
        .put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' });

      const other = env.authenticatedContext('user-456');
      const storage = other.storage();
      await assertSucceeds(storage.ref('users/user-123/avatar.png').getDownloadURL());
    });

    test('other authenticated user cannot upload to another folder', async () => {
      const other = env.authenticatedContext('user-456');
      const storage = other.storage();
      const ref = storage.ref('users/user-123/avatar.png');
      await assertFails(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
    });

    test('unauthenticated cannot read user file', async () => {
      const anon = env.unauthenticatedContext();
      const storage = anon.storage();
      const ref = storage.ref('users/user-123/avatar.png');
      await assertFails(ref.getDownloadURL());
    });

    test('unauthenticated cannot upload to user folder', async () => {
      const anon = env.unauthenticatedContext();
      const storage = anon.storage();
      const ref = storage.ref('users/user-123/avatar.png');
      await assertFails(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
    });
  });

  // ═══════════════════════════════════════════
  // NPC files
  // ═══════════════════════════════════════════
  describe('npc files', () => {
    test('authenticated user can upload npc avatar', async () => {
      const user = env.authenticatedContext('user-123');
      const storage = user.storage();
      const ref = storage.ref('npcs/npc-1/avatar.png');
      await assertSucceeds(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
    });

    test('unauthenticated can read npc avatar', async () => {
      const user = env.authenticatedContext('user-123');
      await user
        .storage()
        .ref('npcs/npc-1/avatar.png')
        .put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' });

      const anon = env.unauthenticatedContext();
      const storage = anon.storage();
      await assertSucceeds(storage.ref('npcs/npc-1/avatar.png').getDownloadURL());
    });

    test('unauthenticated cannot upload npc avatar', async () => {
      const anon = env.unauthenticatedContext();
      const storage = anon.storage();
      const ref = storage.ref('npcs/npc-1/avatar.png');
      await assertFails(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
    });
  });

  // ═══════════════════════════════════════════
  // Public files
  // ═══════════════════════════════════════════
  describe('public files', () => {
    test('authenticated user can upload public image', async () => {
      const user = env.authenticatedContext('user-123');
      const storage = user.storage();
      const ref = storage.ref('public/banner.png');
      await assertSucceeds(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
    });

    test('unauthenticated can read public file', async () => {
      const user = env.authenticatedContext('user-123');
      await user
        .storage()
        .ref('public/banner.png')
        .put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' });

      const anon = env.unauthenticatedContext();
      const storage = anon.storage();
      await assertSucceeds(storage.ref('public/banner.png').getDownloadURL());
    });

    test('unauthenticated cannot upload public file', async () => {
      const anon = env.unauthenticatedContext();
      const storage = anon.storage();
      const ref = storage.ref('public/banner.png');
      await assertFails(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
    });
  });

  // ═══════════════════════════════════════════
  // Unknown paths
  // ═══════════════════════════════════════════
  describe('unknown paths', () => {
    test('authenticated user cannot write to random path', async () => {
      const user = env.authenticatedContext('user-123');
      const storage = user.storage();
      const ref = storage.ref('random/path/file.png');
      await assertFails(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
    });

    test('admin cannot write to random path', async () => {
      const admin = env.authenticatedContext('admin-1', { userRole: 'superAdmin' });
      const storage = admin.storage();
      const ref = storage.ref('random/path/file.png');
      await assertFails(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
    });
  });
});
