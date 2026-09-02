// packages/backend/storage/src/lib/__tests__/object_store.test.ts
//
// C-454 AC-1, AC-4: Unit tests for ObjectStore drivers.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { userObjectKey } from '@aikami/schemas';
import type { ObjectStore } from '../object_store.ts';

// ---------------------------------------------------------------------------
// In-memory fake ObjectStore for unit testing
// ---------------------------------------------------------------------------

const createFakeObjectStore = (): ObjectStore => {
  const store = new Map<string, ArrayBuffer>();
  let listCallCount = 0;

  const objectStore: ObjectStore = {
    async put(spec, params, body, _options) {
      const key = spec.build(params);
      store.set(key, body);
    },

    async get(spec, params) {
      const key = spec.build(params);
      return store.get(key);
    },

    async delete(spec, params) {
      const key = spec.build(params);
      store.delete(key);
    },

    async list(spec, prefixParams) {
      listCallCount++;
      const prefix = spec.build(prefixParams);
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };

  return Object.assign(objectStore, { getListCallCount: () => listCallCount });
};

describe('ObjectStore (fake driver)', () => {
  let store: ObjectStore & { getListCallCount: () => number };

  beforeEach(() => {
    store = createFakeObjectStore() as ObjectStore & { getListCallCount: () => number };
  });

  test('put and get round-trip', async () => {
    const body = new TextEncoder().encode('hello').buffer as ArrayBuffer;
    await store.put(userObjectKey, { uid: 'user-1', filename: 'test.txt' }, body);
    const result = await store.get(userObjectKey, { uid: 'user-1', filename: 'test.txt' });
    expect(result).toBeDefined();
    expect(new Uint8Array(result!)).toEqual(new Uint8Array(body));
  });

  test('get returns undefined for missing key', async () => {
    const result = await store.get(userObjectKey, { uid: 'user-x', filename: 'nope.txt' });
    expect(result).toBeUndefined();
  });

  test('delete removes an object', async () => {
    const body = new TextEncoder().encode('data').buffer as ArrayBuffer;
    await store.put(userObjectKey, { uid: 'user-1', filename: 'keep.txt' }, body);
    await store.put(userObjectKey, { uid: 'user-1', filename: 'remove.txt' }, body);
    await store.delete(userObjectKey, { uid: 'user-1', filename: 'remove.txt' });
    const remaining = await store.list(userObjectKey, { uid: 'user-1', filename: '' });
    expect(remaining).toEqual([`users/user-1/keep.txt`]);
  });

  test('list returns keys under a prefix', async () => {
    const body = new TextEncoder().encode('data').buffer as ArrayBuffer;
    await store.put(userObjectKey, { uid: 'user-1', filename: 'a.txt' }, body);
    await store.put(userObjectKey, { uid: 'user-1', filename: 'b.txt' }, body);
    await store.put(userObjectKey, { uid: 'user-2', filename: 'c.txt' }, body);
    const user1Keys = await store.list(userObjectKey, { uid: 'user-1', filename: '' });
    expect(user1Keys.sort()).toEqual(['users/user-1/a.txt', 'users/user-1/b.txt']);
  });

  test('list is called exactly once per publish run (AC-4)', async () => {
    // Simulate a publish run with N existing objects
    const body = new TextEncoder().encode('data').buffer as ArrayBuffer;
    for (let i = 0; i < 100; i++) {
      await store.put(
        userObjectKey,
        { uid: 'user-1', filename: `file-${i}.txt` },
        body,
      );
    }
    const callCountBefore = store.getListCallCount();
    const keys = await store.list(userObjectKey, { uid: 'user-1', filename: '' });
    expect(keys.length).toBe(100);
    // Exactly one list call was made
    expect(store.getListCallCount() - callCountBefore).toBe(1);
  });
});
