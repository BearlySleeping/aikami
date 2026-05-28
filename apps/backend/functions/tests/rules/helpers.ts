// apps/backend/functions/tests/rules/helpers.ts

import type { RulesTestContext } from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds, rulesTest } from '@snorreks/firestack/testing';

export type TestHelpers = {
  db: (ctx: RulesTestContext) => ReturnType<RulesTestContext['firestore']>;
  user: (uid: string) => RulesTestContext;
  admin: (uid: string) => RulesTestContext;
  anon: () => RulesTestContext;
  clear: () => Promise<void>;
  cleanup: () => Promise<void>;
  assertSucceeds: typeof assertSucceeds;
  assertFails: typeof assertFails;
};

/**
 * Creates test helpers connected to the rules emulator.
 * Call once per describe block, then use the returned helpers.
 */
export async function getTestHelpers(): Promise<TestHelpers> {
  const { withAuth, withoutAuth, clearFirestore, cleanup, env } = await rulesTest.firestore();

  return {
    db: (ctx) => ctx.firestore(),
    user: (uid) => withAuth(uid),
    admin: (uid) => env.authenticatedContext(uid, { userRole: 'superAdmin' }),
    anon: () => withoutAuth(),
    clear: clearFirestore,
    cleanup,
    assertSucceeds,
    assertFails,
  };
}
