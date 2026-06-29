---
name: aikami-conventions
description: >-
    🔴 LOAD BEFORE writing ANY Aikami code — TypeScript and monorepo conventions
    including critical violations (logger, imports, types), strict TS rules, import
    path discipline, arrow functions, `as const` / `satisfies`, error handling,
    validation boundaries, project structure, private member naming, file naming,
    output style, and direnv environment.
version: 4.0.0
tags: ["aikami", "conventions", "typescript", "monorepo", "critical", "phase-2", "tauri", "spa", "monorepo-boundaries"]
---

# Aikami Conventions

**🔴 READ BEFORE WRITING ANY CODE.** These rules are non-negotiable. Violations
break the build, cause esbuild/aliasing errors, or produce code that won't
compile. Load this skill first, before touching any file.

For framework-specific patterns, also load:

| Skill                  | Covers                                                    |
| ---------------------- | --------------------------------------------------------- |
| `pixijs-v8`            | PixiJS v8 + bitECS, game engine boundary, ECS patterns    |
| `tauri-v2`             | Tauri v2 desktop patterns and constraints                 |
| `firestore-collection` | Scaffolding Firestore collections                         |
| `firestack`            | Firebase Functions deployment, emulators, security rules  |
| `svelte-page`          | Scaffolding new SvelteKit pages                           |

---

## 🔴 PHASE 2 — ARCHITECTURE PILLARS

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

| Forbidden File Pattern | Why                                      |
| ---------------------- | ---------------------------------------- |
| `+server.ts`           | SvelteKit API routes — no server in SPA  |
| `+page.server.ts`      | Server-side page data loading            |
| `+layout.server.ts`    | Server-side layout data loading          |

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

| ❌ FORBIDDEN — defined in `apps/**`      | ✅ REQUIRED — import from shared package |
| --------------------------------------- | ---------------------------------------- |
| `type Agent = { id: string; ... }`      | `import type { Agent } from "@aikami/types"` |
| `const agentSchema = z.object({...})`   | `import { agentSchema } from "@aikami/schemas"` |
| `const MAX_RETRIES = 3`                 | `import { MAX_RETRIES } from "@aikami/constants"` |
| TypeBox schema in `apps/backend/**`     | `import { Type } from "@sinclair/typebox"` in `packages/shared/schemas/` |
| `apps/frontend/client/src/lib/types/`      | `packages/shared/types/src/lib/` |

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

Enforced by `svelte-conventions` — always loaded after this skill.

| Pillar | Rule                                          | Skill Section          |
| ------ | --------------------------------------------- | ---------------------- |
| 3      | Views are completely logicless; state and     | `svelte-conventions`   |
|        | business logic in `_view_model.svelte.ts`     | § Phase 2 Pillars      |
| 4      | `routes/(dev)/` sandboxes use `DevViewModel`  | `svelte-conventions`   |
|        | override pattern — extend production VM,      | § Phase 2 Pillars      |
|        | override fetch methods with mock data         |                        |

---

## 🔴 CRITICAL VIOLATIONS — DO NOT BREAK THESE

These are the most common mistakes. Check this list before every import or type
definition. If you get an esbuild error about a missing module, **the fix is
never to bypass the convention.** The convention is the fix.

### 1. Logger: Always `$logger`, Never `@aikami/logger`

```typescript
// ✅ CORRECT — $logger resolves to the right impl for this environment
import { logger } from "$logger";

// ❌ WRONG — bypasses environment-specific resolution, breaks builds
import { logger } from "@aikami/logger";
```

| Environment             | `$logger` resolves to                       |
| ----------------------- | ------------------------------------------- |
| SvelteKit (Client)         | `shared/logger/src/lib/svelte_kit.ts`       |
| Firebase Functions      | `shared/logger/src/lib/logger_functions.ts` |
| Browser (client, site) | `shared/logger/src/lib/logger_browser.ts`   |
| AWS / Node.js           | `shared/logger/src/lib/logger_aws.ts`       |

**Why**: Each environment configures `$logger` in its own `tsconfig.json` `paths`
(or `svelte.config.js`). `@aikami/logger` is a NPM package alias — it doesn't
know which environment you're in and will resolve to the wrong implementation.

### 2. Import from Package ROOT, Never `lib/` Sub-Paths

```typescript
// ✅ CORRECT — import from package root (maps to src/index.ts)
import type { User, Session } from "@aikami/types";
import { toAppError } from "@aikami/utils";
import { userSchema } from "@aikami/schemas";

// ✅ CORRECT — local alias also maps to package root
import type { User } from "$types";

// ❌ WRONG — never import from lib/ sub-paths
import type { User } from "@aikami/types/lib/user";
import type { CommandNode } from "@aikami/schemas/lib/parser";
```

**Why**: `src/index.ts` is the public API surface. `lib/` is an implementation
detail. Tree-shaking removes unused exports. Importing from `lib/` bypasses
barrel exports and can miss re-exports or renamed symbols.

### 3. Never Export Types or Schemas from Service Files

Types and schemas are data shapes, not business logic. This is a specific
instance of **Pillar 2 (Monorepo Boundaries)** — see above for the full rule.

```typescript
// ❌ WRONG — type/schema defined in a service file
// apps/frontend/client/src/lib/client/services/game/game_state_service.ts
export type ActiveContextEntry = { entityId: string; ... };
export const ActiveSessionSchema = z.object({ ... });

// ✅ CORRECT — import from the schema/type layer
// apps/frontend/client/src/lib/client/services/game/game_state_service.ts
import type { ActiveContextEntry } from "$types/game.ts";
import { ActiveSessionSchema } from "@aikami/schemas";
```

The ONLY exception: the service's own **interface and options type**:

```typescript
export type MyServiceInterface = BaseClassInterface & { ... };
export type MyServiceOptions = { ... };
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
factory method. The proxy wrapper auto-logs every public method call — **no manual
`this.debug()` at method entry is needed.**

```typescript
// ✅ CORRECT — ClassName.create() factory (enables proxy auto-logging)
export const service = MyService.create({ className: 'MyService' });
export const authService = FirebaseAuthService.create({ className: 'FirebaseAuthService' });

// ❌ WRONG — raw `new` bypasses proxy (no auto-logging)
export const service = new MyService({ className: 'MyService' });
```

**Proxy auto-logging**: The `create()` factory wraps the instance in an ES6
Proxy that logs `methodName + args` for every public method call. In production
(`NODE_ENV === 'production'`), the proxy is skipped for zero overhead.

**Mid-method debug logging** for state transitions or error conditions is still
acceptable:

```typescript
class MyService extends BaseClass {
  async process(options: { id: string }) {
    // Proxy auto-logs: debug('process', { args: [options] })
    // No manual this.debug() needed here

    const result = await this._fetch(options.id);
    if (!result) {
      this.debug('process:not-found', { id: options.id }); // ✅ contextual
      return;
    }
    this.debug('process:complete', { id: options.id }); // ✅ contextual
  }
}
```

**Arrow functions** that are NOT class methods should still use `logger.debug()`
from `$logger` at entry since they don't participate in the proxy:

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
import type { User } from "$types"; // maps to @aikami/types → src/index.ts
import { userSchema } from "@aikami/schemas"; // maps to src/index.ts

// ❌ WRONG
import type { User } from "$types/lib/user";
import { userSchema } from "@aikami/schemas/lib/user";
```

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
    frontend/client/          — SvelteKit Client
    frontend/site/ — Public site (Astro)
    frontend/docs/         — Documentation site (Astro)
    frontend/game/         — PixiJS v8 + bitECS (merged into client)
    backend/firebase/      — Firebase Cloud Functions v2
  packages/
    shared/                — constants, logger, mocks, schemas, types, utils, parser
    backend/               — ai, auth, configs, database, svelte-kit, utils
    frontend/              — components, configs, repositories, services, utils, tanstack-db
    scripts/               — CI, setup, ops scripts
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
bun run tmux:start client

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

| Mode          | Project                | What it means                                                                                                                                             |
| ------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `emulator`    | `demo-aikami-emulator` | Fully local — Firebase emulators, no GCP. Safe to break.                                                                                                  |
| `staging`     | `aikami-dev`           | Live GCP project with real deployed services. Acts as staging — deployed Cloud Functions, live Firestore data. Can also run locally against live backend. |
| `production`  | `aikami-prod`          | Live production. Deploy with care.                                                                                                                        |

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
  // apps/frontend/client/src/lib/views/feature/view.svelte
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
</script>
```

---

## Svelte 5 + SvelteKit Conventions

### Svelte 5 Core: Runes ONLY

No `$:` syntax. No stores (`writable`, `readable`).

```typescript
let count = $state(0);              // State
let doubled = $derived(count * 2);  // Derived
$effect(() => { console.log(count); }); // Side effects
```

Props:

```svelte
let { user, theme = 'dark' } = $props();
let { value = $bindable() } = $props();
```

Event handlers use HTML `onclick`, not Svelte 4 `on:click`:

```svelte
<button onclick={handleClick}>Click</button>
```

Always use `<script lang="ts">`. All `.svelte.ts` files (ViewModels) are
first-class TypeScript modules with Svelte 5 rune support.

### ViewModel Pattern

**Views have zero logic** — they are pure HTML/Svelte wrappers. No conditionals,
no data transformation, no `onMount`. Every expression in the view template
must be a direct property access on the ViewModel.

**ViewModels are thin bridges to services** — orchestrate service calls, expose
state to the view, but never contain heavy business logic, import repositories,
or call API/firebase functions directly. That belongs in services.

#### 🔴 CRITICAL: View Structural Constraints

- ❌ **Zero script imports** from services, network clients, repositories
- ❌ **No local `$state`** — all state belongs in the ViewModel
- ❌ **No `$derived`** — computed values belong in the ViewModel as getters
- ❌ **No `onMount`** — initialization goes in `ViewModel.initialize()`
- ❌ **No inline event logic** — handlers delegate to ViewModel methods
- ❌ **No destructuring** the `viewModel` prop

#### ViewModel Template

```typescript
// apps/frontend/client/src/lib/views/feature/feature_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from "$lib/components/BaseViewModel.svelte";
import { myService } from "$services/my_service";

export type FeatureViewModelInterface = BaseViewModelInterface & {
  readonly items: string[];
};

export type FeatureViewModelOptions = BaseViewModelOptions & {};

export class FeatureViewModel
  extends BaseViewModel<FeatureViewModelOptions>
  implements FeatureViewModelInterface
{
  items = $state<string[]>([]);

  async initialize(): Promise<void> {
    this.debug("initialize");
    this.items = myService.getItems();
  }
}

export const getFeatureViewModel = (
  options: FeatureViewModelOptions,
): FeatureViewModel => {
  return new FeatureViewModel(options);
};
```

#### ViewModel Rules

- Export `type ...Interface` with **all properties `readonly`**
- Export `type ...Options` alongside the class
- Export a `getFeatureViewModel` factory function
- Always extend `BaseViewModel` and `implements *Interface`
- ViewModel files: `{name}_view_model.svelte.ts` (NOT `vm` shorthand)
- Call `super.initialize()` **at the end** of `initialize()`
- Use `registerEffectRoot()` for reactive side effects (NEVER raw `$effect` in views)
- Views access data only through the ViewModel

### Services Architecture

Singleton classes with `$state` for external state management. Never use
Svelte stores.

```typescript
// packages/frontend/services/src/lib/my_service.svelte.ts
import { BaseClass, type BaseClassInterface } from "@aikami/utils";

export type MyServiceInterface = BaseClassInterface & {
  readonly items: string[];
  loadItems: () => Promise<void>;
};

export class MyService extends BaseClass implements MyServiceInterface {
  items = $state<string[]>([]);

  async loadItems(): Promise<void> {
    this.debug("loadItems");
  }
}

export const myService: MyServiceInterface = new MyService({
  className: "MyService",
});
```

#### Native Getters Over `$derived`

```typescript
// ❌ WRONG — $derived on self-referential field
isLoggedIn = $derived(!!this.currentUser);

// ✅ CORRECT — native getter
get isLoggedIn(): boolean { return !!this.currentUser; }
```

Exception: heavy computations (translation, mapping) stay in `$derived(...)`.

### Import Aliases (client only)

| Alias       | Resolves to                                                   |
| ----------- | ------------------------------------------------------------- |
| `$lib`      | `apps/frontend/client/src/lib`                                   |
| `$types`    | `apps/frontend/client/src/lib/types` (app-local types)           |
| `$services` | `apps/frontend/client/src/lib/client/services/index.ts` (barrel) |
| `$logger`   | Environment-specific logger                                   |
| `$views`    | `$lib/views`                                                  |

`$services` is a barrel, never a directory — always import from root.

---

## Backend Architecture

### Architecture Layers

```
Controller (thin) → Service (business logic) → Repository (data access) → BaseDatabaseService (abstraction)
```

### Repository Pattern

Every repository accepts a `BaseDatabaseService` via constructor injection.

```typescript
export class UserRepository {
  private readonly _collection = "users";

  constructor(private readonly _db: BaseDatabaseService) {
    if (!_db) throw new Error("UserRepository requires BaseDatabaseService");
  }

  async findById(id: string): Promise<UserDocument | undefined> {
    if (!id) throw new Error("id is required");
    return this._db.getDocument<UserDocument>(this._collection, id);
  }
}
```

#### Rules

- Constructor injection: `constructor(private readonly _db: BaseDatabaseService)`
- Guard clauses first
- Never import Firestore SDK directly — go through `BaseDatabaseService`
- Collection name as private field

### Service Layer

Services contain business logic, depend on repositories (never on database directly):

- Options object for constructor
- Depend on repositories, not database
- Business logic only — no HTTP concerns, no Firestore SDK calls

### Controller Structure

Thin — parse input, call service, return response. One `export default` per file.
Use firestack wrappers: `onCall`, `onRequest`, `onCreated`, etc.

### Backend Testing

- Tests in `tests/` at project root (not `src/__tests__/`)
- Use `bun:test`
- Mock `BaseDatabaseService`, never Firestore SDK directly
