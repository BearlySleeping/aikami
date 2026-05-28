---
name: firebase-functions
description: Best practices for Aikami Firebase Cloud Functions — firestack v2, Zod validation helpers (onRequestZod, onCallZod, onCreatedZod), firestack.config.ts, typed generics, schema-driven patterns.
version: 3.0.0
tags: ["firebase", "cloud-functions", "firestack", "zod", "typescript"]
---

# Aikami — Cloud Functions

Firebase Cloud Functions v2 using **Firestack** (`@snorreks/firestack`). Functions auto-discovered from `apps/backend/functions/src/controllers/` by file path. One function per file, exported as default.

---

## 1. Configuration — firestack.config.ts

Configuration lives in `apps/backend/functions/firestack.config.ts`. **There is no global index.ts or setGlobalOptions.** Firestack handles region, mode, memory, etc. per-function or globally.

```ts
// apps/backend/functions/firestack.config.ts
import { defineConfig } from '@snorreks/firestack';
import {
  CLOUD_FUNCTIONS_REGION,
  MODE_PROJECT_MAP,
} from '../../../packages/shared/constants/src/index.ts';

export default defineConfig(() => ({
  modes: {
    development: MODE_PROJECT_MAP.development,
    production: MODE_PROJECT_MAP.production,
    emulator: MODE_PROJECT_MAP.emulator,
  },
  region: CLOUD_FUNCTIONS_REGION,          // europe-west3
  nodeVersion: '24',
  engine: 'bun' as const,
  minify: true,
  sourcemap: true,
  cloudCacheFileName: 'functions_cache.ts',  // Remote deploy cache
  includeFilePath: 'src/logger.ts',          // Auto-imported into every function
}));
```

---

## 2. Directory Structure

```
apps/backend/functions/
├── src/
│   ├── controllers/
│   │   ├── api/              # HTTP onRequest
│   │   │   └── webhooks/
│   │   ├── callable/         # Callable (onCall)
│   │   ├── scheduler/        # Scheduled (onSchedule)
│   │   ├── firestore/        # Firestore triggers
│   │   │   └── agent_checkpoints/
│   │   │       └── [checkpointId]/
│   │   │           └── created.ts
│   │   └── auth/             # Auth triggers
│   ├── lib/                  # Shared business logic
│   ├── logger.ts             # Logger init (auto-imported via includeFilePath)
│   └── rules/                # Security rules & indexes
├── firestack.config.ts       # ← Config HERE (no global index.ts)
├── functions_cache.ts        # Remote deploy cache
└── package.json
```

**All file names must be snake_case.** Enforced by Biome.

---

## 3. Function Patterns — Zod First

**ALWAYS use Zod-validated wrappers:**
- `onRequestZod` for HTTP endpoints
- `onCallZod` for callable functions
- `onCreatedZod`, `onDeletedZod`, `onUpdatedZod` for Firestore triggers
- `onWrittenZod` for combined write triggers

These validate input at the edge and provide type-safe handlers. If a Zod schema exists in `@aikami/schemas`, use it.

---

### HTTP Function (onRequestZod)

```ts
// apps/backend/functions/src/controllers/api/webhooks/telegram.ts
import { onRequestZod } from '@snorreks/firestack';
import { z } from 'zod';
import { logger } from '$logger';

const telegramUpdateSchema = z.object({
  update_id: z.number().optional(),
  message: z.object({
    message_id: z.number(),
    from: z.object({
      id: z.number(),
      username: z.string().optional(),
      first_name: z.string().optional(),
    }).optional(),
    chat: z.object({
      id: z.number(),
      type: z.string(),
    }),
    text: z.string().optional(),
    date: z.number(),
  }).optional(),
});

export default onRequestZod(telegramUpdateSchema, async (request, response) => {
  // request.body is now typed as z.infer<typeof telegramUpdateSchema>
  const { message } = request.body;

  if (!message) {
    logger.debug('telegram_webhook: no message in update');
    response.status(200).send('ok');
    return;
  }

  logger.info('telegram_webhook: received', {
    chatId: message.chat.id,
    text: message.text,
  });

  response.status(200).send('ok');
});
```

---

### Callable Function (onCallZod)

```ts
// apps/backend/functions/src/controllers/callable/process_email_triage.ts
import { onCallZod } from '@snorreks/firestack';
import { z } from 'zod';
import { logger } from '$logger';

const triageInputSchema = z.object({
  emailText: z.string().min(1).max(10_000),
  departmentId: z.string().optional(),
});

export default onCallZod(triageInputSchema, async (request) => {
  // request.data is typed: { emailText: string; departmentId?: string }
  if (!request.auth) throw new Error('unauthenticated');

  const result = await processEmailTriage(request.data);
  return result;
});
```

---

### Firestore Trigger (onCreatedZod)

```ts
// apps/backend/functions/src/controllers/firestore/agent_checkpoints/[checkpointId]/created.ts
import { onCreatedZod } from '@snorreks/firestack';
import { AgentCheckpointSchema } from '@aikami/schemas';
import { logger } from '$logger';

export default onCreatedZod(AgentCheckpointSchema, async ({ data, params }) => {
  // data is typed: z.infer<typeof AgentCheckpointSchema>
  const checkpointId = params.checkpointId;

  if (data.status !== 'pending') return;

  logger.log('agent_checkpoint created', { checkpointId, companyId: data.companyId });

  // ... business logic
});
```

---

### Firestore Trigger (onUpdatedZod)

```ts
import { onUpdatedZod } from '@snorreks/firestack';
import { UserSchema } from '@aikami/schemas';

export default onUpdatedZod(UserSchema, async ({ data, params }) => {
  // data.before and data.after are both typed
  if (data.before.role !== data.after.role) {
    logger.log('User role changed', {
      uid: params.uid,
      from: data.before.role,
      to: data.after.role,
    });
  }
});
```

---

### Scheduled Function

```ts
import { onSchedule } from '@snorreks/firestack';
import { logger } from '$logger';

export default onSchedule(
  async (_context) => {
    logger.log('Scheduled job running');
    // ... work
    return { status: 'completed' };
  },
  {
    schedule: 'every 5 minutes',
    region: 'europe-west3',
    memory: '256MiB',
    timeoutSeconds: 300,
  },
);
```

---

## 4. Typed Generics

Firestack wrappers support typed generics for full type-safety:

```ts
// onRequest with typed body/params/response
import type { RequestFunctions } from '@shared/types';
import { onRequest } from '@snorreks/firestack';

export default onRequest<RequestFunctions, 'myFunction', { id: string }>(
  async (request, response) => {
    // request.body: MyRequestBody
    // request.params: { id: string }
    // response.send() expects MyResponseBody
  },
  { region: 'europe-west3' }
);

// onCall with typed data/response
import type { CallableFunctions } from '@shared/types';
import { onCall } from '@snorreks/firestack';

export default onCall<CallableFunctions, 'myCallable'>(
  async (request) => {
    // request.data: MyCallableInput
    // return: MyCallableOutput
  }
);
```

Use these types from `packages/shared/types/src/lib/api/` — they serve as the canonical interface between frontend and backend.

---

## 5. Per-Function Options

Options are passed as the second argument to the wrapper:

```ts
export default onRequest(myHandler, {
  region: 'europe-west3',       // Override global region
  memory: '512MiB',             // Override memory
  timeoutSeconds: 120,          // Max 540
  functionName: 'custom_name',  // Override auto-derived name
  external: ['sharp'],          // Keep dep external (installed at deploy time)
});
```

---

## 6. Deployment

```bash
# Deploy all functions
bun moon run functions:deploy

# Deploy to development
bun moon run functions:deploy -- development

# Deploy single function
bun moon run functions:deploy -- development --only pollGmail

# Start emulator
bun moon run functions:emulate

# View logs
bun moon run functions:logs
bun moon run functions:logs:tail
```

Via AI tools:
```
firebase_deploy_functions mode=development
firebase_deploy_functions mode=development only=pollGmail,sendNotification
```

---

## 7. Callable Function Pattern

Follow the 4-layer callable pattern:

1. **Types** — `packages/shared/types/src/lib/api/{name}.ts` (input/output Zod schemas + TS types)
2. **Registry** — `callable_functions.ts` (type-safe function name registry)
3. **Controller** — `apps/backend/functions/src/controllers/callable/{name}.ts` (uses `onCallZod`)
4. **Frontend** — `firebaseFunctionsService.getTypedCallable('name')`

---

## 8. Logger

Logger is auto-imported into every function via `includeFilePath: 'src/logger.ts'` in firestack.config.ts. Use it via `$logger` alias:

```ts
import { logger } from '$logger';

logger.debug('Processing', { userId, action });
logger.log('Completed', { result });
logger.error('Failed', { error });
logger.warn('Deprecated call', { path });

// Flush buffered log entries (call at end of handlers that do fire-and-forget)
await logger.flush().catch(() => {});
```

Log context (source, trigger, requestId) is automatically set by firestack wrappers.

---

## 9. Security Rules & Indexes

Rules and indexes live in `apps/backend/functions/src/rules/` and are deployed with functions.

```bash
# Deploy rules + indexes only
bun moon run functions:rules

# Test rules
bun moon run functions:test-rules
```

---

## 10. Best Practices

1. **Zod at the edge** — always use `*Zod` wrappers for type-safe, validated inputs
2. **Schema from @aikami/schemas** — reuse existing schemas, don't define ad-hoc
3. **Use firestack.config.ts** — no global index.ts, no setGlobalOptions
4. **Const arrow functions** — all handlers use `const handler = ...` pattern
5. **Options objects** — accept more than one arg? Use `{ a, b }` object
6. **Early returns** — validate → early return → business logic
7. **Cold start** — init heavy deps outside handler
8. **Snake_case files** — enforced by Biome

---

## 11. Anti-Patterns

- ❌ Defining schemas inline instead of importing from `@aikami/schemas`
- ❌ Using `onRequest` without Zod when a schema exists
- ❌ Using `firestack.json` — use `firestack.config.ts`
- ❌ Creating `src/index.ts` with global `setGlobalOptions` — firestack.config.ts handles this
- ❌ Calling `getBackendEnvironmentValue` — deprecated, use env vars directly
- ❌ Raw type assertions (`as Record<string, unknown>`) when Zod is available
- ❌ Multiple functions per file — one `export default` per file
- ❌ PascalCase/camelCase filenames — must be snake_case
