---
name: new-project
description: Scaffold a new project/app in the aikami monorepo with correct moon.yml, package.json, tsconfig, README, tests, and src structure. Use when asked to add a new package or application to the workspace.
---

# New Project Scaffolding Skill

Use this skill when adding a new project to the aikami monorepo — whether a shared package, backend package, frontend package, or application.

## Before You Start — What Already Exists

The monorepo has these **inherited defaults** in `.moon/tasks/all.yml`:

| Inherited Task | What It Does |
|---|---|
| `lint` | `bun run lint` — biome lint check |
| `format` | `bun run format` — biome format check |
| `typecheck` | `bun run typecheck` — `tsc --noEmit` |
| `fix` | `bun run fix` — `biome check --write .` |
| `validate` | Internal meta-task (deps: lint + format + typecheck) — do NOT define in moon.yml or package.json |

These tasks are automatically inherited by **every** project. You do NOT need to define them in your `moon.yml` or duplicate their `fileGroups` unless you need custom behaviour.

## 1. Directory & Registration

Create the project under the right top-level directory:

- **Shared packages**: `packages/shared/<name>/` (unless `stack` has a meaningful value, leave `stack` unset)
- **Backend packages**: `packages/backend/<name>/`
- **Frontend packages**: `packages/frontend/<name>/`
- **Apps**: `apps/backend/<name>/` or `apps/frontend/<name>/`

Register the project in `.moon/workspace.yml` under `projects:`:

```yaml
projects:
  project-id: "packages/backend/<name>"
```

The key (`project-id`) is the short name used in `dependsOn` across the monorepo.

## 2. moon.yml

### Pure Library (no custom tasks beyond inherited defaults)

Use this `moon.yml` structure when the project only needs `lint`, `format`, `typecheck`, `fix`, and `validate` (all inherited):

```yaml
# packages/backend/auth/moon.yml
$schema: 'https://moonrepo.dev/schemas/project.json'

language: 'typescript'
layer: 'library'
tags:
  - '<name>'
  - '<backend|frontend|shared>'
  - 'library'

project:
  name: '<package-name>'              # e.g. 'backend-auth' — matches moon key
  description: 'What this package does.'
  channel: '#<team>'
  owner: '<Team Name>'

dependsOn:
  - 'constants'
  - 'schemas'
  - 'types'
```

**Rules:**
- Do NOT include `fileGroups` or `tasks` sections — all inherited from `.moon/tasks/all.yml`
- Do NOT include `stack:` line unless it provides useful information (leave it off for shared packages)
- `project.name` is the short moon key, not the npm package name
- `tags` should include the package name, the domain type, and `library` for packages

### Library with Custom Tasks (e.g. `test`)

Only add `fileGroups` and `tasks` when you have a task **beyond** the inherited ones:

```yaml
# packages/backend/database/moon.yml
$schema: 'https://moonrepo.dev/schemas/project.json'

language: 'typescript'
layer: 'library'
tags:
  - 'database'
  - 'backend'
  - 'library'

project:
  name: 'backend-database'
  description: 'Database services and utilities for Firestore operations.'
  channel: '#backend'
  owner: 'Backend Team'

dependsOn:
  - 'constants'
  - 'schemas'
  - 'types'
  - 'logger'

fileGroups:
  tests:
    - 'tests/**/*'

tasks:
  test:
    command: 'bun run test'
    inputs:
      - '@group(sources)'     # inherited sources — OK to reference
      - '@group(tests)'        # custom file group for test files
      - '@group(configs)'      # inherited configs — OK to reference
```

**Rules:**
- Custom file groups only need to define what is NOT already in inherited groups
- You CAN reference `@group(sources)`, `@group(configs)`, `@group(root-configs)` in custom tasks — they're inherited from `.moon/tasks/all.yml`
- Do NOT re-define `lint`, `format`, `typecheck`, `fix`, or `validate` tasks — they're inherited

### Application (with dev server, build, and/or E2E tests)

```yaml
# apps/frontend/game/moon.yml
$schema: 'https://moonrepo.dev/schemas/project.json'

language: 'typescript'
layer: 'application'
tags:
  - 'game'
  - 'frontend'
  - 'application'
  - 'playwright'

dependsOn:
  - 'frontend-api-core'

toolchains:
  javascript: false         # use this if the app manages its own deps (non-Bun-proxy)

project:
  name: 'game'
  description: 'Standalone PixiJS + bitECS game with vanilla TypeScript frontend.'
  channel: '#frontend'
  owner: 'Frontend Team'

fileGroups:
  sources:
    - 'src/**/*'
    - 'index.html'
  configs:
    - 'package.json'
    - 'tsconfig.json'
    - 'tsconfig.test.json'
    - 'vite.config.*'
  tests:
    - 'tests/**/*'
    - 'playwright.config.*'
  unitTests:
    - 'src/**/*.test.ts'

tasks:
  dev:
    command: 'bun run dev'
    preset: 'server'
  build:
    command: 'bun run build'
    inputs:
      - '@group(sources)'
      - '@group(configs)'
    outputs:
      - 'dist'
  preview:
    command: 'bun run preview'
    preset: 'server'
  test:
    script: |
      bun run build && bun run preview & PID=$!; sleep 5; bun run test; RESULT=$?; kill $PID 2>/dev/null || true; exit $RESULT
    deps:
      - 'build'
    inputs:
      - '@group(tests)'
      - '@group(sources)'
  test-unit:
    command: 'bun run test:unit'
    inputs:
      - '@group(unitTests)'
      - '@group(sources)'
  test-e2e:
    script: 'bun run build && bun run preview & PID=$!; sleep 5; bun run test; RESULT=$?; kill $PID 2>/dev/null || true; exit $RESULT'
    deps:
      - 'build'
    inputs:
      - '@group(tests)'
      - '@group(sources)'
```

**Rules:**
- Do NOT define `lint`, `format`, `typecheck`, `fix`, or `validate` tasks — they're inherited
- Use `preset: 'server'` for long-running dev servers (moon won't cache them)
- For E2E tests, use the `script:` field to build → preview → test → cleanup
- Define `outputs:` for build tasks so moon can cache them
- Use `toolchains: javascript: false` when the project uses its own bundler (Vite, Astro, etc.) and should not be processed by moon's JS toolchain

### Firebase Functions App

```yaml
# apps/backend/firebase/moon.yml
$schema: 'https://moonrepo.dev/schemas/project.json'

language: 'typescript'
layer: 'application'
tags:
  - 'firebase'
  - 'application'

project:
  name: 'firebase'
  description: 'Backend Firebase project: Cloud Functions, Firestore Rules, and Data Connect.'
  channel: '#backend'
  owner: 'Backend Team'

dependsOn:
  - 'backend-configs'
  - 'backend-utils'
  - 'backend-database'
  - 'schemas'
  - 'types'
  - 'constants'
  - 'logger'

fileGroups:
  sources:
    - 'src/**/*'
    - 'scripts/**/*'
  configs:
    - 'firestack.json'
    - '*.ts'
  tests:
    - 'tests/**/*'
  deployment:
    - 'functions_cache.ts'

tasks:
  deploy:
    command: 'bun run deploy'
    inputs:
      - '@group(deployment)'
    options:
      cache: false
      runInCI: true
  test:
    command: 'bun run test'
    inputs:
      - '@group(sources)'
      - '@group(tests)'
      - '@group(configs)'
  test-rules:
    command: 'bun run test:rules'
    inputs:
      - '@group(sources)'
      - '@group(tests)'
      - '@group(configs)'
  emulate:
    command: 'bun run emulate'
    options:
      cache: false
      runInCI: false
  scripts:
    command: 'bun run scripts'
    options:
      cache: false
      runInCI: false
  logs:
    command: 'bun run logs'
    options:
      cache: false
      runInCI: false
```

## 3. package.json

### Package (library)

```json
{
  "name": "@aikami/<package-name>",
  "main": "src/index.ts",
  "scripts": {
    "lint": "biome lint .",
    "format": "biome format .",
    "typecheck": "tsc --noEmit",
    "fix": "biome check --write ."
  },
  "dependencies": {
    "@aikami/constants": "workspace:*"
  }
}
```

Add `"test": "bun test"` if the package has unit tests.

**Required scripts** (mapped by inherited moon tasks):
- `typecheck` — `tsc --noEmit`
- `lint` — `biome lint .`
- `format` — `biome format .`
- `fix` — `biome check --write .`

**Do NOT include:**
- `validate` script — this is a moon meta-task managed via `.moon/tasks/all.yml`

### App

```json
{
  "name": "@app/<app-name>",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "biome lint src",
    "format": "biome format src",
    "typecheck": "tsc --noEmit",
    "fix": "biome check --write src"
  },
  "dependencies": {}
}
```

For SvelteKit apps, the `typecheck` command is:
```json
"typecheck": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
```

## 4. tsconfig.json

> ⚠️ `baseUrl` is deprecated in recent TypeScript versions.
> Use `rootDir` + relative paths in the `paths` map instead.

Each project extends the appropriate base config and defines its own path aliases using **relative paths** from the config file's location.

### Key Rules

- **Never use `baseUrl`** — all path aliases are relative to the tsconfig file location
- Use `rootDir` set to the parent directory for proper project references
- For wildcard imports (`@aikami/<pkg>/*`), map to `src/lib/*` (the implementation directory)
- For exact imports (`@aikami/<pkg>`), map to `src/index.ts` (the public entry point)
- Include the package's **own** paths so consumers with package.json `main` or `exports` can resolve

### Shared Package (extends `tsconfig.base.json`)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Package Name",
  "extends": "../../../config/tsconfig/tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "..",
    "outDir": "dist",
    "paths": {
      "@aikami/<dep>": ["../<dep>/src/index.ts"],
      "@aikami/<dep>/*": ["../<dep>/src/lib/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Backend Package (extends `tsconfig.backend.json`)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Backend XYZ",
  "extends": "../../../config/tsconfig/tsconfig.backend.json",
  "compilerOptions": {
    "rootDir": "../..",
    "paths": {
      "@aikami/backend/<name>/*": ["./src/lib/*"],
      "@aikami/constants": ["../../shared/constants/src/index.ts"],
      "@aikami/constants/*": ["../../shared/constants/src/lib/*"],
      "@aikami/schemas": ["../../shared/schemas/src/index.ts"],
      "@aikami/schemas/*": ["../../shared/schemas/src/lib/*"],
      "@aikami/types": ["../../shared/types/src/index.ts"],
      "@aikami/types/*": ["../../shared/types/src/lib/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Frontend Package (extends `tsconfig.frontend.json`)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Frontend XYZ",
  "extends": "../../../config/tsconfig/tsconfig.frontend.json",
  "compilerOptions": {
    "rootDir": "../..",
    "outDir": "dist",
    "paths": {
      "@aikami/frontend/<name>/*": ["./src/lib/*"],
      "@aikami/constants": ["../../shared/constants/src/index.ts"],
      "@aikami/constants/*": ["../../shared/constants/src/lib/*"],
      "@aikami/types": ["../../shared/types/src/index.ts"],
      "@aikami/types/*": ["../../shared/types/src/lib/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### App (non-SvelteKit, e.g. game)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowJs": false,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["bun"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### Base Configs Reference

| Base Config | Path | When to Use |
|---|---|---|
| `tsconfig.base.json` | `config/tsconfig/tsconfig.base.json` | Shared packages (no DOM, strict TS) |
| `tsconfig.backend.json` | `config/tsconfig/tsconfig.backend.json` | Backend packages (extends base, ES2023) |
| `tsconfig.frontend.json` | `config/tsconfig/tsconfig.frontend.json` | Frontend packages (extends base, DOM lib) |
| `tsconfig.svelte-kit.json` | `config/tsconfig/tsconfig.svelte-kit.json` | SvelteKit apps (extends base, DOM lib) |

> The base configs (`backend.json`, `frontend.json`, `svelte-kit.json`) no longer carry shared path aliases.
> Each project defines its own `paths` using relative references.

### Path Resolution Rules

Given the tsconfig at `packages/backend/auth/tsconfig.json`:

```json
"compilerOptions": {
  "rootDir": "../..",
  "paths": {
    "@aikami/backend/auth/*": ["./src/lib/*"],       // this package's lib/
    "@aikami/backend/database": ["../database/src/index.ts"],  // sibling index
    "@aikami/backend/database/*": ["../database/src/lib/*"],   // sibling lib/
    "@aikami/types": ["../../shared/types/src/index.ts"],      // shared index
    "@aikami/types/*": ["../../shared/types/src/lib/*"]        // shared lib/
  }
}
```

- `"./src/lib/*"` → `packages/backend/auth/src/lib/*`
- `"../database/src/lib/*"` → `packages/backend/database/src/lib/*`
- `"../../shared/types/src/lib/*"` → `packages/shared/types/src/lib/*`

### `$logger` Alias

Every project that uses logging MUST add a `$logger` path alias that points
to the correct environment-specific implementation. Never import from
`@aikami/logger` directly.

```json
{
  "compilerOptions": {
    "paths": {
      "$logger": ["../../shared/logger/src/lib/<env_impl>.ts"]
    }
  }
}
```

Choose the right implementation:

| Environment | Implementation file |
|---|---|
| SvelteKit (PWA) | `shared/logger/src/lib/svelte_kit.ts` |
| Firebase Functions | `shared/logger/src/lib/logger_functions.ts` |
| Browser (game, landing) | `shared/logger/src/lib/logger_browser.ts` |
| AWS / Node.js | `shared/logger/src/lib/logger_aws.ts` |

```typescript
// ✅ ALWAYS — use the $logger alias
import { logger } from "$logger";

// ❌ NEVER — direct package import
import { logger } from "@aikami/logger";
```

## 5. src Structure

```
src/
├── index.ts        # Public entry point — re-exports from lib/
├── lib/            # Implementation modules
│   ├── <feature>.ts
│   └── ...
└── __tests__/      # Optionally co-located test files (*.test.ts)
```

**Rules:**
- `src/index.ts` re-exports public API from `src/lib/` — do NOT put implementation directly in `index.ts`
- Use `src/lib/` for all implementation modules
- Keep directory depth flat in `src/lib/` — avoid sub-folders unless there's a clear grouping (e.g., `lib/clients/`, `lib/services/`)
- Do NOT put test files next to source files in `src/lib/` — use a `tests/` directory at project root or a `__tests__/` directory alongside

Example `src/index.ts`:

```typescript
// packages/shared/parser/src/index.ts
export { extractMacros, hasUnclosedMacro, stripMacros, tokenizeLine } from "./lib/lexer.js";
export { buildSystemMessage, createStreamBuffer, flushStreamBuffer, parseLine, parseStreamChunk } from "./lib/parser.js";
export type { ASTNode, CommandNode, MacroNode, ParseNode, ParseResult, TextNode } from "./lib/types.js";
```

## 6. Tests Structure

```
tests/
├── <feature>.test.ts      # bun:test unit tests
└── ...
```

**Rules:**
- Place tests in `tests/` at project root (not in `src/`)
- Use `bun:test` for all unit tests
- Naming: `<description>.test.ts`
- Run via `bun test` in package.json
- Only write tests for packages that have a `test` script in package.json and a `test` task in moon.yml

Example test:

```typescript
// packages/shared/parser/tests/parser.test.ts
import { describe, expect, test } from "bun:test";
import { extractMacros } from "../src/index.ts";

describe("extractMacros", () => {
  test("should extract macros from text", () => {
    const result = extractMacros("Hello {{name}}!");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("name");
  });
});
```

## 7. README Structure

Every project needs a `README.md` at its root. Follow this template:

```markdown
# @aikami/<package-name>

One-line summary of what this package does.

## Use Case

2-4 bullet points explaining what this package provides.

## Where It's Used

Which apps/packages depend on this. E.g. "Used by `apps/frontend/pwa` and any frontend code that needs X."

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` — What it provides
- `@aikami/schemas` — What it provides

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsc --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test` | Run tests (if applicable) |

## Usage

```typescript
import { someFunction } from '@aikami/<package-name>';
```

## Project Structure

```
src/
├── index.ts      # Public entry point
└── lib/           # Implementation modules
```

(skip this section for simple packages — include it for apps or complex packages)

## Architecture

Brief description of internal architecture (for complex packages/apps).
```

**Rules:**
- The task table always lists the actual command (e.g. `tsc --noEmit`), not the npm script name
- Include `fix` row (inherited from .moon/tasks/all.yml)
- Include `test` row only if the package has a test task
- For apps, also include `dev`, `build`, `preview` rows
- The `## Where It's Used` section is optional but helpful for new developers

## 8. Checklist

When scaffolding a new project:

- [ ] Directory created under correct top-level `packages/backend|frontend|shared/<name>/`
- [ ] Registered in `.moon/workspace.yml`
- [ ] `moon.yml` written with correct `project.name`, `dependsOn`, and only non-default tasks
- [ ] `package.json` with required scripts, deps, and workspace name
- [ ] `tsconfig.json` extending correct base config
- [ ] `src/index.ts` re-exporting from `src/lib/`
- [ ] `README.md` with use case, deps, tasks, usage
- [ ] `tests/` directory (if tests needed)

## 9. Common Pitfalls

These mistakes are easy to make when scaffolding. **Check for them before finishing.**

### ❌ Source Files in `src/` Instead of `src/lib/`

The entry point `src/index.ts` re-exports from `src/lib/`. Implementation files
MUST live in `src/lib/`, not directly in `src/`.

```
✅ CORRECT                    ❌ WRONG
src/                          src/
├── index.ts                  ├── index.ts
└── lib/                      ├── lexer.ts      ← should be in lib/
    ├── lexer.ts              ├── parser.ts     ← should be in lib/
    └── parser.ts             └── types.ts      ← should be in lib/
```

### ❌ Importing from `lib/` Sub-Paths

Never import from `@aikami/<package>/lib/<file>`. Always import from the
package root (maps to `src/index.ts`):

```typescript
// ✅ CORRECT
import type { CommandNode } from "@aikami/schemas";
import { CommandNodeSchema } from "@aikami/schemas";

// ❌ WRONG
import type { CommandNode } from "@aikami/schemas/lib/parser";
```

Tree-shaking handles unused exports — `lib/` is an implementation detail.

### ❌ Using `interface` Instead of `type`

Use `type` aliases everywhere. Only use `interface` for polymorphic OOP
contracts (e.g., `BaseDatabaseService` interface implemented by multiple
engine-specific classes).

```typescript
// ✅ CORRECT
export type ParseResult = {
  nodes: ASTNode[];
  raw: string;
};

// ❌ WRONG
export interface ParseResult {
  nodes: ASTNode[];
  raw: string;
}
```

### ❌ Using `function` Keyword Instead of Arrow Functions

All standalone functions must use arrow syntax. Class methods are the exception:

```typescript
// ✅ CORRECT — arrow for standalone functions
export const parseLine = (line: string): ParseResult => {
  // ...
};

// ✅ CORRECT — regular method for classes (this/super)
export class MyService {
  async loadItems(options: { filter: string }) {
    this.debug("loadItems", options);
  }
}

// ❌ WRONG — function keyword
export function parseLine(line: string): ParseResult {
  // ...
}

// ❌ WRONG — arrow class field (no super, per-instance copy)
export class MyService {
  loadItems = async (options: { filter: string }) => {
    this.debug("loadItems", options);
  };
}
```

### ❌ Missing `as const` on Object Literals

Object literals that represent constants, patterns, or configs should use
`as const` for narrowest type inference:

```typescript
// ✅ CORRECT
const PATTERNS = {
  command: /^\/([\w-]+)(?:\s+(.+))?$/s,
  macro: /\{\{([\w-]+)(?::\s*([^}]*))?\}\}/g,
} as const;

// ❌ WRONG
const PATTERNS = {
  command: /^\/([\w-]+)(?:\s+(.+))?$/s,
  macro: /\{\{([\w-]+)(?::\s*([^}]*))?\}\}/g,
};
```

### ❌ Missing JSDoc on Exported Functions

All exported functions and types must have JSDoc comments:

```typescript
// ✅ CORRECT
/**
 * Parse a user-input line into AST nodes.
 *
 * @param line - The raw input string from the user.
 * @returns Parsed nodes and optional command reference.
 */
export const parseLine = (line: string): ParseResult => {
  // ...
};

// ❌ WRONG — no JSDoc
export const parseLine = (line: string): ParseResult => {
  // ...
};
```
