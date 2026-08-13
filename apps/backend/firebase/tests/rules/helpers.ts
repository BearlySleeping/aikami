// apps/backend/firebase/tests/rules/helpers.ts
// biome-ignore-all lint/style/noNonNullAssertion: regex capture parsing in the seed path builder

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
  /** Seeds a document bypassing rules (admin SDK equivalent). */
  seed: (options: { path: string[]; data: Record<string, unknown> }) => Promise<void>;
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
    seed: async ({ path, data }) => {
      // `path` is an alternating collection/doc segment list, e.g.
      // ['chats', 'chat-1'] or ['users', 'u1', 'notifications', 'n1'].
      await env.withSecurityRulesDisabled(async (ctx) => {
        let ref = ctx.firestore() as unknown as {
          collection(name: string): unknown;
          doc(id: string): unknown;
        };
        for (let i = 0; i < path.length; i += 2) {
          const collection = path[i]!;
          const doc = path[i + 1];
          if (doc === undefined) {
            throw new Error(`seed: path must be alternating collection/doc: ${path.join('/')}`);
          }
          ref = (ref.collection(collection) as unknown as {
            doc(id: string): unknown;
          }).doc(doc) as unknown as typeof ref;
        }
        await (ref as unknown as { set(data: Record<string, unknown>): Promise<void> }).set(data);
      });
    },
  };
}
