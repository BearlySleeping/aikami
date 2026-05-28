# Cloud Functions Triggers

Firestack supports all standard Firebase v2 triggers. Every trigger is imported from `@snorreks/firestack` and exported as `default` from its file.

## HTTP Triggers

### `onRequest`

Standard HTTP endpoint. Firestack catches unhandled errors and returns structured JSON with the correct status code.

```typescript
import { onRequest } from '@snorreks/firestack';

export default onRequest(
  (request, response) => {
    response.send({ message: 'Hello from Firestack!' });
  },
  {
    region: 'us-central1',
    memory: '256MiB',
  }
);
```

Type-safe variant with typed request/response bodies and path params:

```typescript
import { onRequest } from '@snorreks/firestack';
import type { RequestFunctions } from './types';

export default onRequest<RequestFunctions, 'getUser', { id: string }>(
  (request, response) => {
    const userId = request.params.id;
    response.send({ id: userId, name: 'Alice' });
  },
  { region: 'europe-west1' }
);
```

### `onRequestZod`

HTTP endpoint with automatic Zod body validation.

```typescript
import { onRequestZod } from '@snorreks/firestack';
import { z } from 'zod';

const BodySchema = z.object({
  email: z.string().email(),
  message: z.string().min(1),
});

export default onRequestZod(
  BodySchema,
  (request, response) => {
    // request.body is now typed and validated
    response.send({ received: request.body.email });
  },
  {
    validationStrategy: 'warn', // 'warn' | 'error' | 'ignore'
    onValidationError: (error) => {
      // custom reporting, e.g., Sentry
    },
  }
);
```

## Callable Triggers

### `onCall`

Firebase SDK callable function. Errors are automatically converted to `HttpsError`.

```typescript
import { onCall } from '@snorreks/firestack';
import type { CallableFunctions } from './types';

export default onCall<CallableFunctions, 'test_callable'>(
  ({ data, auth }) => {
    console.log(`message ${data.message} from ${auth?.uid}`);
    return { success: true };
  }
);
```

### `onCallZod`

Callable function with Zod validation.

```typescript
import { onCallZod } from '@snorreks/firestack';
import { z } from 'zod';

const DataSchema = z.object({ prompt: z.string() });

export default onCallZod(
  DataSchema,
  ({ data, auth }) => {
    return { result: `You said: ${data.prompt}` };
  }
);
```

## Firestore Triggers

All Firestore triggers auto-derive the document path from the file location. Place files under `firestore/<path>/<event>.ts`.

### Typed Helpers (`onCreated`, `onUpdated`, `onDeleted`, `onWritten`)

Use these when you want typed document data with an automatic `id` field injected.

```typescript
import { onCreated } from '@snorreks/firestack';
import type { UserData } from './types';

export default onCreated<UserData>(({ data }) => {
  // data is typed as UserData & { id: string }
  console.log(`User ${data.id} created with email ${data.email}`);
});
```

```typescript
import { onUpdated } from '@snorreks/firestack';
import type { UserData } from './types';

export default onUpdated<UserData>(({ data }) => {
  const before = data.before;
  const after = data.after;
  console.log(`${before.email} changed to ${after.email}`);
});
```

```typescript
import { onDeleted } from '@snorreks/firestack';
import type { UserData } from './types';

export default onDeleted<UserData>(({ data }) => {
  console.log(`User ${data.email} deleted`);
});
```

```typescript
import { onWritten } from '@snorreks/firestack';
import type { UserData } from './types';

export default onWritten<UserData>(({ data }) => {
  if (data.before) console.log('Was:', data.before.email);
  if (data.after) console.log('Now:', data.after.email);
});
```

### Zod-Validated Helpers (`onCreatedZod`, `onUpdatedZod`, `onDeletedZod`, `onWrittenZod`)

Same as typed helpers but with runtime Zod schema validation.

```typescript
import { onCreatedZod } from '@snorreks/firestack';
import { z } from 'zod';

const UserSchema = z.object({
  email: z.string().email(),
  name: z.string(),
});

export default onCreatedZod(
  UserSchema,
  ({ data }) => {
    console.log(`Valid user ${data.email} created`);
  },
  {
    validationStrategy: 'warn', // 'warn' | 'error' | 'ignore'
  }
);
```

## Auth Triggers

Place auth triggers in `auth/<event>.ts`.

### `onAuthCreate`

```typescript
import { onAuthCreate } from '@snorreks/firestack';

export default onAuthCreate(
  async (user, context) => {
    console.log('User created', {
      uid: user.uid,
      email: user.email,
      createdAt: context.timestamp,
    });
    return { success: true };
  },
  {
    timeoutSeconds: 30,
    functionName: 'auth_created_renamed',
    nodeVersion: '20',
    assets: ['src/assets/image.avif'],
    external: ['is-thirteen'],
  }
);
```

### `onAuthDelete`

```typescript
import { onAuthDelete } from '@snorreks/firestack';

export default onAuthDelete(
  async (user, context) => {
    console.log('User deleted', { uid: user.uid });
    return { success: true };
  }
);
```

### Blocking Triggers

```typescript
import { beforeAuthCreate } from '@snorreks/firestack';

export default beforeAuthCreate((user, context) => {
  if (!user.email?.endsWith('@company.com')) {
    throw new Error('Unauthorized domain');
  }
});
```

```typescript
import { beforeAuthSignIn } from '@snorreks/firestack';

export default beforeAuthSignIn((user, context) => {
  // Enforce custom claims or MFA before sign-in completes
});
```

## Storage Triggers

Place storage triggers in `storage/<event>.ts`.

```typescript
import { onObjectFinalized } from '@snorreks/firestack';

// Also available: onObjectDeleted, onObjectArchived, onObjectMetadataUpdated
export default onObjectFinalized(({ data }) => {
  console.log(`Object finalized: ${data.name} (${data.contentType})`);
});
```

## Scheduler Triggers

Place scheduled functions in `scheduler/<name>.ts`.

```typescript
import { onSchedule } from '@snorreks/firestack';

export default onSchedule(
  (context) => {
    console.log('Daily cleanup job started', context);
  },
  {
    schedule: 'every day 00:00',
    timeoutSeconds: 540,
    memory: '1GiB',
  }
);
```

Schedule formats follow the App Engine cron syntax (e.g., `every 5 minutes`, `0 0 * * *`).

## Realtime Database Triggers

Place RTDB triggers in `database/<path>/<event>.ts`.

```typescript
import { onValueCreated } from '@snorreks/firestack';

// Also available: onValueUpdated, onValueDeleted, onValueWritten
export default onValueCreated(
  (event) => {
    console.log('New data:', event.data.val());
  },
  { ref: 'messages/{messageId}' }
);
```

## Request Context & Logging

All Firestack trigger wrappers run inside an `AsyncLocalStorage` context. This means you can access and enrich invocation metadata from anywhere in the call stack without manual wrapping.

### `getLogContext()` / `setLogContext()`

```typescript
import { onRequest, getLogContext, setLogContext } from '@snorreks/firestack';

export default onRequest((request, response) => {
  // Enrich context after auth validation
  setLogContext({ userId: request.body.userId, companyId: request.body.companyId });

  // Context is now available to any helper/logger deeper in the stack
  const ctx = getLogContext();
  console.log(ctx); // { source: 'functions', trigger: 'https.onRequest', requestId: '...', userId: '...', companyId: '...' }

  response.send({ ok: true });
});
```

**Auto-populated fields:**
- `source` — always `'functions'`
- `trigger` — e.g. `'https.onRequest'`, `'firestore'`, `'auth.onCreate'`
- `requestId` — unique per invocation (from Firebase event ID or `crypto.randomUUID()`)
- `ip`, `route`, `method`, `userAgent` — for HTTP triggers
- `userId` — for callable functions (from `auth.uid`)

### Auto-Importing a Logger File

Create `src/logger.ts` (or any path configured via `includeFilePath` in `firestack.json`). If the file exists, Firestack imports it automatically into every generated function index before any handler code runs.

```typescript
// src/logger.ts
import { getLogContext } from '@snorreks/firestack';
import { getFirestore } from './configs/database.ts';

const pendingEntries: LogEntry[] = [];

export const logger = {
  info: (message: string, ...data: unknown[]) => {
    const context = getLogContext();
    pendingEntries.push({ timestamp: new Date(), level: 'info', message, data, context });
    console.log(message, ...data);
  },
  flush: async () => {
    if (pendingEntries.length === 0) return;
    const firestore = getFirestore();
    await Promise.all(pendingEntries.map((e) => firestore.collection('function_logs').add(e)));
    pendingEntries.length = 0;
  },
};

// Container-level safety net (not a replacement for per-invocation flush)
process.on('SIGTERM', async () => {
  await logger.flush();
});
```

Then in any handler, import and use it directly:

```typescript
import { onRequest, setLogContext } from '@snorreks/firestack';
import { logger } from './src/logger.ts'; // or via a path alias

export default onRequest(async (request, response) => {
  setLogContext({ companyId: request.body.companyId });
  logger.info('Processing request', { companyId: request.body.companyId });
  await logger.flush();
  response.send({ ok: true });
});
```

### `FIRESTACK_FUNCTION_NAME`

Firestack injects the deployed function name as an environment variable. Useful for tagging in your logger:

```typescript
const functionName = process.env.FIRESTACK_FUNCTION_NAME;
if (functionName) {
  setTag('function', functionName);
}
```

## Quick Reference Table

| Category | Triggers | Directory |
|---|---|---|
| HTTP | `onRequest`, `onRequestZod` | `api/` |
| Callable | `onCall`, `onCallZod` | `callable/` |
| Firestore | `onDocumentCreated`, `onDocumentDeleted`, `onDocumentUpdated`, `onDocumentWritten`, `onCreated`, `onDeleted`, `onUpdated`, `onWritten`, `onCreatedZod`, `onDeletedZod`, `onUpdatedZod`, `onWrittenZod` | `firestore/` |
| Auth | `onAuthCreate`, `onAuthDelete`, `beforeAuthCreate`, `beforeAuthSignIn` | `auth/` |
| Storage | `onObjectFinalized`, `onObjectDeleted`, `onObjectArchived`, `onObjectMetadataUpdated` | `storage/` |
| Scheduler | `onSchedule` | `scheduler/` |
| RTDB | `onValueCreated`, `onValueUpdated`, `onValueDeleted`, `onValueWritten` | `database/` |
