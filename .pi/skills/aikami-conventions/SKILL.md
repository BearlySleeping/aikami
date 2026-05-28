---
name: aikami-conventions
description: Project-specific conventions for Aikami — Svelte 5 ViewModel pattern, Firebase backend, services architecture, strict TypeScript, path comments. Use when writing or refactoring Aikami code.
version: 1.0.0
tags: ["aikami", "svelte5", "sveltekit", "firebase", "conventions"]
---

# Aikami Conventions

Project-specific patterns for the Aikami monorepo. For universal TypeScript rules (function style, early returns, type system, JSDoc), see the `coding-standards` skill.

## 1. File Path Comments

Every file must include its relative path from the monorepo root as a comment at the very top of the file.

### TypeScript Files (`.ts` / `.svelte.ts`)
The path comment must be placed on **line 1**, at the absolute top of the file before any imports.

```typescript
// apps/frontend/pwa/src/lib/views/app/drawer/notification/NotificationDrawer.svelte.ts
import { BaseViewModel, type BaseViewModelInterface } from "$lib/components/BaseViewModel.svelte";
```

### Svelte Files (`.svelte`)
The path comment must be placed exactly on the **first line inside the `<script>` tag**.

```svelte
<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/drawer/notification/NotificationDrawer.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
</script>
```

## 2. TypeScript Strictness

### ❌ Forbidden — Use the alternative

| Forbidden | Use Instead |
|-----------|-------------|
| `any` | `unknown` + type guards |
| `null` | `undefined` everywhere |
| `!` (non-null assertion) | Early returns or optional chaining |
| `as unknown as Type` | Proper data transformation functions |
| `interface` (default) | `type` alias (unless you need `extends` / class impl) |
| Exporting single-use types | Define near/inside the method that uses it |

### ❌ Forbidden patterns
- **Chained arguments** — All methods must use an options object `{...}`, even for single arguments
- **Single-line `if` statements** — Always use curly braces `{}` even for a single statement
- **Abbreviations** — Write out full words (`options` not `opts`, `functionName` not `fnName`)

### ✅ Required patterns
- **Escape Early** — Always use the return-early pattern to avoid deep nesting
- **Arrow Functions** — Default to arrow functions for standard methods and callbacks
- **Extract Logic** — If a section within a method can stand alone, extract it into a separate private method
- **Debug Logging** — All service and view model methods must call `this.debug()` at the start. For standalone functions, import logger from `$logger` and call `logger.debug()`
- **JSDoc Everything** — All methods, properties, and complex types must be thoroughly JSDoc commented
- **Standardized Logging** — Always use the logger from `$logger`. Use `logger.debug` for detailed tracking

## 3. Svelte 5 Core

### Reactivity is Runes ONLY
No `$:` syntax. No stores (`writable`, `readable`).

```typescript
let count = $state(0);                    // State
let doubled = $derived(count * 2);       // Derived
$effect(() => { console.log(count); });   // Side effects
```

### Props
```svelte
let { user, theme = 'dark' } = $props();
let { value = $bindable() } = $props();
```

### Event handlers
Use HTML `onclick`, not Svelte 4 `on:click`:
```svelte
<button onclick={handleClick}>Click</button>
```

## 4. ViewModel Pattern

**Views are thin wrappers. ViewModels own all logic.** No local `$state` in views. No `onMount`.

### Architecture rules (from AGENTS.md)
- ❌ **Svelte stores** (`writable`, `readable`) → Use singleton services with `$state`
- ❌ **Local `$state` in views** → All state belongs in the ViewModels
- ❌ **`onMount` for initialization** → Use the `initialize()` method in your ViewModels
- ❌ **Destructuring ViewModels** → Never destructure reactive properties. Always access directly (`viewModel.show`)
- ❌ **`$derived` to proxy external service state** → Always use **native getters**
  - **❌ WRONG:** `confirmDialog = $derived(dialogService.confirmDialog);`
  - **✅ CORRECT:** `get confirmDialog() { return dialogService.confirmDialog; }`

### ViewModel template
```typescript
// apps/frontend/pwa/src/lib/views/feature/feature_view_model.svelte.ts
import { BaseViewModel, type BaseViewModelInterface, type BaseViewModelOptions } from "$lib/components/BaseViewModel.svelte";

export type FeatureViewModelInterface = BaseViewModelInterface & {
  items: string[];
};

export interface FeatureViewModelOptions extends BaseViewModelOptions {}

export class FeatureViewModel
  extends BaseViewModel<FeatureViewModelOptions>
  implements FeatureViewModelInterface
{
  items = $state<string[]>([]);

  async initialize(): Promise<void> {
    this.debug("initialize");
    this.items = ["Item A", "Item B"];
  }
}

export const getFeatureViewModel = (options: FeatureViewModelOptions): FeatureViewModel => {
  return new FeatureViewModel(options);
};
```

### View template
```svelte
<script lang="ts">
  // apps/frontend/pwa/src/lib/views/feature/feature_view.svelte
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { FeatureViewModelInterface } from './feature_view_model.svelte.ts';

  type Props = { viewModel: FeatureViewModelInterface };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#each viewModel.items as item}
    <p>{item}</p>
  {/each}
</BaseViewModelContainer>
```

## 5. Services Architecture

Singleton classes with `$state` for external state management. Never use Svelte stores.

```typescript
// packages/frontend/services/src/lib/my_service.svelte.ts
import { BaseClass, type BaseClassInterface } from "@aikami/utils";

export type MyServiceInterface = BaseClassInterface & {
  items: string[];
  loadItems: () => Promise<void>;
};

export class MyService extends BaseClass implements MyServiceInterface {
  items = $state<string[]>([]);

  async loadItems(): Promise<void> {
    this.debug("loadItems");
  }
}

export const myService = new MyService();
```

Access in ViewModels via native getters (NOT `$derived`).

## 6. Import Aliases

| Alias | Target |
|-------|--------|
| `$lib` | `apps/frontend/pwa/src/lib` |
| `$types` | `@aikami/types` |
| `$services` | Services layer |
| `$logger` | `@aikami/logger` |
| `$views` | `$lib/views` |

## 7. Error Handling

Use `AppError` from `@aikami/utils`:

```typescript
import { toAppError } from "@aikami/utils";

throw toAppError("not-found", "Resource not found");
throw toAppError("invalid-argument", "Invalid email");
throw toAppError("unauthorized", "User not logged in");
```

Valid types: `not-found`, `invalid-argument`, `unauthorized`, `unauthenticated`, `internal`, `captcha-required`.

## 8. Zod Validation

All runtime validation uses Zod from `@aikami/schemas`:

```typescript
import { z } from "zod";
import { userSchema } from "@aikami/schemas";
```

## 9. Project Structure

```
aikami/
  apps/
    frontend/pwa/         — SvelteKit PWA
    frontend/landing_page/ — Landing page
    frontend/docs/         — Documentation site
    frontend/gamejs/       — Game app
    backend/functions/     — Firebase Cloud Functions
  packages/
    shared/                — constants, logger, mocks, schemas, types, utils
    backend/               — auth, configs, database, svelte-kit, utils
    frontend/              — components, configs, repositories, services, utils
    scripts/               — CI, setup, ops scripts
```

## 10. Moon Commands

Use extension tools: `validate()` for fix+typecheck+build+test, `moon_detect_affected()` before running tests.

```bash
bun moon run pwa:dev              # Start PWA dev server
bun moon run :typecheck            # Type-check all projects
bun moon run :lint                 # Lint all projects
bun moon run :fix                  # Auto-fix lint issues
bun moon run :test                 # Run all tests
bun moon run :validate             # Full CI validation
```
