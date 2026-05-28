# `/firestack setup <target>`

Initialize or update Firestack project infrastructure.

## When to Use

- User says "set up firestack", "initialize firestack", "create firestack.json"
- User invokes `/firestack setup config`, `/firestack setup testing`, or `/firestack setup emulate`

---

## `setup config`

Create or update `firestack.config.ts` (or `firestack.json`) in the project root.

### Workflow

1. Check if `firestack.config.ts` or `firestack.json` already exists. If it does, read it and ask if the user wants to update it.
2. Ask the user for:
   - Firebase project IDs for each mode (e.g., `development`, `production`)
   - Default region (suggest `us-central1`)
   - Functions directory (suggest `src/controllers`)
   - Rules directory (suggest `src/rules`)
   - Scripts directory (suggest `scripts`)
   - Node version (suggest `22`)
   - Engine (suggest `bun`)
3. Recommend `firestack.config.ts` for dynamic config with tsconfig path alias support:

```ts
// firestack.config.ts
import { defineConfig } from "@snorreks/firestack";

export default defineConfig({
  modes: {
    development: "<dev-project-id>",
    production: "<prod-project-id>",
  },
  region: "us-central1",
  functionsDirectory: "src/controllers",
  rulesDirectory: "src/rules",
  scriptsDirectory: "scripts",
  nodeVersion: "22",
  engine: "bun",
  packageManager: "global",
  minify: true,
  sourcemap: true,
  emulators: ["auth", "firestore", "functions", "pubsub", "storage"],
});
```

Or if they prefer JSON:

```json
{
  "$schema": "./node_modules/@snorreks/firestack/firestack.schema.json",
  "modes": {
    "development": "<dev-project-id>",
    "production": "<prod-project-id>"
  },
  "region": "us-central1",
  "functionsDirectory": "src/controllers",
  "rulesDirectory": "src/rules",
  "scriptsDirectory": "scripts",
  "nodeVersion": "22",
  "engine": "bun",
  "packageManager": "global",
  "minify": true,
  "sourcemap": true,
  "emulators": ["auth", "firestore", "functions", "pubsub", "storage"]
}
```

4. Ensure `@snorreks/firestack` is in `package.json` dependencies. If not, suggest installing it.
5. Create the directory structure if it doesn't exist:
   ```
   src/controllers/
   src/rules/
   scripts/
   ```

---

## `setup testing`

Initialize the rules testing infrastructure.

### Workflow

1. Read the firestack config file. Add `rulesTests` if missing:

```json
{
  "rulesTests": {
    "firestore": {
      "rulesFile": "src/rules/firestore.rules",
      "testPattern": "tests/rules/**/*.rules.test.ts",
      "projectId": "firestack-rules-test"
    },
    "storage": {
      "rulesFile": "src/rules/storage.rules",
      "testPattern": "tests/storage-rules/**/*.rules.test.ts",
      "projectId": "firestack-rules-test"
    }
  }
}
```

2. Create `tests/rules/firestore.rules.test.ts`:

```typescript
import { beforeAll, beforeEach, describe, test } from "bun:test";
import {
  assertFails,
  assertSucceeds,
  rulesTest,
} from "@snorreks/firestack/testing";

const hasEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeOrSkip = hasEmulator ? describe : describe.skip;

describeOrSkip("firestore.rules", () => {
  type Helpers = Awaited<ReturnType<typeof rulesTest.firestore>>;
  let helpers: Helpers;

  beforeAll(async () => {
    helpers = await rulesTest.firestore();
  });

  beforeEach(async () => {
    await helpers.clearFirestore();
  });

  test("unauthenticated cannot read secrets", async () => {
    const db = helpers.withoutAuth().firestore();
    await assertFails(db.collection("secrets").doc("x").get());
  });

  test("authenticated user can read own profile", async () => {
    const db = helpers.withAuth("user-123").firestore();
    await assertSucceeds(db.collection("users").doc("user-123").get());
  });
});
```

3. Create `src/rules/firestore.rules` if missing:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Install `@firebase/rules-unit-testing` if not present:

   ```bash
   bun add -d @firebase/rules-unit-testing
   ```

5. Confirm setup and suggest running `/firestack test rules`.

---

## `setup emulate`

Create the `scripts/on_emulate.ts` emulator seed script.

### Workflow

1. Read the firestack config to confirm `scriptsDirectory` and `initScript`.
2. Check if the file already exists. If so, ask before overwriting.
3. Write `scripts/on_emulate.ts`:

```typescript
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  throw new Error("FIREBASE_PROJECT_ID environment variable not set");
}

const mode = process.env.FIREBASE_MODE;
console.log(
  `Initializing emulator (Project: ${projectId}, Mode: ${mode})...`,
);

const app = initializeApp({
  projectId,
  storageBucket: `${projectId}.firebasestorage.app`,
});

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// 1. Seed Auth users
console.log("Creating sample users...");
try {
  await auth.createUser({
    uid: "user1",
    email: "john@example.com",
    password: "password123",
    displayName: "John Doe",
  });
} catch (error) {
  const e = error as { code?: string };
  if (e.code !== "auth/uid-already-exists") {
    console.error("Error creating user:", error);
  }
}

// 2. Seed Firestore
console.log("Seeding Firestore...");
await db.collection("users").doc("user1").set({
  name: "John Doe",
  email: "john@example.com",
  createdAt: new Date(),
});

// 3. Seed Storage (optional)
// const bucket = storage.bucket();
// await bucket.file('assets/sample.txt').save('Hello', { metadata: { contentType: 'text/plain' } });

console.log("Emulator initialization complete.");
```

4. Confirm creation and tell the user it will run automatically on `firestack emulate`.

---

## Custom Scripts

Any `.ts` file in `scriptsDirectory` can be executed via `firestack scripts [name]`.

### Environment Variables

| Variable              | Description                                     |
| --------------------- | ----------------------------------------------- |
| `FIREBASE_PROJECT_ID` | The Firebase project ID for the current mode.   |
| `FIREBASE_MODE`       | The active mode name.                           |

### Example: Maintenance Script

```typescript
// scripts/cleanup_old_sessions.ts
import { getFirestore } from "$configs/database";

const db = getFirestore();
const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const snapshot = await db
  .collection("sessions")
  .where("lastActive", "<", cutoff)
  .get();

const batch = db.batch();
snapshot.docs.forEach((doc) => batch.delete(doc.ref));
await batch.commit();

console.log(`Cleaned up ${snapshot.size} old sessions.`);
```

Run it:

```bash
firestack scripts cleanup_old_sessions --mode development
```
