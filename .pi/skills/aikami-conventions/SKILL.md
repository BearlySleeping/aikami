---
name: aikami-conventions
description: >-
    🔴 LOAD BEFORE writing ANY Aikami code — universal TypeScript and monorepo
    conventions: critical violations (logger, imports, types), strict TS rules,
    import path discipline, arrow functions, `as const` / `satisfies`, error
    handling, validation boundaries, project structure, private member naming,
    file naming, output style, and direnv environment. For frontend load
    svelte-conventions; for backend load backend-conventions.
version: 5.0.0
tags: ["aikami", "conventions", "typescript", "monorepo", "critical", "monorepo-boundaries"]
---

# Aikami Conventions

**🔴 READ BEFORE WRITING ANY CODE.** These rules are non-negotiable. Violations
break the build, cause esbuild/aliasing errors, or produce code that won't
compile. Load this skill first, before touching any file.

This skill contains ONLY universal rules. Load the layer-specific skill for
your task:

| Working on…                       | Load                                            |
| --------------------------------- | ----------------------------------------------- |
| **Frontend (client, Svelte)**     | `svelte-conventions` — runes, Views/ViewModels, |
|                                   | services, `$services` barrel, aliases           |
| **Backend (functions, packages)** | `backend-conventions` — controller/service/     |
|                                   | repository layers, testing                      |
| UI styling                        | `aikami-ui`                                     |
| Game engine                       | `pixijs-v8`                                     |
| Tauri desktop                     | `tauri-v2`                                      |
| Firestore collections             | `firestore-collection`                          |
| Data Connect                      | `dataconnect`                                   |
| Functions deploy/emulators        | `firestack`                                     |
| New SvelteKit page                | `svelte-page`                                   |

---

## 🔴 ARCHITECTURE PILLARS

These four pillars govern all code generation in the Aikami monorepo.
Violating any of them produces code that will be rejected in review and
blocked by CI. Pillars 1–2 are enforced here; Pillars 3–4 are enforced in
`svelte-conventions`.

### Pillar 1: Tauri SPA — No Server Routes

Aikami's frontend is a **static Single-Page Application** wrapped in Tauri v2.
There is no SvelteKit server running in production. All rendering and data
fetching is client-side only. `adapter-static` is the only adapter.

**🔴 PROHIBITED** — these files must **never** exist anywhere in
`apps/frontend/client/src/routes/`:

| Forbidden File Pattern | Why                                     |
| ---------------------- | --------------------------------------- |
| `+server.ts`           | SvelteKit API routes — no server in SPA |
| `+page.server.ts`      | Server-side page data loading           |
| `+layout.server.ts`    | Server-side layout data loading         |

**✅ REQUIRED** data fetching patterns:

```typescript
// ✅ Client-side Firebase SDKs
import { doc, getDoc, collection, query } from "firebase/firestore";
import { getAuth, signInWithPopup } from "firebase/auth";

// ✅ Standard fetch to external microservices (voice, image, text)
const response = await fetch("http://localhost:3001/tts", {
	method: "POST",
	body: JSON.stringify({ text }),
});

// ✅ Browser APIs (localStorage, IndexedDB, Web Audio, etc.)
localStorage.getItem("session-key");
```

**Enforcement**: CI rejects any PR containing `+server.ts`, `+page.server.ts`,
or `+layout.server.ts` under `apps/frontend/client/src/routes/`.

### Pillar 2: Monorepo Boundaries — Shared Packages Only

Domain types, validation schemas, Zod definitions, and global constants
**must never** be defined inside application packages (`apps/`). They belong
in `packages/shared/` and are consumed via `@aikami/*` imports.

| ❌ FORBIDDEN — defined in `apps/**`   | ✅ REQUIRED — import from shared package                                 |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `type Agent = { id: string; ... }`    | `import type { Agent } from "@aikami/types"`                             |
| `const agentSchema = z.object({...})` | `import { agentSchema } from "@aikami/schemas"`                          |
| `const MAX_RETRIES = 3`               | `import { MAX_RETRIES } from "@aikami/constants"`                        |
| TypeBox schema in `apps/backend/**`   | `import { Type } from "@sinclair/typebox"` in `packages/shared/schemas/` |
| `apps/frontend/client/src/lib/types/` | `packages/shared/types/src/lib/`                                         |

```typescript
// ❌ WRONG — domain type defined in app-level code
// apps/frontend/client/src/lib/types/agent.ts
export type Agent = { id: string; name: string; role: string };

// ❌ WRONG — schema defined in backend code
// apps/backend/firebase/src/features/agent/schema.ts
import { z } from "zod";
export const agentSchema = z.object({ id: z.string(), name: z.string() });

// ✅ CORRECT — import from shared package
import type { Agent } from "@aikami/types";
import { agentSchema } from "@aikami/schemas";
import { MAX_RETRIES } from "@aikami/constants";
```

**If a type is missing**: Add it to `packages/shared/types/` first. If it
crosses project boundaries (e.g., backend ↔ frontend), also add a TypeBox
schema to `packages/shared/schemas/`. Never define it locally as a shortcut.

### Pillars 3 & 4: Svelte MVVM + Dev Sandboxes

Enforced in the `svelte-conventions` skill — load it for any client work.

| Pillar | Rule                                                          |
| ------ | ------------------------------------------------------------- |
| 3      | Views are completely logicless; state and business logic in   |
|        | `_view_model.svelte.ts`                                       |
| 4      | `routes/(dev)/` sandboxes use `DevViewModel` override pattern |

---

## 🔴 CRITICAL VIOLATIONS — DO NOT BREAK THESE

These are the most common mistakes. Check this list before every import or type
definition. If you get an esbuild error about a missing module, **the fix is
never to bypass the convention.** The convention is the fix.

### 1. Logger: `this.debug()` in Classes, `$logger` in Module Functions

Two-tier rule:

1. **Inside any `BaseClass`/`BaseViewModel` subclass (services, ViewModels,
   repositories)** — use the inherited methods: `this.debug()`, `this.info()`,
   `this.warn()`, `this.error()`, `this.log()`. NEVER import `$logger` in
   these files. The inherited methods prefix the class name and integrate
   with `create()` auto-logging.
2. **Module-level code (standalone arrow functions, utils, scripts)** — import
   from `$logger`, NEVER from `@aikami/logger`.

```typescript
// ✅ CORRECT — class code uses inherited logging
class UploadService extends BaseClass {
	async upload(): Promise<void> {
		this.debug("upload:start");
	}
}

// ✅ CORRECT — module-level function uses $logger
import { logger } from "$logger";
const parseManifest = (raw: string) => {
	logger.debug("parseManifest");
};

// ❌ WRONG — $logger inside a BaseClass subclass
import { logger } from "$logger";
class UploadService extends BaseClass {
	async upload(): Promise<void> {
		logger.debug("upload"); // loses className prefix
	}
}

// ❌ WRONG — bypasses environment-specific resolution, breaks builds
import { logger } from "@aikami/logger";
```

| Environment            | `$logger` resolves to                       |
| ---------------------- | ------------------------------------------- |
| SvelteKit (Client)     | `shared/logger/src/lib/svelte_kit.ts`       |
| Firebase Functions     | `shared/logger/src/lib/logger_functions.ts` |
| Browser (client, site) | `shared/logger/src/lib/logger_browser.ts`   |
| AWS / Node.js          | `shared/logger/src/lib/logger_aws.ts`       |

**Why**: Each environment configures `$logger` in its own `tsconfig.json` `paths`
(or `svelte.config.js`). `@aikami/logger` is a NPM package alias — it doesn't
know which environment you're in and will resolve to the wrong implementation.

### 2. Import from Package ROOT, Never `lib/` Sub-Paths

```typescript
// ✅ CORRECT — import from package root (maps to src/index.ts)
import type { User, Session } from "@aikami/types";
import { toAppError } from "@aikami/utils";
import { userSchema } from "@aikami/schemas";

// ❌ WRONG — never import from lib/ sub-paths
import type { User } from "@aikami/types/lib/user";
import type { CommandNode } from "@aikami/schemas/lib/parser";
```

**Why**: `src/index.ts` is the public API surface. `lib/` is an implementation
detail. Tree-shaking removes unused exports. Importing from `lib/` bypasses
barrel exports and can miss re-exports or renamed symbols.

### 2b. Always Import Types at the Top of the File, Never Inline `import()`

```typescript
// ✅ CORRECT — import type at top of file
import type { ItemDefinition } from "@aikami/types";

export type MyInterface = {
	getItem(id: string): ItemDefinition;
};

class MyClass {
	getItem(id: string): ItemDefinition {
		return {} as ItemDefinition;
	}
}

// ❌ WRONG — inline import() type reference
import type { ItemDefinition } from "@aikami/types";

export type MyInterface = {
	getItem(id: string): import("@aikami/types").ItemDefinition;
};

class MyClass {
	getItem(id: string): import("@aikami/types").ItemDefinition {
		return {} as import("@aikami/types").ItemDefinition;
	}
}
```

**Exception**: Dynamic runtime imports (`await import('...')`) for SSR-incompatible
modules (PixiJS, engine code) are allowed — this rule only applies to **type-level**
`import()` expressions.

### 🔴 Dynamic Imports: `await import()` — Avoid Unless Proven Necessary

Aikami's client is a **static SPA** (`ssr: false, prerender: false`). All code
is bundled into a single build — dynamic imports do NOT reduce bundle size
(Vite includes everything regardless). They fragment the bundle into
micro-chunks, add async overhead, and force `async`/`await` cascading
through call stacks.

The **default is a static `import`**. Only use `await import()` when one of
these specific justifications applies:

#### ✅ Valid Reasons for `await import()`

| Reason                       | Example                                                                           | Applies To |
| ---------------------------- | --------------------------------------------------------------------------------- | ---------- |
| **Import-time side effects** | Firebase config modules (`getAnalytics(app)` crashes in emulator without `appId`) | Client     |
| **Massive library** (>500KB) | `onnxruntime-web`, `kokoro-js`, `pixi.js` Assets                                  | Client     |
| **Conditional provider**     | AI client factory — only the chosen provider's SDK loads                          | Client     |
| **Platform-specific code**   | `@tauri-apps/api` (Tauri-only), `IndexedDB` vs `localStorage`                     | Client     |
| **Build-time branch**        | `import.meta.env.SSR` — Vite tree-shakes the dead branch at build time            | Client     |
| **Web Worker**               | `?worker&type=module` — Vite requires dynamic import for workers                  | Client     |
| **Lazy data** (>100KB JSON)  | Country lists, weak password dictionaries                                         | Client     |
| **Dev-only tools**           | `eruda` debug console — must never ship to production                             | Client     |
| **Node.js built-ins**        | `node:fs/promises`, `node:path` — only in CLI/build scripts, not browser          | Shared     |
| **External native packages** | `pg`, `@tursodatabase/database` — optional backends                               | Backend    |

#### ❌ NOT Valid Reasons — Use Static `import` Instead

| Anti-pattern                        | Why It's Wrong                                                                                       | Fix                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Service-to-service** lazy loading | Services are pure singletons, no side effects at import time. Creates false async boundaries.        | Static `import { otherService } from '$services'`                    |
| **"Performance"** in a static SPA   | Vite bundles everything regardless. Dynamic imports create MORE network requests, not fewer.         | Static `import`                                                      |
| **Circular dependency workaround**  | Dynamic imports mask architectural problems. Fix the dependency graph instead.                       | Restructure modules, introduce interfaces, or use a composition root |
| **"SSR guard"**                     | Client is `ssr: false` — there is no SSR to guard against                                            | Remove the guard, static import                                      |
| **"Cold start" in Functions**       | Firebase Functions bundle is deployed whole — no tree-shaking. Dynamic import adds runtime overhead. | Static `import` (unless it's a genuinely optional heavy dependency)  |

```typescript
// ❌ WRONG — service-to-service dynamic import (no side effects, not circular)
class AutonomousMessageService extends BaseClass {
	async _generateMessage(): Promise<void> {
		const { textGenerationService } = await import("../ai/text_generation_service.svelte.ts");
		// ...
	}
}

// ✅ CORRECT — static import (both are pure singletons)
import { textGenerationService } from "$services";

class AutonomousMessageService extends BaseClass {
	async _generateMessage(): Promise<void> {
		// use textGenerationService directly
	}
}
```

### 3. Never Export Data, Types, or Schemas from Service Files

Services are for **business logic and state management only**. Data, types, and
schemas are **data shapes** — they belong in dedicated packages. This is a
specific instance of **Pillar 2 (Monorepo Boundaries)** — see above for the
full rule.

#### What Goes Where

| Category                  | Location                                                  | Example                                            |
| ------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| **Shared constants/data** | `packages/shared/constants/`                              | `TEXT_PROVIDERS`, `DEFAULT_*`, provider registries |
| **Shared types**          | `packages/shared/types/` (derived from `@aikami/schemas`) | Cross-project domain types                         |
| **Shared schemas**        | `packages/shared/schemas/` (TypeBox)                      | Data validation shapes                             |
| **Client-local data**     | `apps/frontend/client/src/lib/data/`                      | Provider endpoint configs                          |
| **Client-local types**    | `apps/frontend/client/src/lib/types/`                     | `Connection`, `ConnectionTestResult`               |

#### 🔴 Domain Structure Allocation Truth Matrix

Every data entity, type, label, and UI state flag has exactly ONE canonical
location. No duplication across packages. No shortcuts. If you add to the wrong
location, your code will be rejected.

| Layer                     | Canonical Location                                          | What Belongs                                                                                                      | What Does NOT Belong                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Constants & Labels** | `packages/shared/constants/src/`                            | Provider registries, enum-like arrays, default configs, display labels, error codes, routing paths, feature flags | Runtime state, computed values, configs from external APIs (those go in `apps/.../data/`), ViewModel-local UI strings                                    |
| **2. Type Definitions**   | `packages/shared/types/src/`                                | Cross-project domain types, API request/response shapes, entity interfaces                                        | Single-app-local types (go in `apps/<app>/src/lib/types/`), single-function-internal types (go inline), ViewModel interface types (go in ViewModel file) |
| **3. Runtime Schemas**    | `packages/shared/schemas/src/` (TypeBox)                    | All cross-boundary data validation shapes (API inputs, Firestore documents, EngineBridge payloads)                | Zod schemas (use TypeBox), validation logic for a single function (inline guard), backend-only validation that never crosses to client                   |
| **4. UI State Flags**     | `apps/frontend/client/src/lib/views/*_view_model.svelte.ts` | See `svelte-conventions` § UI State Flags                                                                         | —                                                                                                                                                        |

**🔴 Violations**:

- Labels/translations hardcoded in app code → extract to `packages/shared/constants/`
- Types defined in `apps/` that another package needs → move to `packages/shared/types/`
- Validation in service files → create TypeBox schema in `packages/shared/schemas/`

```typescript
// ❌ WRONG — data/type/schema defined in a service file
// apps/frontend/client/src/lib/services/config/config_service.svelte.ts
export const TEXT_PROVIDERS = [{ id: 'openrouter', ... }] as const;
export type Connection = { id: string; name: string; ... };

// ❌ WRONG — type/schema defined in a service file
// apps/frontend/client/src/lib/client/services/game/game_state_service.ts
export type ActiveContextEntry = { entityId: string; ... };
export const ActiveSessionSchema = z.object({ ... });

// ✅ CORRECT — data from @aikami/constants
// apps/frontend/client/src/lib/services/config/config_service.svelte.ts
import { TEXT_PROVIDERS } from '@aikami/constants';

// ✅ CORRECT — client-local type from $types
import type { Connection, ConnectionId } from '$types';

// ✅ CORRECT — schema from shared package
import { ActiveSessionSchema } from "@aikami/schemas";
```

**🔴 NEVER create and export data, types, or schemas from service files.** The
ONLY exception: the service's own **interface and options type**:

```typescript
export type MyServiceInterface = BaseClassInterface & { ... };
export type MyServiceOptions = { ... };
```

Re-exporting from the correct source is acceptable for backward compatibility:

```typescript
// ✅ OK — re-export from the proper source (not defining locally)
export { TEXT_PROVIDERS, type TextProvider } from "@aikami/constants";
```

### 4. File Naming: snake_case ONLY

All source files use `snake_case`. Enforced by Biome `useFilenamingConvention`.

```
✅ auth_service.ts      ✅ poll_gmail.ts        ✅ user_repository.ts
✅ view_model.svelte.ts  ✅ base_view.svelte

❌ authService.ts       ❌ pollGmail.ts          ❌ UserRepository.ts
❌ ViewModel.svelte.ts   ❌ BaseView.svelte
```

### 5. Private Members: Underscore `_` Prefix

All `private` class members (fields, methods, getters, setters) must use an
underscore `_` prefix. This visually distinguishes them from public members
and prevents accidental access from outside the class.

```typescript
// ✅ CORRECT — private members prefixed with _
class UserService {
  private readonly _userRepository: UserRepository;
  private _cache = new Map<string, User>();
  private readonly _collection = "users";

  async findById(id: string): Promise<User | undefined> {
    return this._userRepository.findById(id);
  }

  private _normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }
}

// ❌ WRONG — private members without underscore prefix
class UserService {
  private readonly userRepository: UserRepository;
  private cache = new Map<string, User>();

  private normalizeEmail(email: string): string { ... }
}
```

**Exception**: ViewModel `$state` fields are public by design (see
`svelte-conventions`). Do NOT prefix public `$state` fields with `_`.

---

## Output Style

**Terse. Technical substance only. No fluff.** Drop articles, filler,
pleasantries, hedging. Fragments are OK. Every word must earn its place.

- **Artifacts to files** — Never inline large generated content. Return: file
  path + 1-line description.
- **Auto-expand only for**: security warnings, irreversible actions, user
  confusion.
- **After validate**: 3-4 line summary — what changed, results, suggested
  commit message. Nothing more.

---

## TypeScript Strictness

### ❌ Forbidden — Use the Alternative

| Forbidden                  | Use Instead                                  |
| -------------------------- | -------------------------------------------- |
| `any`                      | `unknown` + type guards                      |
| `null`                     | `undefined` everywhere                       |
| `!` (non-null assertion)   | Early returns or optional chaining           |
| `as unknown as Type`       | Proper data transformation functions         |
| `interface`                | `type` alias                                 |
| Exporting single-use types | Define near/inside the function that uses it |
| `function` declarations    | Arrow functions (`const fn = () => {}`)      |

### ❌ Forbidden Patterns

- **Chained arguments** — Functions with more than 1 argument must use an options object `{...}`
- **Single-line `if`** — Always use curly braces `{}` even for a single statement
- **Abbreviations** — Write out full words (`options` not `opts`, `functionName` not `fnName`)
- **Nested ternaries** — Use `if/else` or extract to a helper function

### ✅ Required Patterns

- **Arrow Functions** — Use arrow functions everywhere. The sole exception is class methods: use regular method syntax (`methodName() {}` instead of `methodName = () => {}`) so that `this` and `super` work correctly.
- **Interface/type method members use method shorthand** — declare
  `closeUploadInfo(): void`, never `closeUploadInfo: () => void`. Method
  signatures mirror the regular-method implementation and stay bivariant for
  interface compatibility.
- **Callers must preserve `this`** — never pass an unbound method reference
  (`onclick={viewModel.open}`, `array.map(service.format)`); wrap in an arrow
  function (`onclick={() => viewModel.open()}`).
- **Escape Early** — Return-early pattern to avoid deep nesting
- **Extract Logic** — If a section within a function can stand alone, extract it into a separate private function (with `_` prefix: `_extractedHelper()`)
- **JSDoc Everything** — All exported functions, types, and complex internals must have JSDoc comments

### Options Object Pattern

When a function has more than 1 argument, always group them into an options object:

```typescript
// ✅ CORRECT — options object for 2+ arguments
export const createUser = (options: {
  email: string;
  displayName: string;
  role?: string;
}): Promise<User> => {
  logger.debug("createUser", options);
  // ...
};

// ✅ OK — single argument, no options object needed
export const findById = (id: string): Promise<User | undefined> => {
  logger.debug("findById", { id });
  // ...
};

// ❌ WRONG — multiple positional arguments
export const createUser = (email: string, displayName: string, role?: string) => { ... };
```

### Class Instantiation — Always `ClassName.create()`, Never `new`

All classes extending `BaseClass` must be instantiated with the static `create()`
factory method. It auto-logs every public method call — **no manual
`this.debug()` at method entry is needed.**

```typescript
// ✅ CORRECT — ClassName.create() factory (enables auto-logging)
export const service = MyService.create({ className: "MyService" });
export const authService = FirebaseAuthService.create({ className: "FirebaseAuthService" });

// ❌ WRONG — raw `new` bypasses auto-logging
export const service = new MyService({ className: "MyService" });
```

**Auto-logging mechanism**: `create()` shadows every public prototype method
on the instance with a shim that logs `methodName + args` before delegating
(prototype shadowing, not an ES6 Proxy — Svelte 5 `$state` breaks under
custom Proxies). Only regular class methods participate — arrow-function
fields are invisible to it (one more reason arrow methods are banned). In
production the wrapping is skipped for zero overhead.

**Mid-method debug logging** for state transitions or error conditions is still
acceptable:

```typescript
class MyService extends BaseClass {
	async process(options: { id: string }) {
		// create() auto-logs: debug('process', options)
		// No manual this.debug() needed here

		const result = await this._fetch(options.id);
		if (!result) {
			this.debug("process:not-found", { id: options.id }); // ✅ contextual
			return;
		}
		this.debug("process:complete", { id: options.id }); // ✅ contextual
	}
}
```

**Arrow functions** that are NOT class methods should still use `logger.debug()`
from `$logger` at entry since they don't participate in auto-logging:

```typescript
// ✅ Arrow functions still manually log
const loadItems = async (options: { filter: string }) => {
	logger.debug("loadItems", options);
	// ...
};
```

### `as const` and `satisfies`

Prefer `as const` on object literals to infer the narrowest types. Use
`satisfies` to validate against a type without widening:

```typescript
// ✅ as const for narrow inference
const PATTERNS = {
	command: /^\/([\w-]+)(?:\s+(.+))?$/s,
	macro: /\{\{([\w-]+)(?::\s*([^}]*))?\}\}/g,
} as const;

// ✅ satisfies for type-checking without widening
const CONFIG = {
	timeout: 5000,
	retries: 3,
	endpoint: "/api/v2",
} as const satisfies Record<string, string | number>;
```

---

## Import Path Rules

### Always Import from Package Root

When importing from any `@aikami/*` package, import from the **package root**
— never from `lib/` sub-paths:

```typescript
// ✅ CORRECT — import from package root (maps to src/index.ts)
import type { CommandNode, MacroNode, TextNode } from "@aikami/schemas";
import { CommandNodeSchema } from "@aikami/schemas";
import type { User, Session } from "@aikami/types";
import { toAppError } from "@aikami/utils";
import { FIREBASE_REGION } from "@aikami/constants";

// ❌ WRONG — never import from lib/ sub-paths
import type { CommandNode } from "@aikami/schemas/lib/parser";
import { toAppError } from "@aikami/utils/lib/errors";
```

### Same Rule for Local Aliases

```typescript
// ✅ CORRECT
import type { Connection } from "$types"; // client-local types barrel
import { userSchema } from "@aikami/schemas"; // maps to src/index.ts

// ❌ WRONG
import type { Connection } from "$types/lib/connection";
import { userSchema } from "@aikami/schemas/lib/user";
```

Note: in the client, `$types` maps to `apps/frontend/client/src/lib/types`
(app-local types) — cross-project types come from `@aikami/types`.

### Backend Package Aliases: Forward Slash, Never Hyphen

Backend package imports use forward slash (`/`) between `backend` and the
sub-package name — never hyphens:

```typescript
// ✅ CORRECT
import { AgentService } from "@aikami/backend/agent";
import { ChatService } from "@aikami/backend/chat";
import { onboardingFlow } from "@aikami/backend/onboarding";

// ❌ WRONG
import { AgentService } from "@aikami/backend-agent";
import { ChatService } from "@aikami/backend-chat";
```

This applies to:

- `apps/frontend/client/svelte.config.js` — Vite/SvelteKit aliases
- `apps/backend/firebase/tsconfig.json` — Functions tsconfig paths
- All `import` statements referencing these packages

The pattern `@aikami/backend/<name>` keeps sub-package imports consistent
with `@aikami/backend/auth/*`, `@aikami/backend/configs/*`, etc.

### Wildcard Imports (Only When Needed)

```typescript
// ✅ Only use wildcard when you genuinely need multiple sub-module exports
import { Type, type Static } from "@sinclair/typebox";
```

---

## Type Definitions — Where Types and Schemas Live

See **Pillar 2 (Monorepo Boundaries)** above. Additional details:

| Location                    | What goes there                                 |
| --------------------------- | ----------------------------------------------- |
| `packages/shared/schemas/`  | TypeBox schemas (cross-project data validation) |
| `packages/shared/types/`    | Cross-project types (used by 2+ apps/packages)  |
| `apps/<app>/src/lib/types/` | Single-app types (100% specific to one app)     |
| Inline / top of file        | Single-method type used in exactly one function |

### Schema-First: Derive Types from TypeBox Schemas

When data crosses project boundaries (service ↔ ViewModel, backend ↔ frontend),
define a TypeBox schema in `@aikami/schemas` first, then derive the TypeScript
type from it:

```typescript
// packages/shared/schemas/src/lib/api/chat.ts
import { Type, type Static } from "@sinclair/typebox";

export const ChatMessageSchema = Type.Object({
	id: Type.String(),
	text: Type.String(),
	timestamp: Type.Number(),
});

// packages/shared/types/src/lib/api/chat.ts
import type { Static } from "@sinclair/typebox";
import { ChatMessageSchema } from "@aikami/schemas";

export type ChatMessage = Static<typeof ChatMessageSchema>;
```

This ensures runtime validation and TypeScript types are always in sync. The
schema in `@aikami/schemas` is the source of truth; `@aikami/types` re-exports
the inferred type.

🔴 **TypeBox Static Inference Law**: TypeBox schemas are the **single source of
truth** for all cross-boundary types. When a TypeBox schema exists for a data
shape, the corresponding TypeScript type in `packages/shared/types/` MUST be
inferred via `Static<typeof Schema>` — NEVER recreate the interface manually.

```typescript
// ✅ CORRECT — infer from schema (single source of truth)
// packages/shared/types/src/lib/user.ts
import type { Static } from "@sinclair/typebox";
import { UserSchema } from "@aikami/schemas";
export type User = Static<typeof UserSchema>;

// ❌ WRONG — manual interface duplicates the schema
// packages/shared/types/src/lib/user.ts
export type User = {
	id: string;
	email: string;
	displayName: string;
};
```

**Why**: Manual duplication causes schema-drift — the runtime validator and
the TypeScript type diverge silently. `Static<typeof Schema>` guarantees they
stay in lockstep. If you need the type, derive it. Never write it by hand.

**Rule of thumb**: If a type is passed from one project to another, it should
exist as a TypeBox schema in `@aikami/schemas` and be re-exported as a type from
`@aikami/types`.

---

## Error Handling

Use `AppError` from `@aikami/utils`:

```typescript
import { toAppError } from "@aikami/utils";

throw toAppError("not-found", "Resource not found");
throw toAppError("invalid-argument", "Invalid email");
throw toAppError("unauthorized", "User not logged in");
```

Valid types: `not-found`, `invalid-argument`, `unauthorized`, `unauthenticated`, `internal`, `captcha-required`.

---

## Validation

All runtime validation uses **TypeBox** from `@aikami/schemas`:

```typescript
import { Type, type Static } from "@sinclair/typebox";
import { userSchema } from "@aikami/schemas";

// Use Static<> to derive the type from the schema
export type User = Static<typeof userSchema>;
```

TypeBox schemas provide runtime validation + static type inference. They work
on both server (Firebase Functions) and client — no separate validation
library needed.

---

## Project Structure

```
aikami/
  apps/
    frontend/client/       — SvelteKit Client (SvelteKit + PixiJS + Tauri)
    frontend/site/         — Public site (Astro)
    frontend/docs/         — Documentation site (Astro Starlight)
    backend/firebase/      — Firebase Cloud Functions v2 + Data Connect
    backend/image|text|voice/ — Local AI microservices
    e2e/                   — E2E test suite
  packages/
    shared/                — constants, logger, mocks, parser, schemas, types, utils
    backend/               — ai, auth, chat, configs, database, image, svelte-kit, utils
    frontend/              — components, configs, dataconnect, engine, repositories, services, utils
  scripts/                 — CI, setup, ops scripts
```

---

## Moon Commands

Use extension tools: `validate()` for fix+typecheck+build+test, `moon_detect_affected` before tests.

```bash
bun moon run client:dev              # Start Client dev server (defaults to emulator mode)
bun moon run client:dev:staging   # Start Client in staging mode
bun moon run client:dev:production    # Start Client in production mode
bun moon run :typecheck            # Type-check all projects
bun moon run :lint                 # Lint all projects
bun moon run :fix                  # Auto-fix lint issues
bun moon run :test                 # Run all tests
bun moon run :validate             # Full CI validation
```

---

## Direnv Development Environment

### 🔴 CRITICAL: Mode-Aware Dev Server Commands

**`bun run dev` and `moon run client:dev` now default to emulator mode.**
Emulator is the primary development environment (90% of dev time).
Use explicit mode scripts when you need a different backend.

```bash
# ✅ Default — emulator mode (primary dev environment)
cd apps/frontend/client && bun run dev
bun moon run client:dev
bun run herdr:start client

# ✅ Explicit mode override when needed
cd apps/frontend/client && bun run dev:staging
cd apps/frontend/client && bun run dev:production

# ❌ None — dev now defaults to emulator, no footgun
```

**How to check** (from the Client package.json):

```json
{
	"dev": "vite dev --mode emulator",
	"dev:staging": "vite dev --mode staging",
	"dev:emulator": "vite dev --mode emulator",
	"dev:production": "vite dev --mode production"
}
```

The `--mode` flag tells Vite which `.env.{mode}` file to load, which sets
`PUBLIC_FIREBASE_PROJECT_ID`, `PUBLIC_MODE`, and other environment-specific
variables.

---

The project uses direnv for deterministic, zero-setup development. Environment
variables are always available via the loaded `.envrc`. All pi extensions
inherit this environment.

| Variable                   | Source                  | Purpose                               |
| -------------------------- | ----------------------- | ------------------------------------- |
| `AIKAMI_MODE`              | `.env.local` or default | emulator / staging / production       |
| `AIKAMI_PROJECT_ID`        | Resolved from mode      | GCP project id for current mode       |
| `AIKAMI_IS_EMULATOR`       | Resolved from mode      | "1" = local emulators, "0" = live GCP |
| `AIKAMI_NIX_READY`         | flake.nix shellHook     | "1" when Nix devShell loaded          |
| `GEMINI_API_KEY`           | GSM or mock             | Gemini API key for AI features        |
| `PLAYWRIGHT_BROWSERS_PATH` | Nix flake               | Playwright browsers from Nix          |

### Mode Switching

| Mode         | Project                | What it means                                                                                                                                             |
| ------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `emulator`   | `demo-aikami-emulator` | Fully local — Firebase emulators, no GCP. Safe to break.                                                                                                  |
| `staging`    | `aikami-dev`           | Live GCP project with real deployed services. Acts as staging — deployed Cloud Functions, live Firestore data. Can also run locally against live backend. |
| `production` | `aikami-prod`          | Live production. Deploy with care.                                                                                                                        |

```bash
aikami_switch emulator     # Local emulators, no GCP
aikami_switch staging  # Live staging (aikami-dev)
aikami_switch production   # Live production (aikami-prod)
```

### Adding Tools

When the LLM needs a CLI tool not in the Nix devShell:

```bash
direnv_add_package python3   # Adds to flake.nix, triggers direnv reload
direnv_add_package ffmpeg
```

---

## Commit & Push Policy

**Never commit or push without explicit user instruction.** Default: keep all
changes in the working tree. Present a summary after `validate()` and offer:
"Commit? Commit+push? Continue?" Let the user decide.

---

## File Path Comments

Every source file must include its relative path from the monorepo root as a
comment at the very top of the file.

**TypeScript / Svelte `.ts` files** — line 1, before any imports:

```typescript
// apps/frontend/client/src/lib/views/feature/view_model.svelte.ts
import { BaseViewModel } from "$lib/components/BaseViewModel.svelte";
```

**Svelte `.svelte` files** — first line inside `<script>`:

```svelte
<script lang="ts">
  // apps/frontend/client/src/lib/views/feature/feature_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
</script>
```

---

## Layer-Specific Conventions

- **Frontend (Svelte/SvelteKit)** → load `svelte-conventions` (runes-only,
  zero-logic Views, ViewModel pattern, services architecture, client aliases)
- **Backend (Functions, packages/backend)** → load `backend-conventions`
  (controller → service → repository → BaseDatabaseService, testing rules)
