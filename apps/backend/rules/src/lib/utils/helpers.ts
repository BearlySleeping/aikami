import type { CoreData } from "@aikami/types";

import { mockData } from "$mocks";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

import type { MockAuth } from "../types/index.ts";

let testEnvironment: RulesTestEnvironment | undefined;

export const setup = async ({
  auth,
  data = mockData,
}: {
  auth?: MockAuth;
  data?: Record<string, Omit<CoreData, "createdAt">>;
} = {}) => {
  const projectId = `rules-spec-${Date.now()}`;

  if (testEnvironment) {
    await testEnvironment.clearFirestore();
  } else {
    testEnvironment = await initializeTestEnvironment({
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: readFileSync(
          resolve(__dirname, "../../../firestore.rules"),
          "utf8",
        ),
      },

      projectId,
    });
  }

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [path, document] of Object.entries(data)) {
      const reference = database.doc(path);
      await reference.set(document);
    }
  });

  const context = auth
    ? testEnvironment.authenticatedContext(auth.uid, auth.token)
    : testEnvironment.unauthenticatedContext();

  return context.firestore();
};

export const teardown = async () => {
  if (testEnvironment) {
    await testEnvironment.cleanup();
    testEnvironment = undefined;
  }
};
expect.extend({
  async toAllow(x: Promise<unknown>) {
    let pass = false;
    try {
      await assertSucceeds(x);
      pass = true;
    } catch {
      // ignore
    }

    return {
      message: () =>
        "Expected Firebase operation to be allowed, but it was denied",
      pass,
    };
  },
});

expect.extend({
  async toDeny(x: Promise<unknown>) {
    let pass = false;
    try {
      await assertFails(x);
      pass = true;
    } catch {
      // ignore
    }
    return {
      message: () =>
        "Expected Firebase operation to be denied, but it was allowed",
      pass,
    };
  },
});
