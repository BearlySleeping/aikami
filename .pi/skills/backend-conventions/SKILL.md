---
name: backend-conventions
description: >-
  Backend architecture patterns for Aikami — repository pattern, database
  abstraction, service layer, controller structure. For Cloud Function specifics
  (firestack, deployment) also load `firebase-functions`.
  Builds on `aikami-conventions` (foundational skill — loaded first).
version: 3.0.0
tags: ["backend", "database", "repository", "services"]
---

# Backend Conventions

Backend architecture patterns for the Aikami monorepo.
`aikami-conventions` is the foundational skill — it covers arrow functions,
type rules, import paths, `as const`, error handling, logging, and file
naming. For Cloud Function specifics, also load `firebase-functions`.

## 1. Architecture Layers

```
Controller (thin)
    │
    ▼
Service (business logic)
    │
    ▼
Repository (data access)
    │
    ▼
BaseDatabaseService (engine abstraction)
```

- **Controllers** — Thin handlers. Parse input, call service, return response.
- **Services** — Business logic. Stateless or singleton with dependency injection.
- **Repositories** — Data access. Depend on `BaseDatabaseService`, never on a
  specific SDK (Firestore, Data Connect, etc.).
- **BaseDatabaseService** — Vendor-agnostic database contract (`getDocument`,
  `getDocuments`, `addDocument`, `setDocument`, `updateDocument`, `deleteDocument`,
  `runQuery`).

## 2. Repository Pattern

Every repository accepts a `BaseDatabaseService` via constructor injection.
This makes repositories trivially testable with any engine implementation.

```typescript
// packages/backend/database/src/lib/user_repository.ts
import type { BaseDatabaseService, QueryOptions } from "./base_database_service.js";

export type UserDocument = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateUserInput = Omit<UserDocument, "id" | "createdAt" | "updatedAt">;

export class UserRepository {
  private readonly _collection = "users";

  constructor(private readonly _db: BaseDatabaseService) {
    if (!_db) {
      throw new Error("UserRepository requires a BaseDatabaseService instance.");
    }
  }

  async findById(id: string): Promise<UserDocument | undefined> {
    if (!id) {
      throw new Error("id is required.");
    }
    return this._db.getDocument<UserDocument>(this._collection, id);
  }

  async findAll(options?: QueryOptions): Promise<UserDocument[]> {
    return this._db.getDocuments<UserDocument>(this._collection, options);
  }

  async create(input: CreateUserInput): Promise<string> {
    if (!input?.email) {
      throw new Error("email is required.");
    }
    const now = new Date().toISOString();
    return this._db.addDocument<UserDocument>(this._collection, {
      ...input,
      createdAt: now,
      updatedAt: now,
    } as UserDocument);
  }

  async update(id: string, input: Partial<UserDocument>): Promise<void> {
    if (!id) {
      throw new Error("id is required.");
    }
    await this._db.updateDocument<UserDocument>(this._collection, id, {
      ...input,
      updatedAt: new Date().toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    if (!id) {
      throw new Error("id is required.");
    }
    await this._db.deleteDocument(this._collection, id);
  }

  async findByRole(role: string): Promise<UserDocument[]> {
    if (!role) {
      throw new Error("role is required.");
    }
    return this._db.getDocuments<UserDocument>(this._collection, {
      filters: [{ field: "role", operator: "==", value: role }],
    });
  }
}
```

### Rules

- **Constructor injection** — `constructor(private readonly _db: BaseDatabaseService)`
- **Regular methods** — `async findById(id) { ... }` (not arrow class fields)
- **Guard clauses first** — validate inputs before any work
- **Never import Firestore/Firebase SDK directly** — go through `BaseDatabaseService`
- **Collection name as private field** — `private readonly _collection = "users"`
- **Private members prefixed with `_`** — `_db`, `_collection`, `_normalizeEmail()` (see `aikami-conventions`)

## 3. Database Abstraction

The `BaseDatabaseService` is a vendor-agnostic interface defined in
`packages/backend/database/src/lib/base_database_service.ts`. All database
operations go through it — never call Firestore SDK methods directly.

```typescript
// ✅ CORRECT — through abstraction
const user = await this.db.getDocument<UserDocument>("users", id);

// ❌ WRONG — direct SDK call
import { getFirestore } from "firebase-admin/firestore";
const doc = await getFirestore().collection("users").doc(id).get();
```

This ensures:
- Tests can use an in-memory mock
- Switching database engines requires zero repository changes
- Business logic never accidentally depends on Firestore-specific features

## 4. Service Layer

Services contain business logic and depend on repositories (not on the
database directly):

```typescript
// packages/backend/services/src/lib/user_service.ts
import type { UserRepository } from "@aikami/backend/database";
import { toAppError } from "@aikami/utils";
import { logger } from "$logger";

export type UserServiceOptions = {
  userRepository: UserRepository;
};

export class UserService {
  private readonly _userRepository: UserRepository;

  constructor(options: UserServiceOptions) {
    this._userRepository = options.userRepository;
  }

  async getOrCreateUser(email: string, displayName: string) {
    logger.debug("getOrCreateUser", { email });

    const existing = await this._userRepository.findByEmail(email);
    if (existing) {
      return existing;
    }

    const id = await this._userRepository.create({ email, displayName, role: "user" });
    const created = await this._userRepository.findById(id);
    if (!created) {
      throw toAppError("internal", "Failed to create user");
    }

    return created;
  };
}
```

### Rules

- **Options object for constructor** — `{ userRepository: UserRepository }`
- **Depend on repositories, not on database** — services never import `BaseDatabaseService`
- **Business logic only** — no HTTP concerns, no Firestore SDK calls
- **Private members prefixed with `_`** — `_userRepository`, `_cache`, `_normalizeEmail()`

## 5. Controller Structure

Controllers are thin — parse input, call service, return response. One function
per file, exported as default.

### Callable Controller

```typescript
// apps/backend/firebase/src/controllers/callable/generate_image.ts
import type { CallableFunctions } from "@aikami/types";
import { onCall } from "@snorreks/firestack";
import { logger } from "$logger";

export default onCall<CallableFunctions, "generateImage">(
  async (request) => {
    const { prompt, npcId } = request.data;
    logger.debug("generateImage", { npcId, promptLength: prompt.length });

    // Call service, not raw business logic
    const result = await imageService.generate({ prompt, npcId });

    return { imageUrl: result.url };
  },
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
);
```

### Firestore Trigger Controller

```typescript
// apps/backend/firebase/src/controllers/firestore/users/[uid]/created.ts
import type { UserData } from "@aikami/types";
import { onCreated } from "@snorreks/firestack";
import { logger } from "$logger";

export default onCreated<UserData>(({ data }) => {
  logger.debug("user created", { email: data.email });
});
```

### Rules

- **One `export default` per file**
- **Thin handlers** — parse input, delegate to service, return response
- **No business logic in controllers** — that lives in services
- **Validated wrappers preferred** — use `onCall`, `onCreated` etc.
  (see `firebase-functions` skill for details)

## 6. Creating New Endpoints (Callable / Request)

When adding a new Cloud Function endpoint, first check whether the new logic can
live inside an **existing** backend package and endpoint. If the feature shares
dependencies and domain logic with an existing endpoint, bundle them together —
this saves cold starts and keeps the surface area small. If the feature has
heavy dependencies or logic that is completely unrelated to any existing
endpoint, create a new one.

### Decision Flow

```
New feature needed
   │
   ├─ Same domain + deps as existing \[backend/ai, backend/auth, backend/chat]?
   │     → Add new event to that package's ChatApiEvents / AIApiEvents / etc.
   │     → Add new handler in that package's api_handler.ts
   │
   └─ New domain OR unique heavy dependencies?
         → Create new packages/backend/<name>/ package
         → Create new endpoint entry in CallableFunctions or RequestFunctions
         → Register in .moon/workspace.yml
```

### Callable Endpoint Workflow

1. **Create endpoint types** in `packages/shared/types/src/lib/endpoints/<name>.ts`:

   ```typescript
   // packages/shared/types/src/lib/endpoints/chat.ts
   export type ChatApiEvents = {
     myNewAction: [
       { input: string },
       { output: string },
     ];
   };

   export type ChatMessageType = keyof ChatApiEvents;
   export type ChatMessageData<T extends ChatMessageType = ChatMessageType> = {
     payload: ChatMessagePayload<T>;
     type: T;
   };
   export type ChatMessagePayload<T extends ChatMessageType = ChatMessageType> = ChatApiEvents[T][0];
   export type ChatMessageResponse<T extends ChatMessageType = ChatMessageType> = ChatApiEvents[T][1];
   ```

2. **Register in `callable_functions.ts`**:

   ```typescript
   // packages/shared/types/src/lib/endpoints/callable_functions.ts
   import type { ChatMessageData, ChatMessageResponse } from './chat.ts';

   export type CallableFunctions = {
     chat: [ChatMessageData, ChatMessageResponse];
   };
   ```

   🔴 The key name (`chat`, `auth`, `ai`) **must match the file name** of the
   controller in `apps/backend/firebase/src/controllers/callable/<name>.ts`.
   snake_case only.

3. **Create the backend package** at `packages/backend/<name>/`:\
   Follow the pattern in `packages/backend/chat/` or `packages/backend/auth/`:

   - `moon.yml` — project config, depends on types, utils, logger, etc.
   - `package.json` — `"name": "@aikami/backend-<name>"`, workspace deps
   - `tsconfig.json` — extends `tsconfig.backend.json`, `rootDir: "../../.."`,
     paths for all workspace deps
   - `src/index.ts` — exports `handle<Name>Endpoint`
   - `src/lib/api_handler.ts` — handlers using `createApiHandler` pattern

   Register in `.moon/workspace.yml`:

   ```yaml
   backend-<name>: "packages/backend/<name>"
   ```

   Add to `apps/backend/firebase/moon.yml` dependsOn:

   ```yaml
   dependsOn:
     - 'backend-<name>'
   ```

4. **Create the controller** at `apps/backend/firebase/src/controllers/callable/<name>.ts`:

   ```typescript
   // apps/backend/firebase/src/controllers/callable/chat.ts
   import { handleChatEndpoint } from '@aikami/backend/chat';
   import type { CallableFunctions } from '@aikami/types';
   import { toAppError } from '@aikami/utils';
   import { onCall } from '@snorreks/firestack';
   import { logger } from '$logger';

   export default onCall<CallableFunctions, 'chat'>(
     async (request) => {
       const data = request.data;
       if (!data || typeof data.type !== 'string') {
         logger.warn('callable/chat: invalid request — missing type');
         throw toAppError({
           errorType: 'invalid-argument',
           errorMessage: 'Missing or invalid type field',
         });
       }

       logger.debug('callable/chat', { type: data.type });

       return await handleChatEndpoint({
         payload: data.payload,
         type: data.type,
       });
     },
     { region: 'europe-west1', memory: '256MiB', timeoutSeconds: 120 },
   );
   ```

### Request Endpoint (HTTP) Workflow

Same pattern but uses `RequestFunctions` and `onRequest` instead:

- Types: `packages/shared/types/src/lib/endpoints/request_functions.ts`
- Controllers: `apps/backend/firebase/src/controllers/api/<name>.ts`
- Use clean destructuring from request body:

  ```typescript
  export default onRequest<RequestFunctions, 'ai'>(
    async (request, response) => {
      try {
        const { body } = request;
        const { type, payload } = body;
        logger.debug('api/prompt_ai', { type });
        const result = await handleAIEndpoint({ payload, type });
        response.send(result);
      } catch (error) {
        logger.error('api/prompt_ai: error', error);
        const res = response as { status: (code: number) => { send: (body: unknown) => void } };
        res.status(500).send({ error: String(error) });
      }
    },
    { region: 'europe-west1' },
  );
  ```

## 7. Error Handling & Logging

See `aikami-conventions` for error handling (`toAppError`) and logging
(`$logger` alias). In Cloud Functions, the logger is auto-imported via
`includeFilePath` in `firestack.config.ts`.

## 8. Testing

Backend packages and functions use `bun:test`:

```typescript
// packages/backend/database/tests/user_repository.test.ts
import { describe, expect, test, beforeEach } from "bun:test";
import { UserRepository } from "../src/index.js";

describe("UserRepository", () => {
  let repo: UserRepository;

  beforeEach(() => {
    repo = new UserRepository(mockDatabaseService);
  });

  test("findById returns user when found", async () => {
    const user = await repo.findById("test-id");
    expect(user?.email).toBe("test@example.com");
  });
});
```

### Rules

- Tests go in `tests/` at project root (not `src/__tests__/`)
- Use `bun:test` for all unit/integration tests
- Mock `BaseDatabaseService` — never mock Firestore SDK directly
- Test files: `*.test.ts`

## 9. Related Skills

| Skill | Covers |
|-------|--------|
| `aikami-conventions` | Foundational TS rules, logging, error handling, file naming |
| `firebase-functions` | Cloud Function specifics: firestack.config.ts, deployment, triggers |
| `firestack` | CLI reference: deploy, emulate, test rules |
| `firestore-collection` | Scaffolding new Firestore collections |
