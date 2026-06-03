---
name: firebase-functions
description: Best practices for Aikami Firebase Cloud Functions — firestack v2, typed generics, firestack.config.ts, trigger patterns.
version: 4.0.0
tags: ["firebase", "cloud-functions", "firestack", "typescript"]
---

# Aikami — Cloud Functions

Firebase Cloud Functions v2 using **Firestack** (`@snorreks/firestack`). Functions auto-discovered from `apps/backend/functions/src/controllers/` by file path. One function per file, exported as default.

---

## 1. Configuration — firestack.config.ts

Configuration lives in `apps/backend/functions/firestack.config.ts`. **There is no global index.ts or setGlobalOptions.** Firestack handles region, mode, memory, etc. per-function or globally.

```ts
// apps/backend/functions/firestack.config.ts
import { defineConfig } from "@snorreks/firestack";
import {
	CLOUD_FUNCTIONS_REGION,
	MODE_PROJECT_MAP,
} from "../../../packages/shared/constants/src/index.ts";

export default defineConfig(() => ({
	modes: {
		staging: MODE_PROJECT_MAP.staging,
		production: MODE_PROJECT_MAP.production,
		emulator: MODE_PROJECT_MAP.emulator,
	},
	region: CLOUD_FUNCTIONS_REGION, // europe-west3
	nodeVersion: "24",
	engine: "bun" as const,
	minify: true,
	sourcemap: true,
	cloudCacheFileName: "functions_cache.ts", // Remote deploy cache
	includeFilePath: "src/logger.ts", // Auto-imported into every function
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

## 3. Function Patterns

All functions use the standard firestack wrappers:

- `onRequest` for HTTP endpoints
- `onCall` for callable functions
- `onCreated`, `onDeleted`, `onUpdated` for Firestore triggers
- `onWritten` for combined write triggers

These provide type-safe handlers. Validation at the edge is handled by schemas
from `@aikami/schemas`.

---

### HTTP Function (onRequest)

```ts
// apps/backend/functions/src/controllers/api/webhooks/telegram.ts
import { onRequest } from "@snorreks/firestack";
import { logger } from "$logger";

export default onRequest(async (request, response) => {
	const { message } = request.body;

	if (!message) {
		logger.debug("telegram_webhook: no message in update");
		response.status(200).send("ok");
		return;
	}

	logger.info("telegram_webhook: received", {
		chatId: message.chat.id,
		text: message.text,
	});

	response.status(200).send("ok");
});
```

---

### Callable Function (onCall)

```ts
// apps/backend/functions/src/controllers/callable/process_email_triage.ts
import { onCall } from "@snorreks/firestack";
import { logger } from "$logger";

export default onCall(async (request) => {
	if (!request.auth) throw new Error("unauthenticated");

	const result = await processEmailTriage(request.data);
	return result;
});
```

---

### Firestore Trigger (onCreated)

```ts
// apps/backend/functions/src/controllers/firestore/agent_checkpoints/[checkpointId]/created.ts
import { onCreated } from "@snorreks/firestack";
import { logger } from "$logger";

export default onCreated(async ({ data, params }) => {
	const checkpointId = params.checkpointId;

	if (data.status !== "pending") return;

	logger.log("agent_checkpoint created", {
		checkpointId,
		companyId: data.companyId,
	});

	// ... business logic
});
```

---

### Firestore Trigger (onUpdated)

```ts
import { onUpdated } from "@snorreks/firestack";

export default onUpdated(async ({ data, params }) => {
	if (data.before.role !== data.after.role) {
		logger.log("User role changed", {
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
import { onSchedule } from "@snorreks/firestack";
import { logger } from "$logger";

export default onSchedule(
	async (_context) => {
		logger.log("Scheduled job running");
		// ... work
		return { status: "completed" };
	},
	{
		schedule: "every 5 minutes",
		region: "europe-west3",
		memory: "256MiB",
		timeoutSeconds: 300,
	},
);
```

---

## 4. Typed Generics

Firestack wrappers support typed generics for full type-safety:

```ts
// onRequest with typed body/params/response
import type { RequestFunctions } from "@shared/types";
import { onRequest } from "@snorreks/firestack";

export default onRequest<RequestFunctions, "myFunction", { id: string }>(
	async (request, response) => {
		// request.body: MyRequestBody
		// request.params: { id: string }
		// response.send() expects MyResponseBody
	},
	{ region: "europe-west3" },
);

// onCall with typed data/response
import type { CallableFunctions } from "@shared/types";
import { onCall } from "@snorreks/firestack";

export default onCall<CallableFunctions, "myCallable">(async (request) => {
	// request.data: MyCallableInput
	// return: MyCallableOutput
});
```

Use these types from `packages/shared/types/src/lib/api/` — they serve as the canonical interface between frontend and backend.

---

## 5. Per-Function Options

Options are passed as the second argument to the wrapper:

```ts
export default onRequest(myHandler, {
	region: "europe-west3", // Override global region
	memory: "512MiB", // Override memory
	timeoutSeconds: 120, // Max 540
	functionName: "custom_name", // Override auto-derived name
	external: ["sharp"], // Keep dep external (installed at deploy time)
});
```

---

## 6. Deployment

```bash
# Deploy all functions
bun moon run functions:deploy

# Deploy to staging
bun moon run functions:deploy -- staging

# Deploy single function
bun moon run functions:deploy -- staging --only pollGmail

# Start emulator
bun moon run functions:emulate

# View logs
bun moon run functions:logs
bun moon run functions:logs:tail
```

Via AI tools:

```
firebase_deploy_functions mode=staging
firebase_deploy_functions mode=staging only=pollGmail,sendNotification
```

---

## 7. Callable Function Pattern

All Firebase callable functions follow a strict 4-layer typed pattern with explicit
"never" rules at each layer:

### 1. Types — `packages/shared/types/src/lib/api/<function_name>.ts`

```typescript
export type MyFunctionRequest = { field: string };
export type MyFunctionResponse = { result: string };
```

### 2. Registry — `packages/shared/types/src/lib/api/callable_functions.ts`

```typescript
export type CallableFunctions = {
	my_function: [MyFunctionRequest, MyFunctionResponse];
	// ... existing entries
	[key: string]: [unknown, unknown]; // index signature for extensibility
};
```

- **Never** remove the index signature — it's required for extensibility.

### 3. Controller — `apps/backend/functions/src/controllers/callable/<function_name>.ts`

```typescript
import type { CallableFunctions } from "@aikami/types";

export default onCall<CallableFunctions, "my_function">(async (request) => {
	// request.data is typed as MyFunctionRequest
	// return type is MyFunctionResponse
});
```

- **Never** use `onCall<Record<string, [Req, Res]>, 'name'>` — deprecated pattern.
- **Never** define local `type MyFunctionRequest = {...}` — import from `@aikami/types`.

### 4. Frontend — `firebaseFunctionsService.getTypedCallable('name')`

```typescript
import { firebaseFunctionsService } from "@aikami/frontend/services";

const callable = await firebaseFunctionsService.getTypedCallable("my_function");
const { data } = await callable({ field: "value" });
// data is typed as MyFunctionResponse
```

- **Never** raw import `httpsCallable` from `@aikami/frontend/configs/functions`.
- Always re-export from `apps/frontend/<app>/src/lib/firebase/<name>.ts` for app-local convenience.

---

## 8. Logger

See `aikami-conventions` for logger setup (`$logger` alias). Logger is
auto-imported into every function via `includeFilePath: 'src/logger.ts'` in
`firestack.config.ts`. Log context (source, trigger, requestId) is
automatically set by firestack wrappers.

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

1. **Use firestack.config.ts** — no global index.ts, no setGlobalOptions
2. **Const arrow functions** — all handlers use `const handler = ...` pattern
3. **Options objects** — accept more than one arg? Use `{ a, b }` object
4. **Early returns** — validate → early return → business logic
5. **Cold start** — init heavy deps outside handler
6. **Typed generics** — use `onCall<CallableFunctions, 'name'>` for end-to-end types
7. **See `aikami-conventions`** for: snake*case files, `*`private prefix,`$logger` alias, error handling

---

## 11. Anti-Patterns

- ❌ Using `firestack.json` — use `firestack.config.ts`
- ❌ Creating `src/index.ts` with global `setGlobalOptions` — firestack.config.ts handles this
- ❌ Calling `getBackendEnvironmentValue` — deprecated, use env vars directly
- ❌ Multiple functions per file — one `export default` per file
- ❌ PascalCase/camelCase filenames — must be snake_case (see `aikami-conventions`)
- ❌ Defining types/schemas inline — import from `@aikami/types` / `@aikami/schemas`
