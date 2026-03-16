# AIKAMI - Developer Guidelines

This document provides quick reference and links to detailed skills. See individual skills for comprehensive guidelines.

## Project Overview

Aikami is a monorepo using **moon** for task orchestration, **Bun** as the runtime, and **SvelteKit** for the frontend PWA.

| Component          | Technology                     |
| ------------------ | ------------------------------ |
| Runtime            | Bun                            |
| Frontend           | SvelteKit 2, Svelte 5 (runes)  |
| Backend            | Firebase, SvelteKit API routes |
| Testing            | Playwright                     |
| Linting/Formatting | Biome                          |
| Task Runner        | moon                           |

---

## Moon Project Configuration

Every project in the monorepo **must** have a `moon.yml` that follows this standard:

```yaml
# packages/{project}/moon.yml
$schema: 'https://moonrepo.dev/schemas/project.json'

language: 'typescript'
layer: 'library'  # or 'application', 'tool'
tags:
  - '{project}'
  - 'shared'
  - 'library'

project:
  title: '{Title}'
  description: '{Description}.'
  channel: '#frontend'
  owner: 'Frontend Team'

fileGroups:
  sources:
    - 'src/**/*'
  configs:
    - 'package.json'
    - 'tsconfig.json'
  tests:
    - 'tests/**/*'

tasks:
  typecheck:
    command: 'bun run typecheck'
    inputs:
      - '@group(sources)'
      - '@group(configs)'

  format:
    command: 'bun run format'
    inputs:
      - '@group(sources)'
      - '@group(configs)'

  lint:
    command: 'bun run lint'
    inputs:
      - '@group(sources)'
      - '@group(configs)'

  test:
    command: 'bun run test'
    inputs:
      - '@group(sources)'
      - '@group(tests)'
      - '@group(configs)'

  fix:
    command: 'bun run fix'
    inputs:
      - '@group(sources)'
      - '@group(configs)'

  validate:
    command: 'bun run validate'
    inputs:
      - '@group(sources)'
      - '@group(tests)'
      - '@group(configs)'

  dev:
    command: 'bun run dev'
    inputs:
      - '@group(sources)'
      - '@group(configs)'
    options:
      runInWorkspace: false

  build:
    command: 'bun run build'
    inputs:
      - '@group(sources)'
      - '@group(configs)'
    options:
      runInWorkspace: false
```

### Key Rules

1. **All tasks use `bun run <script>`** - Never call binaries directly
2. **All scripts must be in `package.json`** - Moon delegates to package.json scripts
3. **Use `@group()` references** - Reference fileGroups for inputs
4. **`runInWorkspace: false`** for dev/build - Run in project dir, not workspace root
5. **Include all 7 standard tasks**: `typecheck`, `format`, `lint`, `test`, `fix`, `validate`, `dev`, `build`

---

## Quick Reference

```bash
# Before committing
bun moon run pwa:fix && bun moon run pwa:test

# CI validation
bun moon run :validate

# Development
bun moon run pwa:dev
```

---

## Skills

Load skills based on what you're working on:

| Task                     | Skill                      |
| ------------------------ | -------------------------- |
| Frontend development     | `skill:sveltekit`          |
| Backend/cloud functions  | `skill:firebase-functions` |
| Build/test/lint commands | `skill:project-commands`   |
| Code style & conventions | `skill:code-standards`     |
| Git workflow             | `skill:git-workflow`       |
| Token-optimized commands | `skill:rtk`                |
| Firebase CLI             | `skill:firestack`          |
| Config files             | `skill:config-development` |

---

## Key Principles

- Use **path aliases**: `$lib`, `$types`, `$services`, `$logger`, `$views`
- Use **Zod** for runtime validation
- Use **services** with Svelte 5 runes, never Svelte stores
- Views delegate to view models, never have local state
- All interfaces and component props require JSDoc comments

---

## Error Handling

Use **AppError** from `@aikami/utils`:

```typescript
throw toAppError("not-found", "Resource not found");
throw toAppError("invalid-argument", "Invalid email");
throw toAppError("unauthorized", "User not logged in");
```

Valid types: `not-found`, `invalid-argument`, `unauthorized`, `internal`, etc.

---

## Conventions & Anti-Patterns

To maintain a clean, predictable, and heavily standardized codebase, adhere to the following strict rules:

### Architecture & Svelte 5

- ❌ **Svelte stores** (`writable`, `readable`) → Use singleton services with `$state`.
- ❌ **Local `$state` in views** → All state belongs in the ViewModels.
- ❌ **`onMount` for initialization** → Use the `initialize()` method in your ViewModels instead.
- ❌ **Destructuring ViewModels** → Never destructure reactive properties (`const { show } = viewModel`). Always access them directly (`viewModel.show`) so Svelte tracks the read.
- ❌ **Using `$derived` to proxy external service state** → When exposing a service's reactive state through a ViewModel, **always use native getters** instead of `$derived`. `$derived` can lose tracking context on external class instances.
    - **❌ WRONG:** `confirmDialog = $derived(dialogService.confirmDialog);`
    - **✅ CORRECT:** `get confirmDialog() { return dialogService.confirmDialog; }`

### TypeScript Strictness

- ❌ **`any` type** → Use `unknown` and proper type guards.
- ❌ **`null`** → Prefer `undefined` everywhere.
- ❌ **`!` non-null assertion** → Handle nullability properly with early returns or optional chaining.
- ❌ **`as unknown as Type`** → Create proper data transformation functions instead of forcing casts.
- ❌ **`interface` over `type`** → Always use `type` aliases by default, unless you specifically need `interface` for `extends` / class implementation.
- ❌ **Exporting single-use types** → Options types that are only used in a single method should be defined near/inside that method, not exported globally.

### Functions & Control Flow

- ❌ **Chained arguments** → All methods must use an options object (`{...}`), even for single arguments.
- ❌ **Single-line `if` statements** → Always use curly braces `{}` even for a single statement.
- ✅ **Escape Early** → Always use the return-early pattern to avoid deep nesting.
- ✅ **Arrow Functions** → Default to arrow functions for standard methods and callbacks.
- ✅ **Extract Logic** → If a section within a method can stand alone, extract it into a separate private method.
- ✅ **Debug Logging** → All service and view model methods must call `this.debug()` at the start. For standalone functions, import logger from `$logger` and call `logger.debug()`.

### Naming, Documentation & Logging

- ❌ **Abbreviations** → Write out full words (e.g., use `options` instead of `opts`, `functionName` instead of `fnName`).
- ✅ **JSDoc Everything** → All methods, properties, and complex types must be thoroughly JSDoc commented.
- ✅ **Standardized Logging** → Always use the logger from `$logger`. Use `logger.debug` for detailed/granular tracking, and keep all log messages professional and standard.
- ✅ **Strict Formatting** → Follow the style defined in `biome.json` without exception.

## 12. File Path Comments

Every file must include its relative path from the monorepo root as a comment at the very top of the file. This ensures precise tracking for debugging and AI agent context.

### Svelte Files (`.svelte`)

The path comment must be placed exactly on the first line inside the `<script>` tag.

**✅ CORRECT**

```svelte
<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/drawer/notification/NotificationDrawer.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';

  // ... rest of the code
</script>

<BaseViewModelContainer {viewModel}>
  </BaseViewModelContainer>
```

TypeScript Files (.ts / .svelte.ts)

The path comment must be placed on line 1, at the absolute top of the file before any imports.

**✅ CORRECT**

```ts
// apps/frontend/pwa/src/lib/views/app/drawer/notification/NotificationDrawer.svelte.ts
import {
	BaseViewModel,
	type BaseViewModelInterface,
} from "$lib/components/BaseViewModel.svelte";
```
