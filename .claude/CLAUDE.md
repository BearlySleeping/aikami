# Aikami Monorepo Developer Guide

**tl;dr**: Bun monorepo orchestrated by Moon. Run `moon check` to typecheck + lint everything. Read `.pi/skills/` for detailed conventions.

---

## Build System

This is a **Bun + Moon monorepo** with strict TypeScript and Biome linting.

| Tool           | Role                                                      |
| -------------- | --------------------------------------------------------- |
| **Bun**        | Package manager & test runner (`bun install`, `bun test`) |
| **Moon**       | Task orchestrator (`moon.yml` in each workspace)          |
| **Biome**      | Linter & formatter (`biome.json`, runs in CI + IDE)       |
| **TypeScript** | Type checking (strict mode, enforced in Moon tasks)       |

---

## Getting Started

### Prerequisites

- Bun 1.0+ (`bun --version`)
- Node.js 18+ (for tooling compatibility)
- direnv (optional, for `.envrc`)

### Install & Dev

```bash
# Install dependencies
bun install

# Type-check + lint + format (local, fast)
moon check

# Run dev server (frontend)
moon run frontend:dev

# Run backend locally (Firebase emulator)
moon run backend:emulate

# Run all tests
bun test

# Run tests in one package
bun test packages/backend/auth/tests/
```

---

## Project Structure

```
aikami/
├── apps/                    # Applications
│   ├── backend/firebase/    # Cloud Functions (TypeScript)
│   ├── backend/{text,voice,image}/  # Local microservices
│   ├── frontend/
│   │   ├── client/          # Tauri SPA (SvelteKit + Svelte 5)
│   │   ├── docs/            # Marketing site (Astro)
│   │   └── hub/             # Admin dashboard (SvelteKit)
│   └── e2e/                 # End-to-end tests (Playwright)
│
├── packages/                # Shared libraries
│   ├── backend/             # Backend utilities, services, patterns
│   │   ├── auth/
│   │   ├── configs/
│   │   ├── database/
│   │   └── ...
│   ├── frontend/            # Frontend services, components
│   │   ├── components/
│   │   ├── engine/          # Game engine (PixiJS)
│   │   ├── services/
│   │   └── ...
│   └── shared/              # **Source of truth for types, schemas**
│       ├── constants/
│       ├── logger/
│       ├── schemas/         # TypeBox schemas (shared validation)
│       ├── types/           # Domain types (Agent, User, etc.)
│       └── ...
│
├── scripts/                 # Build + deploy scripts (Bun/Node)
├── .pi/                     # Claude Code config
│   ├── skills/              # Development conventions (read first!)
│   └── settings.json        # Claude Code project settings
├── biome.json               # Linter/formatter rules
├── moon.yml                 # Moon root workspace config
└── tsconfig.json            # TypeScript config (strict mode)
```

---

## Key Conventions

**Read these skills FIRST before writing code:**

1. **`aikami-conventions`** — 🔴 Universal rules: logger, imports, types, strict TS, monorepo boundaries
2. **`backend-conventions`** — Backend: controller/service/repository layers, validation, testing
3. **`svelte-conventions`** — Frontend: Views (logicless) + ViewModels, services, Runes, `.svelte.ts`
4. **`aikami-ui`** — UI: Tailwind + DaisyUI conventions
5. **`firestack`** — Functions: deployment, emulators, security rules

All skills are in `.pi/skills/`. Load them via `/skill [name]` or read them directly.

### Critical Rules (enforced by Biome)

- ✅ **Types, not interfaces**: `type User = {...}` not `interface User`
- ✅ **Arrow functions only**: `const fn = () => {}` not `function fn() {}`
- ✅ **Snake_case file names**: `user_service.ts` not `userService.ts`
- ✅ **No direct Firestore SDK**: Go through `BaseDatabaseService`
- ✅ **Schemas in `packages/shared/schemas/`**: Never in `apps/**`
- ✅ **Private members use `_` prefix**: `private readonly _db: Db`

### Key Patterns

```typescript
// ✅ CORRECT: Options object for >1 parameter
const createUser = async (options: { email: string; name: string }) => {
	// ...
};

// ✅ CORRECT: Import types from package root
import type { User } from "@aikami/types";
import { userSchema } from "@aikami/schemas";

// ❌ WRONG: Never import from lib/ sub-paths
import type { User } from "@aikami/types/lib/user";
```

---

## Common Tasks

### Running Tests

```bash
# All tests
bun test

# Single package
bun test packages/backend/auth/tests/

# Watch mode
bun test --watch packages/backend/auth/
```

### Type Checking

```bash
# Check everything
moon check

# Just TypeScript
tsc --noEmit
```

### Linting & Formatting

```bash
# Lint + format check
biome check .

# Auto-fix
biome format --write .
biome lint --fix .
```

### Adding a New Package

```bash
# Copy template structure
mkdir -p packages/shared/[name]/src/lib
touch packages/shared/[name]/src/index.ts
touch packages/shared/[name]/package.json

# See new-project skill for full walkthrough
```

---

## Monorepo Boundaries

**Types, schemas, and constants live in `packages/shared/`.**

| What                       | Where                              | Import As           |
| -------------------------- | ---------------------------------- | ------------------- |
| Domain types (User, Agent) | `packages/shared/types/src/lib/`   | `@aikami/types`     |
| Validation schemas         | `packages/shared/schemas/src/lib/` | `@aikami/schemas`   |
| Global constants           | `packages/shared/constants/`       | `@aikami/constants` |
| App-specific code          | `apps/frontend/client/src/`        | Never re-export     |

**Never**:

- ❌ Define a type in `apps/frontend/client/src/lib/types/`
- ❌ Import from another app (e.g., `apps/frontend/hub/src/` into `apps/frontend/client/`)
- ❌ Define a schema in `apps/backend/firebase/src/features/`

---

## Tauri SPA Architecture

**The frontend is a static SPA in Tauri v2. NO server-side rendering.**

Forbidden (will fail CI):

- ❌ `+server.ts` (API routes)
- ❌ `+page.server.ts` (server data loading)
- ❌ `+layout.server.ts` (server layout data)

Correct:

- ✅ Client-side Firebase SDK (`getDoc`, `query`, etc.)
- ✅ Fetch to microservices (`/tts`, `/image`, `/transcribe`)
- ✅ Browser APIs (localStorage, IndexedDB, Web Audio)
- ✅ Tauri commands (`invoke('read_file')`)

---

## IDE Setup

### VS Code

Install:

- Biome extension (Biomejs)
- SvelteKit extension
- Tauri extension
- TypeScript Vue Plugin

Settings:

```json
{
	"editor.formatOnSave": true,
	"[typescript]": { "editor.defaultFormatter": "Biomejs.biome" },
	"[svelte]": { "editor.defaultFormatter": "svelte.svelte-vscode" },
	"typescript.enablePromptUseWorkspaceTsdk": true
}
```

### JetBrains IDEs (WebStorm, IntelliJ)

- Install Biome plugin (search "Biome" in plugins)
- Enable Biome as linter in Settings > Languages & Frameworks > TypeScript > Biome
- Install SvelteKit support

---

## CI/CD

GitHub Actions runs:

- `moon ci` — Full typecheck + lint + test pipeline
- Tests run on Node 18+, Bun 1.0+
- PR checks require all tests to pass
- Auto-publish to Firebase Functions on merge to `main`

See `.github/workflows/` for details.

---

## Troubleshooting

### Biome format conflicts with tsconfig

**Problem**: Biome formats differently than tsconfig expects.  
**Fix**: Run `biome check .` to validate, then `biome format --write .` to auto-fix.

### TypeScript `useImportType` vs. `.ts` imports

**Problem**: "Cannot find module" when importing a type.  
**Fix**: Use `import type { X } from "..."` (Biome enforces this).

### Firebase Functions cold start

**Problem**: Functions are slow to initialize.  
**Fix**: Avoid `await import()` for lazy loading. Static `import` is faster.

### Test isolation

**Problem**: Tests interfere with each other (state leaking).  
**Fix**: Use `beforeEach()` and `afterEach()` with `bun:test`. See `testing` skill.

---

## Learning Resources

- **Conventions**: `.pi/skills/aikami-conventions` (read first!)
- **TypeScript**: [Handbook](https://www.typescriptlang.org/docs/)
- **SvelteKit**: [Docs](https://kit.svelte.dev/)
- **Firebase**: [Docs](https://firebase.google.com/docs)
- **PixiJS**: `.pi/generated-skills/pixijs/` (60+ skills)
- **Tauri**: [Docs](https://tauri.app/docs/)

---

## Questions?

- Read `.pi/skills/` for detailed how-tos
- Check git log for examples: `git log --oneline --grep="C-" | head`
- Ask in team Slack or Discord
