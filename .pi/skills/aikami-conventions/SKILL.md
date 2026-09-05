---
name: aikami-conventions
description: >-
    🔴 LOAD BEFORE writing ANY Aikami code — universal TypeScript and monorepo
    conventions: architecture pillars, logger, import discipline, dynamic
    imports, where types/schemas/constants live, strict TS rules, guarded type
    assertions, arrow functions, class structure, `as const` / `satisfies`,
    error handling, naming, and file-path comments. For frontend load
    svelte-conventions; for backend load backend-conventions; for commands and
    dev environment load project-commands.
version: 6.0.0
tags: ["aikami", "conventions", "typescript", "monorepo", "critical", "monorepo-boundaries"]
---

# Aikami Conventions

**🔴 READ BEFORE WRITING ANY CODE.** These rules are non-negotiable. Violations
break the build, cause esbuild/aliasing errors, or fail a guard in CI. If you
hit an esbuild error about a missing module, **the fix is never to bypass the
convention. The convention is the fix.**

This skill contains ONLY universal rules. Also load:

| Working on…                    | Load                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| **Frontend (client, Svelte)**  | `svelte-conventions` — runes, Views/ViewModels, `$services`   |
| **Backend (server plane)**     | `backend-conventions` — D1/Drizzle, R2, Better Auth, Worker   |
| UI styling                     | `aikami-ui`                                                   |
| Game engine                    | `pixijs-v8`                                                   |
| Tauri desktop                  | `tauri-v2`                                                    |
| New SvelteKit page             | `svelte-page`                                                 |
| Commands, moon, direnv, modes  | `project-commands`                                            |

---

## 🔴 ARCHITECTURE PILLARS

Four pillars govern all code. Pillars 1–2 are enforced here; 3–4 in
`svelte-conventions`.

### Pillar 1: Tauri SPA — No Server Routes

The client is a **static SPA** (`adapter-static`) in Tauri v2. No SvelteKit
server exists in production. These files must **never** appear under
`apps/frontend/client/src/routes/` — CI rejects any PR containing them:

`+server.ts` · `+page.server.ts` · `+layout.server.ts`

Data comes from the repository layer (Turso/libSQL on device), `fetch` to the
local microservices, browser APIs, or Tauri commands.

> The hub (`apps/frontend/hub`) is a different app — it *is* SSR on a
> Cloudflare Worker and server routes are correct there.

### Pillar 2: Monorepo Boundaries — Shared Packages Only

**Domain types, schemas, and global constants must never be defined inside
`apps/**`.** They live in `packages/shared/` and are consumed via `@aikami/*`.

#### 🔴 Allocation Truth Matrix — exactly ONE canonical location each

| What                          | Lives in                                    | Import as           | Does NOT belong there                                            |
| ----------------------------- | ------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| Constants, labels, registries | `packages/shared/constants/`                | `@aikami/constants` | Runtime state, computed values, ViewModel-local UI strings       |
| Cross-project domain types    | `packages/shared/types/`                    | `@aikami/types`     | Single-app types, single-function types, ViewModel interfaces    |
| Runtime schemas (TypeBox)     | `packages/shared/schemas/`                  | `@aikami/schemas`   | Zod (banned), single-function inline guards                      |
| Single-app types              | `apps/<app>/src/lib/types/`                 | `$types` (client)   | Anything a second package imports                                |
| App-local data configs        | `apps/<app>/src/lib/data/`                  | relative            | Anything shared across apps                                      |
| UI state flags                | the ViewModel — see `svelte-conventions`    | —                   | —                                                                |
| Single-use types              | inline, next to the function that uses it   | —                   | Exported anywhere                                                |

```typescript
// ❌ WRONG — domain type or schema defined under apps/**
export type Agent = { id: string; name: string };
export const agentSchema = z.object({ id: z.string() });

// ✅ CORRECT
import type { Agent } from "@aikami/types";
import { agentSchema } from "@aikami/schemas";
import { MAX_RETRIES } from "@aikami/constants";
```

**If a type is missing**, add it to `packages/shared/types/` first. If it
crosses a boundary (backend ↔ frontend), add the TypeBox schema too. Never
define it locally as a shortcut.

### Pillars 3 & 4: Svelte MVVM + Dev Sandboxes

Enforced in `svelte-conventions`. Pillar 3: Views are completely logicless —
state and logic live in `_view_model.svelte.ts`. Pillar 4: `routes/(dev)/`
sandboxes use the `DevViewModel` override pattern.

---

## 🔴 CRITICAL VIOLATIONS

### 1. Logger: `this.debug()` in Classes, `$logger` in Module Functions

1. **Inside any `BaseClass`/`BaseViewModel` subclass** — use the inherited
   `this.debug()` / `.info()` / `.warn()` / `.error()` / `.log()`. **Never**
   import `$logger` in these files; the inherited methods prefix the class
   name and integrate with `create()` auto-logging.
2. **Module-level code** (standalone arrow functions, utils, scripts) —
   `import { logger } from "$logger"`.

**Never `import { logger } from "@aikami/logger"`** — it bypasses
environment-specific resolution and breaks builds.

```typescript
// ✅ class code                          // ✅ module-level
class UploadService extends BaseClass {   import { logger } from "$logger";
  async upload(): Promise<void> {         const parseManifest = (raw: string) => {
    this.debug("upload:start");             logger.debug("parseManifest");
  }                                       };
}
```

**Why**: each environment maps `$logger` in its own `tsconfig.json` `paths`
(or `svelte.config.js`) to a different implementation — browser, SSR, or
basic. `@aikami/logger` is a package alias and can't know which you're in.

### 2. Import from Package ROOT, Never `lib/` Sub-Paths

```typescript
// ✅ CORRECT — package root maps to src/index.ts
import type { User, Session } from "@aikami/types";
import { toAppError } from "@aikami/utils";
import type { Connection } from "$types";

// ❌ WRONG — lib/ is an implementation detail
import type { User } from "@aikami/types/lib/user";
import type { Connection } from "$types/lib/connection";
```

`src/index.ts` is the public API surface. Importing from `lib/` bypasses the
barrel and can miss re-exports or renamed symbols.

**Backend sub-packages use a forward slash, never a hyphen** — enforced by
Biome `noRestrictedImports`:

```typescript
import { ChatService } from "@aikami/backend/chat";   // ✅
import { ChatService } from "@aikami/backend-chat";   // ❌
```

Same for `@aikami/frontend/<name>`. This applies to `import` statements and to
the alias maps in `svelte.config.js` and each `tsconfig.json`.

### 2b. Import Types at the Top, Never Inline `import()`

```typescript
// ✅                                        // ❌
import type { ItemDefinition } from "@aikami/types";
getItem(id: string): ItemDefinition;         getItem(id: string): import("@aikami/types").ItemDefinition;
```

Applies to **type-level** `import()` only — runtime `await import()` is
governed by the next rule.

### 🔴 3. Dynamic Imports: `await import()` — Avoid Unless Proven Necessary

The client is a static SPA. Dynamic imports do **not** reduce bundle size —
Vite bundles everything regardless. They fragment the bundle, add async
overhead, and cascade `async`/`await` through call stacks. **The default is a
static `import`.**

Ratcheted by CI guards (`guard-mvvm-conventions` M9, `guard-service-conventions`
S12): new occurrences outside this allowlist fail CI.

| ✅ Valid reason              | Example                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| Import-time side effects     | `@tauri-apps/api` — throws outside a Tauri webview         |
| Massive library (>500KB)     | `onnxruntime-web`, `kokoro-js`, `pixi.js` Assets           |
| Conditional provider         | AI client factory — only the chosen SDK loads              |
| Platform-specific code       | Tauri-only APIs, IndexedDB vs localStorage                 |
| Build-time branch            | `import.meta.env.SSR` — Vite tree-shakes the dead branch   |
| Web Worker                   | `?worker&type=module` — Vite requires it                   |
| Lazy data (>100KB JSON)      | Country lists, password dictionaries                       |
| Dev-only tools               | `eruda` — must never ship to production                    |
| Node built-ins               | `node:fs/promises` in CLI/build scripts only               |
| Optional native backends     | `@tursodatabase/database`                                  |

| ❌ NOT a valid reason         | Why                                                        |
| ----------------------------- | ---------------------------------------------------------- |
| Service-to-service lazy load  | Singletons, no import-time side effects. False async boundary. |
| "Performance" in a static SPA | More requests, not fewer                                   |
| Circular-dependency workaround| Masks an architecture problem — fix the graph               |
| "SSR guard" in the client     | Client is `ssr: false`; there is nothing to guard          |
| "Cold start" in the Worker    | Workers tree-shake unused exports at deploy; dynamic imports add fetch overhead without benefit |

### 4. Never Export Data, Types, or Schemas from Service Files

Services hold **business logic and state only**. A specific case of Pillar 2.
Enforced by `guard-service-conventions` (S9, S10).

The **only** permitted exports are the service's own interface, options type,
and singleton:

```typescript
export type MyServiceInterface = BaseClassInterface & { ... };
export type MyServiceOptions = { ... };
export const myService: MyServiceInterface = MyService.create({ className: "MyService" });
```

Re-exporting from the canonical source is acceptable for compatibility:

```typescript
export { TEXT_PROVIDERS, type TextProvider } from "@aikami/constants"; // ✅
```

### 5. File Naming: snake_case ONLY

Enforced by Biome `useFilenamingConvention`.

```
✅ auth_service.ts   view_model.svelte.ts   base_view.svelte
❌ authService.ts    ViewModel.svelte.ts    BaseView.svelte
```

### 5b. Identifiers: camelCase ONLY

Rule 5 governs **file names**. Variables, functions, parameters, object keys,
and class members are `camelCase` — enforced by Biome `useNamingConvention`.

```typescript
const userId = "abc";                    // ✅
const user_id = "abc";                   // ❌
const config = { apiKey: "x" };          // ✅   { api_key: "x" }  ❌
```

**Exceptions**: top-level constants use `UPPER_SNAKE_CASE` (`MAX_RETRIES`);
private class members take a single `_` prefix (Rule 6); environment variable
names (`AIKAMI_MODE`, `PUBLIC_ASSETS_BASE_URL`) follow platform convention and
are exempt.

### 6. Private Members: Underscore `_` Prefix

Every `private` field, method, getter, and setter takes a `_` prefix.

```typescript
class UserService {
  private readonly _userRepository: UserRepository;
  private _cache = new Map<string, User>();
  private _normalizeEmail(email: string): string { ... }
}
```

**Exception**: ViewModel `$state` fields are public by design — never prefix
them.

---

## TypeScript Strictness

### ❌ Forbidden — Use the Alternative

| Forbidden                  | Use instead                                  |
| -------------------------- | -------------------------------------------- |
| `any`                      | `unknown` + type guards                      |
| `null`                     | `undefined` everywhere                       |
| `!` (non-null assertion)   | Early return or optional chaining            |
| `interface`                | `type` alias                                 |
| `function` declaration     | Arrow function (`const fn = () => {}`)       |
| Exporting single-use types | Define next to the function that uses it     |
| Chained arguments (2+)     | An options object                            |
| Single-line `if`           | Always braces                                |
| Abbreviations              | Full words — `options` not `opts`            |
| Nested ternaries           | `if`/`else` or a helper                      |

### 🔴 Type Assertions Are Guarded

`as unknown as X`, `as any`, and `@ts-ignore` are blocked by
`guard-type-safety` (`bun run guard`). It is a **ratchet**: counts may only go
down, and any NEW occurrence fails CI.

If you reach for one, **the type is wrong** — fix the type:

- **Unknown external data** → `parseX(value: unknown): X | undefined` that
  validates against the TypeBox schema and returns `undefined` on mismatch.
- **Narrowing a checked union** → a type guard
  (`const isX = (v: unknown): v is X => ...`), not an assertion.
- **A library's types are wrong** → `@ts-expect-error` **with** a one-line
  reason, so it fails loudly once the library is fixed.
- **Plain `as X`** is acceptable only to narrow a union already discriminated
  in the same scope.

If a T1/T2 cast is genuinely unavoidable — not just inconvenient to fix —
add `// guard-ignore lint/type-safety/casting: <reason>` on the cast's own
line (or alone on the line above it), mirroring Biome's own
`// biome-ignore lint/<group>/<rule>: <reason>` convention, and the guard
excludes it entirely, no baseline entry needed. The reason after the colon
is mandatory; a bare `guard-ignore lint/type-safety/casting:` does not
suppress. This is a narrow escape hatch for real boundary casts, not a
substitute for a type guard — do not reach for it as the default way to
clear a violation.

### ✅ Required Patterns

- **Arrow functions everywhere.** Sole exception: class methods use regular
  method syntax (`methodName() {}`, never `methodName = () => {}`) so `this`
  and `super` work and `create()` auto-logging can see them.
- **Method shorthand in interfaces** — `closeUploadInfo(): void`, never
  `closeUploadInfo: () => void`.
- **Callers preserve `this`** — never pass an unbound method reference. Use
  `onclick={() => viewModel.open()}`, not `onclick={viewModel.open}`.
- **Escape early** — return-early instead of deep nesting.
- **Extract logic** — a self-contained block becomes a `_prefixed` private
  helper.
- **JSDoc every export** — classes, functions, types, and complex internals.
  Explain the *why*, not the *what*:
  ```typescript
  /**
   * Synchronizes the bitECS game state with the SvelteKit UI. Runs on a
   * worker thread so it never blocks the PixiJS loop.
   */
  export class EngineBridge { ... }
  ```

### Options Object Pattern

More than one argument → group into an options object.

```typescript
export const createUser = (options: {
  email: string;
  displayName: string;
  role?: string;
}): Promise<User> => { ... };                          // ✅

export const findById = (id: string): Promise<User | undefined> => { ... };  // ✅ single arg
export const createUser = (email: string, displayName: string) => { ... };   // ❌
```

### Class Member Order

1. Static fields → 2. Instance fields (private first) → 3. Constructor →
4. Public methods (core API, then getters/setters) → 5. Private/protected
methods.

### Class Instantiation — Always `ClassName.create()`, Never `new`

Every `BaseClass` subclass is built through the static `create()` factory.

```typescript
export const authService: AuthServiceInterface = AuthService.create({ className: "AuthService" }); // ✅
export const authService = new AuthService({ className: "AuthService" });                          // ❌
```

**Auto-logging**: `create()` shadows each public prototype method with a shim
that logs `methodName + args` before delegating (prototype shadowing, not a
Proxy — Svelte 5 `$state` breaks under custom Proxies). Only regular methods
participate, which is one more reason arrow-function fields are banned. In
production the wrapping is skipped entirely.

So **no manual `this.debug()` at method entry**. Mid-method logging for state
transitions and error branches is still right:

```typescript
async process(options: { id: string }) {
  // create() already logged: debug('process', options)
  const result = await this._fetch(options.id);
  if (!result) {
    this.debug("process:not-found", { id: options.id });   // ✅ contextual
    return;
  }
}
```

Standalone arrow functions don't participate — they still call
`logger.debug()` at entry.

### `as const` and `satisfies`

```typescript
const PATTERNS = { command: /^\/([\w-]+)/s } as const;                     // narrow inference
const CONFIG = { timeout: 5000, endpoint: "/api/v2" } as const
  satisfies Record<string, string | number>;                               // check without widening
```

---

## Import Order

1. Node/Bun built-ins (`node:fs`) → 2. External deps (`pixi.js`, `svelte`) →
3. Shared packages (`@aikami/types`) → 4. Absolute aliases (`$lib/...`) →
5. Relative (`./utils.ts`).

Let Biome's `organizeImports` sort it. Use a wildcard import only when you
genuinely need several sub-module exports.

---

## Types & Schemas — Schema-First

🔴 **TypeBox Static Inference Law**: when a TypeBox schema exists for a shape,
the TypeScript type MUST be derived via `Static<typeof Schema>` — never
hand-written. `@aikami/schemas` is the source of truth; `@aikami/types`
re-exports the inferred type.

```typescript
// packages/shared/schemas/src/lib/api/chat.ts
export const ChatMessageSchema = Type.Object({
  id: Type.String(),
  text: Type.String(),
});

// packages/shared/types/src/lib/api/chat.ts
export type ChatMessage = Static<typeof ChatMessageSchema>;   // ✅ derived

export type ChatMessage = { id: string; text: string };       // ❌ drifts silently
```

**Why**: a hand-written duplicate lets the runtime validator and the static
type diverge without a compiler error. Deriving guarantees lockstep.

**Rule of thumb**: if a type crosses a project boundary, it needs a TypeBox
schema in `@aikami/schemas` and a derived re-export from `@aikami/types`.
TypeBox validates at runtime and infers statically on both the Worker and the
client — no second validation library. **Zod is banned** (Biome
`noRestrictedImports`).

---

## Error Handling

```typescript
import { toAppError } from "@aikami/utils";
throw toAppError("not-found", "Resource not found");
```

Valid types: `not-found`, `invalid-argument`, `unauthorized`,
`unauthenticated`, `internal`, `captcha-required`.

---

## File Path Comments

Every source file opens with its repo-relative path.

```typescript
// apps/frontend/client/src/lib/views/feature/feature_view_model.svelte.ts
import { BaseViewModel } from "$components";
```

In `.svelte` files it is the first line **inside** `<script lang="ts">`.

---

## Output Style

**Terse. Technical substance only.** Drop articles, filler, hedging. Fragments
are fine. Write large generated content to a file and return the path plus a
one-line description rather than inlining it. Expand only for security
warnings, irreversible actions, or genuine user confusion. After validating,
give a 3–4 line summary: what changed, results, suggested commit message.

---

> **Commands, moon tasks, direnv modes, mode switching, commit & push policy**:
> see the `project-commands` skill.
> **Directory layout**: see the table in `AGENTS.md`.
