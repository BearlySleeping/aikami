---
name: svelte-conventions
description: >-
  Svelte 5 + SvelteKit conventions for Aikami — runes-only reactivity,
  ViewModel pattern, singleton services with $state, import aliases.
  Use when writing SvelteKit pages, views, ViewModels, or services.
  Also load `aikami-conventions` for general TS rules.
version: 1.0.0
tags: ["svelte5", "sveltekit", "viewmodel", "frontend"]
---

# Svelte Conventions

Svelte 5 + SvelteKit patterns for the Aikami PWA. Always pair with
`aikami-conventions` for general TypeScript rules (arrow functions, no
`interface`, import paths, `as const`, error handling).

## 1. Svelte 5 Core

### Reactivity is Runes ONLY

No `$:` syntax. No stores (`writable`, `readable`).

```typescript
let count = $state(0);              // State
let doubled = $derived(count * 2);  // Derived
$effect(() => { console.log(count); }); // Side effects
```

### Props

```svelte
let { user, theme = 'dark' } = $props();
let { value = $bindable() } = $props();
```

### Event Handlers

Use HTML `onclick`, not Svelte 4 `on:click`:

```svelte
<button onclick={handleClick}>Click</button>
```

### TypeScript in Svelte

Always use `<script lang="ts">`. All `.svelte.ts` files (ViewModels) are
first-class TypeScript modules with Svelte 5 rune support.

## 2. ViewModel Pattern

**Views have zero logic** — they are pure HTML/Svelte wrappers. No conditionals,
no data transformation, no `onMount`. Every expression in the view template
must be a direct property access on the ViewModel.

**ViewModels are thin bridges to services** — orchestrate service calls, expose
state to the view, but never contain heavy business logic, import repositories,
or call API/firebase functions directly. That belongs in services.

No local `$state` in views. No `onMount`.

### Architecture Rules

- ❌ **Svelte stores** → Use singleton services with `$state`
- ❌ **Local `$state` in views** → All state belongs in the ViewModel
- ❌ **`onMount` for initialization** → Use `initialize()` method in ViewModel
- ❌ **Destructuring ViewModels** → Always access directly (`viewModel.show`)
- ❌ **`$derived` to proxy service state** → Use native getters
- ❌ **Business logic in ViewModels** → Delegate to services, never import repositories or call APIs
- ❌ **Conditionals / data transforms in views** → Compute in the ViewModel, expose ready-to-render data

### ViewModel Interface — All Properties `readonly`

Interface properties exposed to the view must be `readonly` so the view cannot
mutate state directly:

```typescript
export type FeatureViewModelInterface = BaseViewModelInterface & {
  readonly items: string[];
};
```

TypeScript enforces this at compile time — the view can only read, never write.
The ViewModel class still owns mutable `$state` internally.

### ViewModel Template

```typescript
// apps/frontend/pwa/src/lib/views/feature/feature_view_model.svelte.ts
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
    // Thin bridge to service — no direct API calls
    this.items = myService.getItems();
  }
}

export const getFeatureViewModel = (
  options: FeatureViewModelOptions,
): FeatureViewModel => {
  return new FeatureViewModel(options);
};
```

### View Template

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

### Rules

- Export `type ...Interface` with **all properties `readonly`**
- Export `type ...Options` alongside the class
- Export a `getFeatureViewModel` factory function
- Always extend `BaseViewModel` and `implements *Interface`
- ViewModel files: `{name}_view_model.svelte.ts` (NOT `vm` shorthand)
- ViewModel imports services, **never** repositories or Firebase SDK directly

## 3. Services Architecture

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
    // ...
  }
}

export const myService = new MyService();
```

Access in ViewModels via native getters (NOT `$derived`):

```typescript
// ❌ WRONG
confirmDialog = $derived(dialogService.confirmDialog);

// ✅ CORRECT
get confirmDialog() { return dialogService.confirmDialog; }
```

### Service Conventions

#### 1. File Naming: Must End in `.svelte.ts`

Service files use `$state` runes, which require the `.svelte.ts` extension:

```typescript
// ✅ CORRECT
my_service.svelte.ts

// ❌ WRONG
my_service.ts
```

#### 2. Never Export Schemas from Services

Zod schemas belong in `@aikami/schemas`. Services import them, never define
or re-export them:

```typescript
// ✅ CORRECT — import schema from @aikami/schemas
import { ActiveSessionSchema } from "@aikami/schemas";

// ❌ WRONG — schema defined/exported from a service file
export const ActiveSessionSchema = z.object({ ... });
```

#### 3. Never Export Types from Services

Types belong in `@aikami/types` (cross-project) or a local `types/index.ts`
(app-local). Services import types, never define or re-export them:

```typescript
// ✅ CORRECT — import type from @aikami/types
import type { WorldLocation } from "@aikami/types";

// ✅ CORRECT — import type from local types
import type { ActiveContextEntry } from "$types/game.ts";

// ❌ WRONG — type defined in a service file
export type WorldLocation = { id: string; ... };
```

The only exception is the service's own **interface and options type** which
must live alongside the class:

```typescript
export type MyServiceOptions = BaseFrontendClassOptions & { ... };
export type MyServiceInterface = BaseFrontendClassInterface & { ... };
```

#### 4. Export Singleton Instance at Bottom

Every service exports a singleton instance at the end of the file with the
interface type annotation and `className`:

```typescript
export const myService: MyServiceInterface = new MyService({
  className: "MyService",
});
```

**Never** do any of these:

```typescript
// ❌ WRONG — exports the class, not an instance
export const myService = MyService;

// ❌ WRONG — no className, no type annotation
export const myService = new MyService();

// ❌ WRONG — factory function, no singleton
export const createMyService = () => new MyService();
```

#### 5. Export from Services Index

Every service must be re-exported from `apps/frontend/pwa/src/lib/client/services/index.ts`
so consumers can import from a single path:

```typescript
// apps/frontend/pwa/src/lib/client/services/index.ts
export * from './game/game_state_service.svelte.ts';
```

## 4. Import Aliases

| Alias       | Target                      |
| ----------- | --------------------------- |
| `$lib`      | `apps/frontend/pwa/src/lib` |
| `$types`    | `@aikami/types`             |
| `$services` | Services layer              |
| `$logger`   | Environment-specific (see below) |
| `$views`    | `$lib/views`                |

### `$logger` Resolution

The `$logger` alias resolves to the correct implementation for each environment.
Never import from `@aikami/logger` directly — always use `$logger`.

| Environment | `$logger` resolves to |
|---|---|
| SvelteKit (PWA) | `packages/shared/logger/src/lib/svelte_kit.ts` |
| Firebase Functions | `packages/shared/logger/src/lib/logger_functions.ts` |
| Browser (game, landing) | `packages/shared/logger/src/lib/logger_browser.ts` |
| AWS / Node.js | `packages/shared/logger/src/lib/logger_aws.ts` |

Each app configures this in its own `tsconfig.json` `paths`. SvelteKit
additionally overrides it in `svelte.config.js`.

```typescript
// ✅ ALWAYS use $logger
import { logger } from "$logger";

// ❌ NEVER import from @aikami/logger directly
import { logger } from "@aikami/logger";
```

Always import from the alias root (maps to `src/index.ts`):

```typescript
// ✅ CORRECT
import type { User } from "$types";
import { logger } from "$logger";

// ❌ WRONG
import type { User } from "$types/lib/user";
```

## 5. Game Engine Boundary

The PixiJS v8 + bitECS game engine runs inside the SvelteKit PWA. The boundary
is documented in the `pixijs-v8` skill — always load it when working on game
code, engine-to-UI communication, or any file in `apps/frontend/pwa/src/lib/game/`.

Critical rules:

- **No `$state` in game code** — `apps/frontend/pwa/src/lib/game/` is a pure
  imperative TypeScript zone. `$state` in the game loop crashes Svelte.
- **All UI ↔ Game communication** goes through the typed `EngineBridge`.
- **Bridge payloads must be plain serializable objects** — no PixiJS objects,
  no bitECS handles.

See `pixijs-v8` skill for the full boundary spec.
