---
name: firestore-collection
description: Scaffold a new Firestore collection with standardized artifacts across the aikami monorepo. Generates TypeBox schema, Firestore paths, types, backend repository, frontend repository, security rules, and tests.
---

# Firestore Collection Scaffolding Skill

Use this skill when adding a new Firestore collection to the aikami project. It ensures consistent, complete scaffolding across all layers of the stack.

## Prerequisites

- The collection name (e.g., `config`, `gameSave`, `leaderboardEntry`)
- Understanding of whether documents use auto-generated IDs or explicit IDs (like `uid`)
- The fields/data model for the collection

## Workflow

### 1. Create TypeBox Schema

**File**: `packages/schemas/src/lib/database/{collection}.ts`

Pattern:

```typescript
import { Type, type Static } from "@sinclair/typebox";
import {
  CoreCreateSchema,
  CoreOmitSchema,
  CoreSchema,
  CoreUpdateSchema,
} from "../core.ts";
import { getDeletableFields } from "../utils.ts";

export const {Collection}Schema = Type.Composite([
  CoreSchema,
  Type.Object({
    // Collection-specific fields
    uid: Type.Optional(Type.String({ description: "User ID" })),
    // ... more fields
  }),
]);

export const {Collection}CreateSchema = Type.Composite([
  Type.Omit({Collection}Schema, CoreOmitSchema),
  Type.Pick(CoreCreateSchema, Object.keys(CoreCreateSchema.properties)),
]);

export const {Collection}UpdateSchema = Type.Composite([
  Type.Omit({Collection}Schema, CoreOmitSchema),
  Type.Pick(CoreUpdateSchema, Object.keys(CoreUpdateSchema.properties)),
  getDeletableFields({Collection}Schema),
]);
```

**Rules**:

- Always compose with `CoreSchema` for `id`, `createdAt`, `updatedAt`
- Use `Type.Optional()` for optional fields
- Export `Schema`, `CreateSchema`, and `UpdateSchema`

### 2. Create Type Exports

**File**: `packages/types/src/lib/database/{collection}.ts`

Pattern:

```typescript
import type { Static } from "@sinclair/typebox";
import type {
  {Collection}CreateSchema,
  {Collection}Schema,
  {Collection}UpdateSchema,
} from '@aikami/schemas';

export type {Collection}Data = Static<typeof {Collection}Schema>;

export type {Collection}CreateData = Static<typeof {Collection}CreateSchema>;

export type {Collection}UpdateData = Static<typeof {Collection}UpdateSchema>;
```

### 3. Add Firestore Paths

**File**: `packages/utils/src/lib/database/firestore-paths.ts`

Append path functions. For flat collections with explicit IDs (like uid):

```typescript
export const get{Collection}sCollectionPath = (): string => '{collection}s';

export const get{Collection}DocumentPath = (options: { uid: string }): string =>
  `${get{Collection}sCollectionPath()}/${options.uid}`;
```

For collections with auto-generated IDs:

```typescript
export const get{Collection}sCollectionPath = (): string => '{collection}s';

export const get{Collection}DocumentPath = (options: { {collection}Id: string }): string =>
  `${get{Collection}sCollectionPath()}/${options.{collection}Id}`;
```

### 4. Create Backend Repository

**File**: `packages/backend/database/src/lib/{collection}.ts`

Pattern:

```typescript
import { {Collection}CreateSchema, {Collection}Schema, {Collection}UpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { get{Collection}DocumentPath, get{Collection}sCollectionPath } from '@aikami/utils';
import { BackendRepository, type BackendRepositoryInterface } from './base-backend-repository.ts';

export type {Collection}RepositoryType = RepositoryType<
  typeof {Collection}Schema,
  typeof {Collection}CreateSchema,
  typeof {Collection}UpdateSchema,
  undefined,  // or { uid: string } if collection path needs args
  { uid: string }
>;

export type {Collection}RepositoryInterface = BackendRepositoryInterface<{Collection}RepositoryType>;

export const {collection}Repository: {Collection}RepositoryInterface =
  new BackendRepository<{Collection}RepositoryType>({
    className: '{Collection}Repository',
    createSchema: {Collection}CreateSchema,
    updateSchema: {Collection}UpdateSchema,
    getCollectionPath: get{Collection}sCollectionPath,
    getDocumentPath: get{Collection}DocumentPath,
    schema: {Collection}Schema,
  });
```

### 5. Create Frontend Repository

**File**: `packages/frontend/repositories/src/lib/{collection}.ts`

Pattern:

```typescript
import { {Collection}CreateSchema, {Collection}Schema, {Collection}UpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { get{Collection}DocumentPath, get{Collection}sCollectionPath } from '@aikami/utils';
import {
  FrontendRepository,
  type FrontendRepositoryInterface,
} from './base-frontend-repository.ts';

export type {Collection}RepositoryType = RepositoryType<
  typeof {Collection}Schema,
  typeof {Collection}CreateSchema,
  typeof {Collection}UpdateSchema,
  undefined,  // or { uid: string } if collection path needs args
  { uid: string }
>;

export type {Collection}RepositoryInterface = FrontendRepositoryInterface<{Collection}RepositoryType>;

export const {collection}Repository: {Collection}RepositoryInterface =
  new FrontendRepository<{Collection}RepositoryType>({
    className: '{Collection}Repository',
    createSchema: {Collection}CreateSchema,
    getCollectionPath: get{Collection}sCollectionPath,
    getDocumentPath: get{Collection}DocumentPath,
    schema: {Collection}Schema,
    updateSchema: {Collection}UpdateSchema,
  });
```

### 6. Update Security Rules

**File**: `apps/backend/functions/src/rules/firestore.rules`

Add rules for the new collection. For user-owned documents (uid as doc ID):

```
match /{collection}s/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

For admin-only or more complex rules, consult the existing rules patterns.

### 7. Create Schema Tests

**File**: `packages/schemas/src/lib/database/{collection}.test.ts`

Pattern:

```typescript
import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  {Collection}CreateSchema,
  {Collection}Schema,
  {Collection}UpdateSchema,
} from "./{collection}.ts";

describe("{Collection}Schema", () => {
  const validData = {
    id: "test-123",
    // ... required fields
  };

  test("should validate valid data", () => {
    expect(Value.Check({Collection}Schema, validData)).toBe(true);
  });

  test("should reject invalid data", () => {
    expect(Value.Check({Collection}Schema, {})).toBe(false);
  });
});

describe("{Collection}CreateSchema", () => {
  test("should validate valid create data", () => {
    const result = Value.Check({Collection}CreateSchema, { /* ... */ });
    expect(result).toBe(true);
  });
});

describe("{Collection}UpdateSchema", () => {
  test("should validate valid update data", () => {
    const result = Value.Check({Collection}UpdateSchema, {
      updatedAt: { seconds: 1700000000, nanoseconds: 0 },
      // ... fields to update
    });
    expect(result).toBe(true);
  });
});
```

### 8. Update Index Files

Add exports to all relevant `index.ts` files:

- `packages/schemas/src/index.ts` — add `export * from './lib/database/{collection}.ts';`
- `packages/types/src/index.ts` — add `export * from './lib/database/{collection}.ts';`
- `packages/backend/database/src/index.ts` — add `export * from './lib/{collection}.ts';`
- `packages/frontend/repositories/src/index.ts` — add `export * from './lib/{collection}.ts';`

### 9. Verify

Run validation commands:

```bash
bun moon run schemas:typecheck
bun moon run types:typecheck
bun moon run utils:typecheck
bun moon run backend-database:typecheck
bun moon run frontend-repositories:typecheck
```

Or run affected validation:

```bash
bun run typecheck:affected
```

## Key Patterns

### Collection Naming

- Collection names are plural: `personas`, `chats`, `configs`
- Document path functions use singular: `getPersonaDocumentPath`, `getConfigDocumentPath`
- Variable names use camelCase: `personaRepository`, `configRepository`

### User-Owned Documents

When the document ID is the user's `uid`, the path argument is `{ uid: string }` and the collection path takes no arguments (`undefined`).

### Auto-ID Documents

When Firestorm generates the document ID, the path argument is `{ {collection}Id: string }` and the collection path takes no arguments.

### Subcollections

Avoid subcollections when possible. Prefer flat top-level collections with references. When subcollections are necessary, nest path functions:

```typescript
export const getMessagesCollectionPath = (options: {
	chatId: string;
}): string => `${getChatDocumentPath(options)}/messages`;
```

## Testing with Firestore Emulator

For integration testing with the Firestore emulator:

1. Start the emulator:

    ```bash
    bun moon run functions:emulate
    ```

2. Write tests using the `@firebase/rules-unit-testing` or direct Firestore client against `localhost:8080`.

3. Place rule tests in `apps/backend/rules/tests/{collection}.test.ts`.

4. Run tests:
    ```bash
    bun moon run functions:test
    ```

**Note**: The aikami project currently has minimal rules testing infrastructure. When adding a new collection, consider adding basic schema validation tests (step 7) as the minimum. Full emulator-based rules tests can be added when the testing infrastructure matures.
