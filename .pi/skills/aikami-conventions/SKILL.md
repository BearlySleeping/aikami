---
name: aikami-conventions
description: >-
  🔴 LOAD BEFORE writing ANY Aikami code — TypeScript and monorepo conventions
  including critical violations (logger, imports, types), strict TS rules, import
  path discipline, arrow functions, `as const` / `satisfies`, error handling,
  validation boundaries, project structure, private member naming, file naming,
  output style, and direnv environment.
version: 3.0.0
tags: ["aikami", "conventions", "typescript", "monorepo", "critical"]
---

# Aikami Conventions

**🔴 READ BEFORE WRITING ANY CODE.** These rules are non-negotiable. Violations
break the build, cause esbuild/aliasing errors, or produce code that won't
compile. Load this skill first, before touching any file.

For framework-specific patterns, also load:

| Skill | Covers |
|-------|--------|
| `svelte-conventions` | Svelte 5 runes, ViewModel pattern, services, import aliases |
| `backend-conventions` | Firebase Functions, backend services, security rules |
| `pixijs-v8` | PixiJS v8 + bitECS, game engine boundary, ECS patterns |
| `firebase-functions` | Firebase Cloud Functions v2 best practices |
| `firestore-collection` | Scaffolding Firestore collections |

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

| Environment | `$logger` resolves to |
|---|---|
| SvelteKit (PWA) | `shared/logger/src/lib/svelte_kit.ts` |
| Firebase Functions | `shared/logger/src/lib/logger_functions.ts` |
| Browser (game, landing) | `shared/logger/src/lib/logger_browser.ts` |
| AWS / Node.js | `shared/logger/src/lib/logger_aws.ts` |

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

Types and schemas are data shapes, not business logic:

```typescript
// ❌ WRONG — type/schema defined in a service file
// apps/frontend/pwa/src/lib/client/services/game/game_state_service.ts
export type ActiveContextEntry = { entityId: string; ... };
export const ActiveSessionSchema = z.object({ ... });

// ✅ CORRECT — import from the schema/type layer
// apps/frontend/pwa/src/lib/client/services/game/game_state_service.ts
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

| Forbidden                  | Use Instead                                        |
| -------------------------- | -------------------------------------------------- |
| `any`                      | `unknown` + type guards                            |
| `null`                     | `undefined` everywhere                             |
| `!` (non-null assertion)   | Early returns or optional chaining                 |
| `as unknown as Type`       | Proper data transformation functions               |
| `interface`                | `type` alias                                       |
| Exporting single-use types | Define near/inside the function that uses it       |
| `function` declarations    | Arrow functions (`const fn = () => {}`)            |

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
- **Debug Logging** — Every function must call `logger.debug('{methodName}', options)` at the start, passing the function name as a string. Skip for trivial one-liners (simple getters, passthroughs, pure computed values).

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

### Debug Logging Pattern

```typescript
// ✅ Standard pattern — logger.debug first line with method name and options
const loadItems = async (options: { filter: string }) => {
  logger.debug("loadItems", options);
  // ... implementation
};

// ✅ Class method — regular method syntax (access to this/super)
class MyService extends BaseClass {
  async loadItems(options: { filter: string }) {
    this.debug("loadItems", options);
    // ... implementation
  }
}

// ✅ Skip debug logging for trivial functions
const isActive = () => this.status === "active";
const getFullName = () => `${this.firstName} ${this.lastName}`;
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
import type { User } from "$types";              // maps to @aikami/types → src/index.ts
import { userSchema } from "@aikami/schemas";    // maps to src/index.ts

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
- `apps/frontend/pwa/svelte.config.js` — Vite/SvelteKit aliases
- `apps/backend/firebase/tsconfig.json` — Functions tsconfig paths
- All `import` statements referencing these packages

The pattern `@aikami/backend/<name>` keeps sub-package imports consistent
with `@aikami/backend/auth/*`, `@aikami/backend/configs/*`, etc.

### Wildcard Imports (Only When Needed)

```typescript
// ✅ Only use wildcard when you genuinely need multiple sub-module exports
import * as v from "valibot";
import * as z from "zod";
```

---

## Type Definitions — Where Types and Schemas Live

See CRITICAL VIOLATION #3 above. Additional details:

| Location | What goes there |
|---|---|
| `packages/shared/schemas/` | Zod schemas (cross-project data validation) |
| `packages/shared/types/` | Cross-project types (used by 2+ apps/packages) |
| `apps/<app>/src/lib/types/` | Single-app types (100% specific to one app) |
| Inline / top of file | Single-method type used in exactly one function |

### Schema-First: Derive Types from Zod Schemas

When data crosses project boundaries (service ↔ ViewModel, backend ↔ frontend),
define a Zod schema in `@aikami/schemas` first, then derive the TypeScript
type from it:

```typescript
// packages/shared/schemas/src/lib/api/chat.ts
import { z } from "zod";

export const ChatMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  timestamp: z.number(),
});

// packages/shared/types/src/lib/api/chat.ts
import type { z } from "zod";
import { ChatMessageSchema } from "@aikami/schemas";

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
```

This ensures runtime validation and TypeScript types are always in sync. The
schema in `@aikami/schemas` is the source of truth; `@aikami/types` re-exports
the inferred type.

**Rule of thumb**: If a type is passed from one project to another, it should
exist as a Zod schema in `@aikami/schemas` and be re-exported as a type from
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

### Server-Side (Zod)

All server-side runtime validation (Firebase Functions, API boundaries) uses Zod from `@aikami/schemas`:

```typescript
import { z } from "zod";
import { userSchema } from "@aikami/schemas";
```

### Client-Side (Valibot)

Client-side perimeter validation uses Valibot for lightweight, tree-shakeable validation:

```typescript
import * as v from "valibot";
import { userSchema } from "@aikami/valibot-schemas";
```

**Rule**: Zod stays on the server; Valibot is preferred on the client (PWA).

---

## Project Structure

```
aikami/
  apps/
    frontend/pwa/          — SvelteKit PWA
    frontend/landing_page/ — Landing page (Astro)
    frontend/docs/         — Documentation site (Astro)
    frontend/game/         — PixiJS v8 + bitECS game engine
    backend/firebase/      — Firebase Cloud Functions v2
  packages/
    shared/                — constants, logger, mocks, schemas, types, utils, valibot-schemas, parser
    backend/               — ai, auth, configs, database, svelte-kit, utils
    frontend/              — components, configs, repositories, services, utils, tanstack-db
    scripts/               — CI, setup, ops scripts
```

---

## Moon Commands

Use extension tools: `validate()` for fix+typecheck+build+test, `moon_detect_affected` before tests.

```bash
bun moon run pwa:dev              # Start PWA dev server
bun moon run :typecheck            # Type-check all projects
bun moon run :lint                 # Lint all projects
bun moon run :fix                  # Auto-fix lint issues
bun moon run :test                 # Run all tests
bun moon run :validate             # Full CI validation
```

---

## Direnv Development Environment

The project uses direnv for deterministic, zero-setup development. Environment
variables are always available via the loaded `.envrc`. All pi extensions
inherit this environment.

| Variable                   | Source                  | Purpose                               |
| -------------------------- | ----------------------- | ------------------------------------- |
| `AIKAMI_MODE`              | `.env.local` or default | emulator / development / production   |
| `AIKAMI_PROJECT_ID`        | Resolved from mode      | GCP project id for current mode       |
| `AIKAMI_IS_EMULATOR`       | Resolved from mode      | "1" = local emulators, "0" = live GCP |
| `AIKAMI_NIX_READY`         | flake.nix shellHook     | "1" when Nix devShell loaded          |
| `GEMINI_API_KEY`           | GSM or mock             | Gemini API key for AI features        |
| `PLAYWRIGHT_BROWSERS_PATH` | Nix flake               | Playwright browsers from Nix          |

### Mode Switching

| Mode | Project | What it means |
|------|---------|---------------|
| `emulator` | `demo-aikami-emulator` | Fully local — Firebase emulators, no GCP. Safe to break. |
| `development` | `aikami-dev` | Live GCP project with real deployed services. Acts as staging — deployed Cloud Functions, live Firestore data. Can also run locally against live backend. |
| `production` | `aikami-prod` | Live production. Deploy with care. |

```bash
aikami_switch emulator     # Local emulators, no GCP
aikami_switch development  # Live staging (aikami-dev)
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
// apps/frontend/pwa/src/lib/views/feature/view_model.svelte.ts
import { BaseViewModel } from "$lib/components/BaseViewModel.svelte";
```

**Svelte `.svelte` files** — first line inside `<script>`:

```svelte
<script lang="ts">
  // apps/frontend/pwa/src/lib/views/feature/view.svelte
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
</script>
```
