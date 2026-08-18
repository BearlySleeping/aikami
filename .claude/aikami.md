# Aikami Monorepo — Claude Code Configuration

**This file is auto-loaded by Claude Code when working in the Aikami project.** It establishes the conventions and patterns I should follow for all code generation and reviews.

---

## Core Architecture

- **Frontend SPA**: Tauri v2 + SvelteKit (static, no server routes)
- **Backend**: Firebase Functions + microservices (text, voice, image)
- **Monorepo**: Bun + Moon orchestration
- **Validation**: TypeBox schemas in `packages/shared/schemas/`
- **Logging**: Environment-specific via `$logger` alias

---

## 🔴 Load These Skills BEFORE Writing Code

These are loaded from `.pi/skills/` and define non-negotiable patterns:

### Universal (ALL code)
- **aikami-conventions** — Logger, imports, types, TS strictness, monorepo boundaries, error handling
  - Types/schemas MUST be in `packages/shared/`
  - Never define domain types in `apps/**`
  - Use `type` not `interface`
  - Private members use `_` prefix
  - Arrow functions only, no bare `function`

### By Domain
- **backend-conventions** — Controller/Service/Repository layers, constructor injection, testing patterns
- **svelte-conventions** — Views (logicless) + ViewModel (`_view_model.svelte.ts`), Runes, services
- **aikami-ui** — Tailwind + DaisyUI, theme switching, component patterns
- **firestack** — Functions deployment, emulators, security rules, Data Connect
- **firestore-collection** — End-to-end scaffolding for new Firestore collections
- **testing** — Bun test setup, mocking, integration tests
- **new-project** — Scaffolding new packages/apps

### Framework-Specific
- **pixijs-v8** — PixiJS engine (60+ detailed skills in `.pi/generated-skills/pixijs/`)
- **tauri-v2** — Desktop shell, asset protocol, IPC
- **dataconnect** — Firebase Data Connect schema & generation

---

## Code Generation Preferences

### Style Rules (Enforced by Biome)
- ✅ **`const` for functions**: `const fn = () => {}`
- ✅ **`type` not `interface`**: `type User = { id: string }`
- ✅ **Snake_case files**: `user_service.ts`
- ✅ **No bare `function` declarations**: Use arrow functions
- ✅ **No non-null assertions (`!`)**: Use `satisfies` or guards instead
- ✅ **No `any` or `{}`**: Strict typing required
- ✅ **No direct `import Firestore`**: Use `BaseDatabaseService`
- ✅ **No `@sinclair/typebox` or `zod` in app code**: Import from `@aikami/schemas`

### Import Rules (Enforced by Biome)
- ✅ **Package root imports only**: `import { User } from "@aikami/types"` (NOT `@aikami/types/lib/user`)
- ✅ **Import types at file top**: Never inline `import("./types")`
- ✅ **Options object for >1 parameter**:
  ```typescript
  // ✅ CORRECT
  const create = async (options: { name: string; email: string }) => {};
  
  // ❌ WRONG
  const create = async (name: string, email: string) => {};
  ```

### Structural Rules (Enforced by Biome + aikami-conventions)
- ✅ **`src/index.ts` + `src/lib/`**: Every package has this structure
- ✅ **Private member prefix**: `private readonly _db: Db`
- ✅ **File path comment on line 1**:
  ```typescript
  // packages/backend/auth/src/lib/register.ts
  ```

### Logger Rules (Critical)
- ✅ **In classes (extends BaseClass)**: Use `this.debug()`, `this.info()`, `this.warn()`, `this.error()`, `this.log()` — inherited methods
- ✅ **In module functions**: `import { logger } from "$logger"` then `logger.debug()`
- ❌ **Never**: `import { logger } from "@aikami/logger"` — bypasses environment-specific resolution

---

## Monorepo Structure

```
aikami/
├── apps/
│   ├── backend/firebase/        # Cloud Functions (serverless)
│   ├── backend/{text,voice,image}/ # Microservices
│   ├── frontend/client/         # Tauri SPA (SvelteKit)
│   ├── frontend/docs/           # Marketing (Astro)
│   ├── frontend/hub/            # Admin dashboard
│   └── e2e/                     # End-to-end tests
├── packages/
│   ├── backend/                 # Backend libraries (auth, db, utils)
│   ├── frontend/                # Frontend libraries (services, components, engine)
│   └── shared/                  # **Types, schemas, constants (source of truth)**
│       ├── constants/
│       ├── logger/
│       ├── schemas/             # TypeBox schemas
│       ├── types/               # Domain types
│       └── ...
├── scripts/                     # Build/deploy scripts
├── .pi/                         # Claude Code config
│   ├── skills/                  # Development conventions
│   └── settings.json
├── biome.json                   # Linter/formatter
├── moon.yml                     # Task orchestration
└── tsconfig.json                # TypeScript config
```

**Golden rule**: If a type crosses app boundaries, define it in `packages/shared/types/` and create a TypeBox schema in `packages/shared/schemas/`.

---

## Tauri SPA Boundary

**The client is a static SPA — there is NO server-side rendering.**

Forbidden (will fail CI):
- ❌ `+server.ts`
- ❌ `+page.server.ts`
- ❌ `+layout.server.ts`

Data fetching patterns:
- ✅ Firebase SDK (`getDoc`, `query`, `collection`)
- ✅ Fetch to microservices (`http://localhost:3001/tts`)
- ✅ Browser APIs (localStorage, IndexedDB)
- ✅ Tauri commands (`invoke('read_file')`)

---

## When Code Generation Happens

Before I write or generate code:
1. ✅ Check if the type exists in `packages/shared/types/` — if not, ask to create it
2. ✅ Check if a schema exists in `packages/shared/schemas/` for cross-boundary types — if not, ask to create it
3. ✅ Verify the file path follows snake_case and is in the right package
4. ✅ Load the appropriate skill (backend-conventions, svelte-conventions, etc.)
5. ✅ Use arrow functions, `type`, and options objects
6. ✅ Never import from `lib/` sub-paths or use bare `function`

---

## Error Handling

Use `toAppError` from `@aikami/utils` to normalize errors:

```typescript
import { toAppError } from "@aikami/utils";

try {
  // ...
} catch (err) {
  throw toAppError({
    errorType: "validation",
    errorMessage: "Email already in use",
    cause: err,
  });
}
```

---

## CI/CD & Tooling

- **Test runner**: Bun (`bun test`)
- **Type checker**: tsc (`tsc --noEmit`)
- **Linter/Formatter**: Biome (`biome check .`, `biome format --write .`)
- **Task orchestration**: Moon (`moon check`, `moon ci`, `moon run [project]:[task]`)

---

## Project Documentation

See `.claude/CLAUDE.md` for:
- Getting started
- Common tasks
- Troubleshooting
- IDE setup

See `.pi/skills/` for detailed conventions and examples.

---

## What I Should NOT Do

- ❌ Define types in `apps/**` — they belong in `packages/shared/`
- ❌ Import from `lib/` sub-paths — use package root imports
- ❌ Use `interface` — always use `type`
- ❌ Use bare `function` — always use arrow functions
- ❌ Write `console.log()` in production code — use `this.debug()` or `logger.debug()`
- ❌ Import Firestore SDK directly — go through `BaseDatabaseService`
- ❌ Create schemas in `apps/backend/**` — they live in `packages/shared/schemas/`
- ❌ Use non-null assertions (`!`) — use `satisfies` or guards
- ❌ Write `+server.ts` or `+page.server.ts` in routes — it's a static SPA
- ❌ Inline dynamic imports — use static `import`

---

## Questions & Escalation

If unclear:
1. Load the relevant skill (e.g., `/skill backend-conventions`)
2. Check `.pi/skills/` for examples
3. Ask in conversation — I'll reference the skill

This file is version-controlled and shared with the team. Last updated: 2026-08-18.
