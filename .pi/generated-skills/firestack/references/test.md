# `/firestack test rules`

Run Firestore and Storage security rule tests.

## When to Use

- User says "test rules", "run security tests", "test firestore rules"
- User invokes `/firestack test rules` or `/firestack test:rules`

## Workflow

### Step 1: Validate Test Configuration

Read `firestack.config.ts` or `firestack.json` and check for `rulesTests`:

```json
{
  "rulesTests": {
    "firestore": {
      "rulesFile": "src/rules/firestore.rules",
      "testPattern": "tests/rules/**/*.rules.test.ts",
      "projectId": "firestack-rules-test"
    }
  }
}
```

If `rulesTests` is missing, abort and suggest `/firestack setup testing`.

### Step 2: Check Test Files Exist

Verify that test files matching the `testPattern` exist. If not:
- For Firestore: Create `tests/rules/firestore.rules.test.ts`
- For Storage: Create `tests/storage-rules/storage.rules.test.ts`

Use the template below or `/firestack setup testing`.

### Step 3: Run Tests

```bash
# Run all rules tests
firestack test:rules --mode <mode>

# Run only firestore
firestack test:rules --mode <mode> --only firestore

# Watch mode
firestack test:rules --mode <mode> --watch

# Verbose output
firestack test:rules --mode <mode> --verbose
```

### Step 4: Parse Results

- **All pass** → Confirm success.
- **Failures** → Show the failing test names and assertions. Suggest checking:
  1. The `.rules` file logic.
  2. The test setup (seed data, auth context).
  3. The `rulesTests` config paths.

### Step 5: Fix and Re-run (if needed)

If tests fail, iterate:
1. Read the failing test file.
2. Read the corresponding `.rules` file.
3. Fix either the rules or the test.
4. Re-run `firestack test:rules`.

## Test Template

```typescript
import { beforeAll, beforeEach, describe, test } from 'bun:test';
import { assertFails, assertSucceeds, rulesTest } from '@snorreks/firestack/testing';

const hasEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeOrSkip = hasEmulator ? describe : describe.skip;

describeOrSkip('firestore.rules', () => {
  type Helpers = Awaited<ReturnType<typeof rulesTest.firestore>>;
  let helpers: Helpers;

  beforeAll(async () => {
    helpers = await rulesTest.firestore();
  });

  beforeEach(async () => {
    await helpers.clearFirestore();
  });

  test('unauthenticated cannot read secrets', async () => {
    const db = helpers.withoutAuth().firestore();
    await assertFails(db.collection('secrets').doc('x').get());
  });

  test('authenticated user can read own profile', async () => {
    const db = helpers.withAuth('user-123').firestore();
    await assertSucceeds(db.collection('users').doc('user-123').get());
  });
});
```

## Test Helpers API

`rulesTest.firestore()` and `rulesTest.storage()` return:

| Method | Description |
|---|---|
| `withAuth(uid)` | Returns a `RulesTestContext` authenticated as `uid`. |
| `withoutAuth()` | Returns an unauthenticated `RulesTestContext`. |
| `clearFirestore()` | Clears all Firestore data for the test project. |
| `clearStorage()` | Clears all Storage data for the test project. |
| `clearDatabase()` | Clears all Realtime Database data for the test project. |
| `cleanup()` | Cleans up the test environment and all contexts. |
| `env` | The raw `@firebase/rules-unit-testing` environment. |

## Common Patterns

### Ownership Rules

```typescript
test('author can update their own post', async () => {
  const db = helpers.withAuth('author-1').firestore();
  await db.collection('posts').doc('post-1').set({
    title: 'Original', authorId: 'author-1',
  });
  await assertSucceeds(
    db.collection('posts').doc('post-1').update({ title: 'Updated' })
  );
});

test('non-author cannot update a post', async () => {
  const authorDb = helpers.withAuth('author-1').firestore();
  await authorDb.collection('posts').doc('post-1').set({
    title: 'Original', authorId: 'author-1',
  });
  const otherDb = helpers.withAuth('hacker').firestore();
  await assertFails(
    otherDb.collection('posts').doc('post-1').update({ title: 'Hacked' })
  );
});
```

### Conditional Skip for CI

```typescript
const hasEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeOrSkip = hasEmulator ? describe : describe.skip;
```

### Storage Rules

```typescript
describe('storage.rules', () => {
  let helpers: Awaited<ReturnType<typeof rulesTest.storage>>;

  beforeAll(async () => { helpers = await rulesTest.storage(); });
  beforeEach(async () => { await helpers.clearStorage(); });

  test('unauthenticated cannot upload', async () => {
    const storage = helpers.withoutAuth().storage();
    const bucket = storage.bucket('demo-project.appspot.com');
    await assertFails(bucket.file('uploads/photo.jpg').save(Buffer.from('')));
  });
});
```

## Full Flag Reference

| Flag | Description |
|---|---|
| `--mode <mode>` | Mode context. |
| `--watch` | Watch test files for changes and re-run. |
| `--only <targets>` | Only specific targets (`firestore`, `storage`). |
| `--verbose` | Show detailed emulator output. |
