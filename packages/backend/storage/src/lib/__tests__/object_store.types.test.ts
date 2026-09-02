// packages/backend/storage/src/lib/__tests__/object_store.types.test.ts
//
// C-454 AC-5: Type-level tests proving that passing mismatched params or a
// bare string to ObjectStore methods is a compile error.
//
// Each test uses a `// @ts-expect-error` comment — if the line below it
// compiles without error (because type safety was weakened), tsc itself
// reports "Unused '@ts-expect-error' directive" and the file fails to
// typecheck. This is a real assertion, not a comment.

import { describe, expect, test } from 'bun:test';
import { assetKey, userObjectKey } from '@aikami/schemas';
import type { ObjectStore } from '../object_store.ts';

describe('AC-5: Type-level compile errors', () => {
  test('wrong params shape fails to compile', () => {
    // @ts-expect-error - userObjectKey.build expects { uid, filename }
    userObjectKey.build({ wrongField: 'x' });

    expect(true).toBe(true);
  });

  test('extra params shape fails to compile', () => {
    // @ts-expect-error - userObjectKey.build expects { uid, filename }, not extra fields
    userObjectKey.build({ uid: 'x', filename: 'y', extra: 'z' });

    expect(true).toBe(true);
  });

  test('missing params shape fails to compile', () => {
    // @ts-expect-error - userObjectKey.build expects { uid, filename }, not { uid } alone
    userObjectKey.build({ uid: 'x' });

    expect(true).toBe(true);
  });

  test('ObjectStore.put with mismatched spec and params fails to compile', () => {
    // Define a function that is never called — TypeScript type-checks the body
    // but the runtime never executes it, avoiding null-pointer errors.
    const _typeCheck = (): void => {
      const store = null as unknown as ObjectStore;
      const body = new ArrayBuffer(0);

      // @ts-expect-error - assetKey expects { sha256, ext }, not { uid, filename }
      store.put({ spec: assetKey, params: { uid: 'x', filename: 'y' }, body });
    };
    void _typeCheck;
    expect(true).toBe(true);
  });

  test('ObjectStore methods reject bare string keys', () => {
    const _typeCheck = (): void => {
      const store = null as unknown as ObjectStore;

      // @ts-expect-error - ObjectStore.get requires a typed KeySpec options object
      store.get('users/user-1/file.txt');
    };
    void _typeCheck;

    // Verify the KeySpec type is required, not any/string
    expect(userObjectKey.build).toBeInstanceOf(Function);
  });
});
